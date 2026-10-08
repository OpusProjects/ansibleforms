'use strict';

import logger from "../lib/logger.js";
import Job, { launchValidationMode } from "./job.model.js";
import yaml from 'yaml';
import CrudModel from './crud.model.js';
import mysql from './db.model.js';
import cronService from '../services/cron.service.js';
import { nodeId, NODE_DEAD_SECONDS, uptimeSeconds } from '../lib/role.js';

// a schedule launch older than this is released whatever its node says
const LAUNCH_MAX_MINUTES = 10;
import Form from './form.model.js';
import Errors from '../lib/errors.js';

class Schedule extends CrudModel {
  static modelName = 'schedule';

  static async create(data) {
    logger.info(`Creating schedule ${data.name}`);
    // `owner` is written by plan() alone. A request body that carries one is somebody
    // choosing which user a schedule runs as - drop it, like the internal fields below.
    delete data.owner
    return super.create(this.modelName, data);
  }

  /**
   * Plan a one-time run of a form : "Run later" for a user with allowPlannedJobs but
   * without allowScheduledJobs.
   *
   * A schedule launches as the 'Schedule Service' user with the admin role, and its
   * extra_vars are trusted as server-side configuration (reserved `__x__` keys are kept,
   * no launch validation). That is right for allowScheduledJobs, which is an admin-level
   * right, and exactly wrong for a planner : the form's role filter, the reserved-key
   * strip and the `ansibleforms_user` a playbook asserts on would all be bypassed by
   * waiting a minute. So a planned job is held to what launching the form right now
   * would allow :
   *   - one-time only, with a run_at ; no cron, nothing recurring ;
   *   - only a form the user may run (Form.load with the user's roles), checked here ;
   *   - verbose only with allowVerboseMode, as the launch controller checks it ;
   *   - only the fields below are taken from the request - not status, state, output,
   *     queue_id, and above all not owner ;
   *   - `owner` records the user, and launch() runs the job AS that user, through the
   *     same reserved-key strip and launch validation as a launch from the browser.
   *
   * @param {object} user the authenticated user (req.user.user)
   * @param {object} data the request body
   * @returns {Promise<number>} the id of the new schedule
   * @throws {Errors.BadRequestError} no name or run_at, extra_vars not a dictionary, or a
   *   form whose launch validation is 'enforce'
   * @throws {Errors.AccessDeniedError} no allowPlannedJobs, not one-time, a form the user may
   *   not run, or verbose mode without allowVerboseMode
   */
  static async plan(user, data = {}) {
    if (!user?.options?.allowPlannedJobs) {
      throw new Errors.AccessDeniedError("You do not have permission to plan jobs.");
    }
    if (!data.one_time_run || data.cron) {
      throw new Errors.AccessDeniedError("You can only plan a one-time run. Recurring schedules need the 'allowScheduledJobs' role option.");
    }
    if (!data.run_at) throw new Errors.BadRequestError("A planned job needs a run_at.");
    if (!data.name) throw new Errors.BadRequestError("A planned job needs a name.");
    const formName = data.form || '';
    // the same role filter the launch applies. Form.load throws its own AccessDeniedError
    // for a form that exists but is not this user's ; an unknown form comes back empty.
    // Both answer the same, so planning does not reveal which forms exist.
    const noAccess = new Errors.AccessDeniedError(`You do not have access to form '${formName}'`);
    let formConfig;
    try {
      formConfig = await Form.load(user?.roles || [], formName);
    } catch (err) {
      if (err?.name === 'AccessDeniedError') throw noAccess;
      throw err;
    }
    if (!formName || !formConfig?.forms?.length) throw noAccess;
    // A planned run is launched like a browser launch, with launch validation - but "Run
    // later" stores the built extra_vars, not the raw field values that validation reads.
    // Under 'enforce' the run would therefore be refused when it fires, after the schedule
    // was accepted and with nobody there to see it (a one-time schedule is deleted after
    // its run). Refuse it now, while the user is still looking.
    if (launchValidationMode(formConfig.forms[0]) === 'enforce') {
      throw new Errors.BadRequestError(`Form '${formName}' cannot be run later : its launch validation is 'enforce', and a planned run has no raw form data to validate.`);
    }
    let extravars;
    try {
      extravars = yaml.parse(data.extra_vars || '{}');
    } catch (e) {
      throw new Errors.BadRequestError(`Extra vars is not valid yaml : ${e.message}`);
    }
    if (extravars === null || extravars === undefined) extravars = {};
    if (typeof extravars !== 'object' || Array.isArray(extravars)) {
      throw new Errors.BadRequestError("Extra vars is not a valid dictionary.");
    }
    if (extravars.__verbose__ && !user?.options?.allowVerboseMode) {
      throw new Errors.AccessDeniedError("You do not have permission to run jobs in verbose mode.");
    }
    // the identity the job will run as : the user object of the token, as it is now - the
    // same object a launch from the browser puts in `ansibleforms_user`, so a playbook sees
    // the same fields either way (displayName, the oid of an Entra ID user...). It is the
    // signed payload's `user`, not the token : no secrets in it.
    const owner = { ...user, groups: user.groups || [], roles: user.roles || [], options: user.options || {} };
    logger.info(`Planning a one-time run of form '${formName}' for ${user.username} at ${data.run_at}`);
    return super.create(this.modelName, {
      name: data.name,
      form: formName,
      one_time_run: true,
      run_at: data.run_at,
      extra_vars: data.extra_vars || '',
      owner: JSON.stringify(owner),
    });
  }

  static async update(data, id) {
    // drop unwanted fields from update, used internal only
    // last_run, output, state, status, queue_id
    delete data.last_run
    delete data.output
    delete data.state
    delete data.queue_id
    // nobody re-assigns who a planned job runs as ; clearing it would turn it into an
    // admin-level schedule
    delete data.owner
    logger.info(`Updating schedule ${(data.name) ? data.name : id}`);
    return super.update(this.modelName, data, id);
  }
  static async delete(id) {
    logger.info(`Deleting schedule ${id}`);
    return super.delete(this.modelName, id);
  }
  static async findAll() {
    logger.info("Finding all schedules");
    return super.findAll(this.modelName);
  }
  static async findById(id) {
    logger.info(`Finding schedule ${id}`);
    return super.findById(this.modelName, id);
  }

  static async findByName(name) {
    logger.info(`Finding schedule ${name}`);
    return super.findByName(this.modelName, name);
  }

  static async queue(id) {
    // set to queued
    logger.info(`Queuing schedule ${id}`);
    // One statement, so the next queue number is read and written atomically - the same
    // shape as Ds.queue. Reading every row, computing max+1 and writing it back let a
    // cron tick and a manual queue interleave and hand two schedules the same queue_id,
    // which is the ordering the processor depends on (ORDER BY queue_id LIMIT 1).
    //
    // The derived table is required: MySQL refuses a subquery reading the same table an
    // UPDATE targets unless it is wrapped one level deeper.
    await mysql.do(
      "UPDATE AnsibleForms.`schedule` SET state='queued', queue_id=(SELECT n FROM (SELECT COALESCE(MAX(queue_id),0)+1 AS n FROM AnsibleForms.`schedule`) t) WHERE id=?",
      [id]);
    logger.info(`Queued schedule ${id}`);
  }

  // Back to idle, the launches nobody will finish : the node launching it stopped answering, it
  // is older than LAUNCH_MAX_MINUTES (a launch only hands the job over, it takes seconds), or -
  // atStart, the worker's start - its own from before this process started and those from before
  // 7. A launch an app node (or this process) is doing right now is left alone.
  static async releaseStale({ atStart = false } = {}) {
    const res = await mysql.do(
      "UPDATE AnsibleForms.`schedule` s SET s.state='idle', s.claim_node=NULL WHERE s.state='running' AND (" +
        "(s.claim_node IS NOT NULL AND NOT EXISTS (SELECT 1 FROM AnsibleForms.`nodes` n WHERE n.id = s.claim_node AND n.last_seen > (NOW() - INTERVAL ? SECOND)))" +
        " OR s.claim_since < (NOW() - INTERVAL ? MINUTE)" +
        (atStart ? " OR (s.claim_node = ? AND s.claim_since < (NOW() - INTERVAL ? SECOND)) OR s.claim_node IS NULL" : "") + ")",
      atStart ? [NODE_DEAD_SECONDS, LAUNCH_MAX_MINUTES, nodeId, uptimeSeconds()] : [NODE_DEAD_SECONDS, LAUNCH_MAX_MINUTES], true);
    if (res?.affectedRows) CrudModel.changed(this.modelName);
    return res?.affectedRows || 0;
  }

  static async launch(id) {
    let status = "success";
    let output;
    const schedule = await super.findById(this.modelName, id);
    const currentDate = new Date()

    // Claim the schedule before doing any work.
    //
    // Nothing ever wrote state='running', so both guards that test for it were dead: the
    // queue processor's "is one still running" check in init/index.js (which exists for
    // two instances sharing a database) and the cron trigger's own check. The row stayed
    // 'queued' for the whole run, so the processor's next pass - 10 seconds later - saw
    // the same queued schedule and launched it again.
    //
    // And a CONDITIONAL claim : only a schedule still 'queued' is taken, so two processes
    // reading the same queued row launch it once - the one whose update matched.
    // It names the node that launches it : a node that goes away mid-launch (an app node handling
    // POST /schedule/:id/launch during a deploy) would otherwise leave it 'running', and the
    // queue processor refuses to start anything while one is (Schedule.releaseStale).
    const claimed = await mysql.do(
      "UPDATE AnsibleForms.`schedule` SET state='running', claim_node=?, claim_since=NOW() WHERE id=? AND state='queued'", [nodeId, id], true);
    if (!claimed?.affectedRows) {
      logger.info(`Schedule ${id} is no longer queued, another process launched it`);
      return;
    }
    CrudModel.changed(this.modelName);

    try {
      // All of this is inside the try now. It used to run before it, so a schedule whose
      // extra_vars were not a dictionary THREW out of launch() with the row still
      // 'queued' - and the processor picked it straight back up, every 10 seconds,
      // forever, logging the same failure each time. A bad schedule must fail once and
      // be recorded as failed, not spin.
      const form = schedule.form;
      let user = {};
      let extravars = yaml.parse(schedule.extra_vars || '{}');
      // null and arrays are also typeof 'object' ; those reached the spread below and
      // died with an unhelpful TypeError
      if (typeof extravars !== 'object' || extravars === null || Array.isArray(extravars)) {
        throw new Error("Extra vars is not a valid dictionary.");
      }
      // A planned job (Schedule.plan) runs as the user who planned it ; anything else is
      // an admin-level schedule and runs as the Schedule Service. A planned job whose
      // owner cannot be read FAILS - falling back to the admin user would hand it exactly
      // the rights plan() exists to keep from it.
      const planned = !!schedule.owner;
      if (planned) {
        user = JSON.parse(schedule.owner);
        if (!user || typeof user !== 'object' || !user.username) {
          throw new Error("The user this job was planned for cannot be read.");
        }
      } else {
        user.id = 0;
        user.username = 'Schedule Service';
        user.type = 'schedule';
        user.groups = [];
        user.roles = ['admin'];
      }
      extravars.schedule = { ...schedule };
      delete extravars.schedule.owner;
      delete extravars.schedule.output;
      delete extravars.schedule.status;
      delete extravars.schedule.state;
      delete extravars.schedule.last_run;
      delete extravars.schedule.cron;
      delete extravars.schedule.extra_vars;
      // Job.launch is fire-and-forget and returns { id } - always truthy - so the else
      // below was unreachable and a schedule whose playbook failed still read 'success'.
      // Report what is actually known: the job was STARTED, and name it so the operator
      // can follow it. The job's own status is the verdict on the run.
      //
      // fromClient for a planned job : its extra_vars came from a request body, so they get
      // the reserved-key strip and launch validation a launch from the browser gets.
      // Job.launch loads the form with the owner's roles, so a role taken off the form
      // since the planning is honoured too.
      const launched = await Job.launch({ form, user, extravars, fromClient: planned });
      if (launched?.id) {
        output = `The schedule started job ${launched.id}.\nThis says the job was launched, not that it succeeded - open that job to see how it ended.`;
      } else {
        output = `The schedule ran but no job was created.\nCheck the job log that launched the schedule for more details.`;
        status = "failed";
      }
    } catch (err) {
      logger.error("Errors in schedule launch: ", err);
      output = "Failed to launch : " + err.message;
      status = "failed";
    }
    await super.update(this.modelName, { output, status, state: 'idle', last_run: currentDate }, id);
    
    // Auto-delete one-time schedules after execution
    if(schedule.one_time_run === 1){
      logger.info(`Deleting one-time schedule '${schedule.name}' after execution`);
      await super.delete(this.modelName, id);
      // Remove from cron service to stop checking
      cronService.removeSchedule(id);
    }
  }
}

export default  Schedule;
