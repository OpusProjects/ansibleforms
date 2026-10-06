"use strict";
import axios from "axios";
import fs from "fs";
import yaml from "yaml";
import moment from "moment";
import os from "os";
import { spawn } from "child_process";
import Helpers from "../lib/common.js";
import Errors from "../lib/errors.js";
import Settings from "./settings.model.js";
import logger from "../lib/logger.js";
import Cmd from "../lib/cmd.js";
import { safeParse } from "../lib/safejson.js";
import ansibleConfig from "../../config/ansible.config.js";
import loggerConfig from "../../config/log.config.js";
import appConfig from "../../config/app.config.js";
import Repository from "./repository.model.js";
import mysql from "./db.model.js";
import Form from "./form.model.js";
import Expression from "./expression.model.js";
import Query from "./query.model.js";
import { resolveFormQuery } from "../lib/queryPolicy.js";
import { createFormServices } from "../lib/formServices.js";
import { validateLaunch, describeLaunchErrors, compareExtravars } from "../lib/launchValidation.js";
import { filterRawFormData, readModelPath, maskPasswords } from "../lib/formEngine/output.js";
import { sha256 } from "../lib/formEngine/node/hash.js";
import Credential from "./credential.model.v2.js";
import AwxModel from "./awx.model.js";
import path from "path";
import { fileURLToPath } from "url";
import i18n from "../lib/i18n.js";
import { stripTrailingSlashes } from "../lib/url.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function pushForminfoToExtravars(formObj, extravars, creds = {}) {
  // push top form fields to extravars
  // change in 4.0.16 => easier to process & available in playbook, might be handy
  // no credentials added here, because then can also come from asCredential property and these would get lost.
  const topFields = [
    "template",
    "awx",
    "playbook",
    "tags",
    "limit",
    "executionEnvironment",
    "check",
    "diff",
    "verbose",
    "keepExtravars",
    "credentials",
    "inventory",
    "awxCredentials",
    "ansibleCredentials",
    "vaultCredentials",
    "instanceGroups",
    "scmBranch",
    "playbookSubPath"
  ];
  for (const fieldName of topFields) {
    // Check if the field exists in formObj and if the property is not present in extravars
    if (
      Object.prototype.hasOwnProperty.call(formObj, fieldName) &&
      extravars[`__${fieldName}__`] === undefined
    ) {
      extravars[`__${fieldName}__`] = formObj[fieldName];
    }
  }
  // the form schema spells it scm_branch ; the reserved key stayed __scmBranch__
  if (extravars.__scmBranch__ === undefined && formObj.scm_branch !== undefined) extravars.__scmBranch__ = formObj.scm_branch;
  extravars["__credentials__"] = { ...extravars["__credentials__"], ...creds };
  // console.log(extravars)
}
/**
 * Strip the reserved `__x__` execution parameters from a CLIENT-supplied extravars object.
 *
 * pushForminfoToExtravars copies playbook, inventory, tags, limit, credentials and friends
 * out of the FORM definition into `__x__` keys - but only when the key is not already set.
 * Since the launch controller passed req.body.extravars through untouched, a caller could
 * pre-set them and win:
 *
 *   {"formName":"Some form I may run","extravars":{"__playbook__":"provision.yml"}}
 *
 * ...which runs a playbook the role filter on forms was there to keep them away from, with
 * __playbookSubPath__ choosing the working directory and __ansibleCredentials__ choosing
 * whose credentials to inject. These belong to the form, never to the request.
 *
 * `__verbose__` is the one exception: it is a real client choice and the controller checks
 * allowVerboseMode before this runs.
 */
const CLIENT_SETTABLE_RESERVED = new Set(["__verbose__"]);

/**
 * The reserved keys the FORM declares as fields of its own.
 *
 * Several `__x__` keys are a documented feature: "you can also dynamically set the template
 * by using a field called `__template__`" (help.yaml), and the same for `__playbook__`,
 * `__inventory__` and `__tags__`. Such a field is declared in config.yaml, so it is the FORM
 * author's decision - but its value is submitted by the browser like any other field, which
 * makes it indistinguishable on the wire from a key an attacker injected into a raw API
 * call. Stripping every `__x__` therefore silently disabled the documented overrides: the
 * key was dropped, pushForminfoToExtravars then filled it from the static form property
 * (it only writes a reserved key when it is absent), and the job ran the WRONG template
 * while reporting success.
 *
 * The form definition is the thing that tells the two apart, so it is the gate: a reserved
 * key is accepted only when the form declares a field of exactly that name. A client that
 * invents `__playbook__` for a form which never declared it is still refused, which is the
 * hole this was written to close.
 */
function declaredReservedFields(formObj) {
  const names = new Set();
  if (!formObj || typeof formObj !== "object") return names;
  const addFields = (fields) => {
    for (const field of fields || []) {
      if (field && typeof field.name === "string" && /^__.*__$/.test(field.name)) {
        names.add(field.name);
      }
    }
  };
  addFields(formObj.fields);
  // multistep: each step carries its own fields, and a step is launched as a form of its own
  for (const step of formObj.steps || []) addFields(step?.fields);
  return names;
}
function stripReservedExtravars(extravars, formObj = null) {
  if (!extravars || typeof extravars !== "object") return {};
  const declared = declaredReservedFields(formObj);
  const removed = [];
  for (const key of Object.keys(extravars)) {
    if (/^__.*__$/.test(key) && !CLIENT_SETTABLE_RESERVED.has(key) && !declared.has(key)) {
      delete extravars[key];
      removed.push(key);
    }
  }
  if (removed.length) {
    logger.warning(`Ignoring reserved extravars supplied by the client : ${removed.join(", ")}`);
  }
  return extravars;
}

/**
 * Put the launching user into the extravars as `ansibleforms_user`, trimmed to whatever the
 * instance and the form asked for (see Helpers.userForExtravars).
 *
 * Called from Job.launch rather than from the four places that used to assign the object -
 * the two launch controllers, the schedule and the datasource - because this is the first
 * point where the FORM is known, and the form may override the global setting with its own
 * `userExtravars`. One place instead of four, and it runs before the job row is written, so
 * the copy in jobs.extravars is trimmed too : that copy, not just the one AWX receives, is
 * half of what the setting exists to stop leaking.
 *
 * Delete first, ALWAYS. A client controls req.body.extravars and the controllers used to
 * overwrite `ansibleforms_user` with the real user - but under `none` there is nothing to
 * overwrite it with, so an assignment that is merely skipped would leave a forged object
 * standing in for the one the setting took away.
 *
 * Whose user object it is : the `user` passed to Job.launch, always, with one exception.
 * A relaunch (`replay`) replays a stored job, whose extravars carry the user who SUBMITTED
 * it, and replaying a job must not rewrite who ran it, so that one is kept. If the stored
 * job has none, because it ran under `none`, the replay gets none either; filling in the
 * person who pressed relaunch would make them the submitter.
 *
 * Nothing else may keep a user found in the extravars. The launch controllers get them
 * from a request body, and the schedule and the datasource get them from their own
 * `extra_vars` YAML, which whoever edits the schedule writes. Either way an
 * `ansibleforms_user` in there is somebody claiming to be a user they are not, which is
 * precisely the claim the FAQ tells playbook authors to assert on.
 */
function setUserExtravars(extravars, user, formObj, replay = false) {
  const source = replay ? extravars.ansibleforms_user : user;
  delete extravars.ansibleforms_user;
  if (source === undefined || source === null) return extravars;
  const trimmed = Helpers.userForExtravars(source, formObj?.userExtravars);
  if (trimmed !== undefined) extravars.ansibleforms_user = trimmed;
  return extravars;
}

function delay(t, v) {
  return new Promise((resolve) => setTimeout(resolve, t, v));
}

function getTimestamp() {
  return moment.utc(Date.now()).format("YYYY-MM-DD HH:mm:ss");
}

var Exec = function () {};
// start a command with db output
Exec.executeCommand = (cmd, jobid, counter) => {
  // a counter to order the output (as it's very fast and the database can mess up the order)
  var jobstatus = "success";
  // a program and its arguments, run without a shell : form values never pass through one
  var file = cmd.file;
  var args = cmd.args || [];
  // written to the process's stdin, then closed (the vault password ; ansible reads it
  // with --vault-password-file=/bin/cat)
  var stdin = cmd.stdin || "";
  var directory = cmd.directory;
  var description = cmd.description;
  var extravars = cmd.extravars;
  var hiddenExtravars = cmd.hiddenExtravars;
  var extravarsFileName = cmd.extravarsFileName;
  var hiddenExtravarsFileName = cmd.hiddenExtravarsFileName;
  var keepExtravars = cmd.keepExtravars;
  var task = cmd.task;
  const ac = new AbortController();
  // the abort flag lives in the database (Job.abort sets it), so whoever runs the process
  // - this host or another - notices it here and stops the playbook itself
  let killed = false;
  let abortPoll = null;

  // execute the procces
  return new Promise((resolve, reject) => {
    logger.debug(`${description}, ${directory} > ${Helpers.logSafe([file, ...args].join(" "))}`);
    try {
      if (extravarsFileName) {
        logger.debug(`Storing extravars to file ${extravarsFileName}`);
        var filepath = path.join(directory, extravarsFileName);
        fs.writeFileSync(filepath, extravars);

        logger.debug(
          `Storing hidden extravars to file ${hiddenExtravarsFileName}`
        );
        var he_filepath = path.join(directory, hiddenExtravarsFileName);
        fs.writeFileSync(he_filepath, hiddenExtravars);
      } else {
        logger.warning("No filename was given");
      }

      // adding abort signal
      // spawn, not exec : no shell, and exec ignores `detached`. Detached, the process runs
      // in its own process group, so stopping it stops ansible-playbook and all its workers.
      var child = spawn(file, args, {
        cwd: directory,
        signal: ac.signal,
        detached: true,
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      // a playbook that prompts gets end-of-input instead of waiting for ever
      child.stdin.on("error", (e) => logger.debug(`[Job ${jobid}] stdin : ${e.message}`));
      child.stdin.end(stdin);

      const stopProcess = (why) => {
        if (killed) return;
        killed = true;
        logger.warning(`[Job ${jobid}] ${why}, stopping the playbook`);
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (e) {
          // no process group (already gone, or a platform without them) : walk the tree
          logger.debug(`[Job ${jobid}] Process group kill failed : ${e.message}`);
          Cmd.killChildren(child.pid);
        }
      };
      const stopIfAborted = (abortRequested) => {
        if (abortRequested) stopProcess("Abort requested");
      };
      // exec stopped a process whose output on one stream passed maxBuffer ; kept, so a
      // playbook with that much output still ends the way it did (the 'main process'
      // message below, since nobody requested an abort)
      const outputBytes = { stdout: 0, stderr: 0 };
      const countOutput = (stream, data) => {
        outputBytes[stream] += Buffer.byteLength(data);
        if (outputBytes[stream] > appConfig.processMaxBuffer) stopProcess(`Output passed PROCESS_MAX_BUFFER (${appConfig.processMaxBuffer} bytes)`);
      };
      // a quiet playbook writes no output for minutes, so the flag is also polled
      abortPoll = setInterval(() => {
        Job.isAbortRequested(jobid)
          .then(stopIfAborted)
          .catch((e) => logger.debug(`[Job ${jobid}] Abort check failed : ${e.message}`));
      }, 2000);

      // Store the process ID and host identifier in the database for job control
      if (child.pid) {
        const hostname = os.hostname();
        logger.info(`[Job ${jobid}] Process started with PID: ${child.pid} on host: ${hostname}`);
        mysql.do("UPDATE AnsibleForms.`jobs` SET pid=?, host=? WHERE id=?", [child.pid, hostname, jobid])
          .then(() => {
            logger.debug(`[Job ${jobid}] PID ${child.pid} and host ${hostname} stored in database`);
          })
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to store PID and host in database: ${err.message}`);
          });
      }

      // capture the abort event, logging only
      ac.signal.addEventListener(
        "abort",
        () => {
          logger.warning("Operator aborted the process");
        },
        { once: true }
      );

      // add output eventlistener to the process to save output
      child.stdout.on("data", function (data) {
        countOutput("stdout", data);
        // save the output to database
        Job.createOutput({
          output: data,
          output_type: "stdout",
          job_id: jobid,
          order: ++counter,
        })
          .then(stopIfAborted)
          .catch((error) => {
            logger.error("Failed to create output : ", error);
          });
      });
      // add error eventlistener to the process to save output
      child.stderr.on("data", async function (data) {
        countOutput("stderr", data);
        // save the output to database
        try {
          stopIfAborted(await Job.createOutput({
            output: data,
            output_type: "stderr",
            job_id: jobid,
            order: ++counter,
          }));
        } catch (error) {
          logger.error("Failed to create output: ", error);
        }
      });

      // add exit eventlistener to the process to handle status update
      child.on("exit", async function (data) {
        clearInterval(abortPoll);
        // Clear the PID and host from the database as the process has ended
        logger.debug(`[Job ${jobid}] Process with PID ${child.pid} has exited`);
        await mysql.do("UPDATE AnsibleForms.`jobs` SET pid=NULL, host=NULL WHERE id=?", [jobid])
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to clear PID and host from database: ${err.message}`);
          });
        
        // if the exit was an actual request ; set aborted
        if (child.signalCode == "SIGTERM") {
          const abort_requested = await Job.isAbortRequested(jobid);
          if (abort_requested) {
            await Job.resetAbortRequested(jobid); // reset the abort requested flag
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "aborted",
              `${task} was aborted by the operator`
            );
            reject(`${task} was aborted by the operator`);
          } else {
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "failed",
              `${task} was aborted by the main process.  Likely some buffer or memory error occured.  Also check the maxBuffer option.`
            );
            reject(`${task} was aborted by the main process`);
          }
        } else {
          // if the exit was natural; set the jobstatus (either success or failed)
          if (data != 0) {
            jobstatus = "failed";
            logger.error(`[${jobid}] Failed with code ${data}`);
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              jobstatus,
              `[ERROR]: ${task} failed with status (${data})`
            );
            reject(`${task} failed with status (${data})`);
          } else {
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stdout",
              jobstatus,
              `ok: [${task} finished] with status (${data})`
            );
            resolve(true);
          }
        }
        if (extravarsFileName && !keepExtravars) {
          logger.debug(`Removing extavars file ${filepath}`);
          fs.unlinkSync(filepath);
        }
        if (hiddenExtravarsFileName) {
          fs.unlinkSync(he_filepath);
        }
      });
      // add error eventlistener to the process; set failed
      child.on("error", async function (data) {
        clearInterval(abortPoll);
        // Clear the PID and host from the database as the process has errored
        logger.debug(`[Job ${jobid}] Process with PID ${child.pid} encountered an error`);
        await mysql.do("UPDATE AnsibleForms.`jobs` SET pid=NULL, host=NULL WHERE id=?", [jobid])
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to clear PID and host from database: ${err.message}`);
          });
        
        await Job.endJobStatus(
          jobid,
          ++counter,
          "stderr",
          "failed",
          `${task} failed : ` + data
        );
      });
    } catch (e) {
      clearInterval(abortPoll);
      Job.endJobStatus(
        jobid,
        ++counter,
        "stderr",
        "failed",
        `${task} failed : ` + e
      );
      reject();
    }
  });
};
//job stuff... interaction with job database
var Job = function (job) {
  if (job.form && job.form != "") {
    // first time insert
    this.form = job.form;
    this.target = job.target;
    this.user = job.user;
    this.user_type = job.user_type;
    this.job_type = job.job_type;
    this.start = getTimestamp();
    this.extravars = job.extravars;
    this.credentials = job.credentials;
    this.notifications = job.notifications;
  }
  if (job.step && job.step != "") {
    // allow single step update
    this.step = job.step;
  }
  if (job.status && job.status != "") {
    // allow single status update
    this.status = job.status;
  }
  if (job.end && job.end != "") {
    // allow single status update
    this.end = job.end;
  }
  if (job.parent_id) {
    this.parent_id = job.parent_id;
  }
};
Job.create = async function (record) {
  // create job
  logger.notice(`Creating job`);
  const res = await mysql.do("INSERT INTO AnsibleForms.`jobs` set ?", record);
  return res.insertId;
};
Job.abandon = async function (all = false) {
  // abandon jobs
  logger.notice(`Abandoning jobs`);
  var sql =
    "UPDATE AnsibleForms.`jobs` set status='abandoned',abort_requested=0 where (status='running' or abort_requested) "; // remove all jobs
  if (!all) {
    sql = sql + "and (start < (NOW() - INTERVAL 1 DAY))"; // remove jobs that are 1 day old
  }
  const res = await mysql.do(sql);
  return res.changedRows;
};
Job.resetAbortRequested = async function (id) {
  logger.debug(`Resetting abort requested for job ${id}`);
  await mysql.do(
    "UPDATE AnsibleForms.`jobs` set abort_requested=0 WHERE id=?",
    [id]
  );
};

Job.update = async function (record, id) {
  logger.notice(`Updating job ${id} -> status=${record.status}`);
  try {
    await mysql.do("UPDATE AnsibleForms.`jobs` set ? WHERE id=?", [record, id]);
  } catch (error) {
    logger.error("Failed to update job", error);
  }
};
Job.endJobStatus = async (
  jobid,
  counter,
  stream,
  status,
  message,
  awx_artifacts = {}
) => {
  // logger.error("------------------------------+++++++++++++++++++++++++++++++----------------------")
  // logger.error(`jobid = ${jobid} ; counter = ${counter} ; status = ${status} ; message = ${message}`)
  // logger.error("------------------------------+++++++++++++++++++++++++++++++----------------------")
  try {
    await Job.createOutput({
      output: message,
      output_type: stream,
      job_id: jobid,
      order: counter,
    });
    await Job.update(
      {
        status: status,
        end: getTimestamp(),
        awx_artifacts: JSON.stringify(awx_artifacts),
      },
      jobid
    );
    return await Job.sendStatusNotification(jobid);
  } catch (error) {
    logger.error("Failed to create joboutput.", error);
  }
};
Job.printJobOutput = async (data, type, jobid, counter, incrementIssue) => {
  if (incrementIssue) {
    await Job.deleteOutput({ job_id: jobid });
  }
  return await Job.createOutput({
    output: data,
    output_type: type,
    job_id: jobid,
    order: counter,
  });
};
Job.isAbortRequested = async function (id) {
  const res = await mysql.do(
    "SELECT abort_requested FROM AnsibleForms.`jobs` WHERE id=?;",
    [id]
  );
  return !!res[0].abort_requested;
};
/**
 * @param {object} user The caller. REQUIRED - this had no authorization at all, so any
 *   authenticated user could abort any other user's running playbook by id. Every sibling
 *   (delete, findById) filters on j.user/j.user_type; this one did not, which also made
 *   the AccessDeniedError branch in both job controllers dead code.
 *   Aborting is a mutation of somebody else's run, so it uses the OWNER rule rather than
 *   the read rule - showAllJobLogs lets you watch a job, not kill it.
 */
Job.abort = async function (user, id) {
  logger.notice(`Aborting job ${id}`);
  await Job.checkExists(id);
  if (!user || !user.username) {
    throw new Errors.AccessDeniedError(`You do not have access to job ${id}`);
  }
  if (!user.roles?.includes("admin")) {
    const owned = await mysql.do(
      "SELECT id FROM AnsibleForms.`jobs` WHERE id=? AND user=? AND user_type=?",
      [id, user.username, user.type]
    );
    if (owned.length !== 1) {
      throw new Errors.AccessDeniedError(`You do not have access to job ${id}`);
    }
  }
  const abort_requested = await Job.isAbortRequested(id);
  if (abort_requested) {
    throw new Errors.ConflictError("Abort already requested for this job");
  }

  const res = await Job.requestAbort(id);
  if (res.changedRows != 1) {
    throw new Errors.ConflictError("This job was not running");
  }

  // A multistep runs each step as a job of its own (jobs.parent_id = the multistep), and
  // that step's runner - Exec.executeCommand for a playbook, Awx.trackJob(Workflow
  // Job) for AWX - only watches the flag of its OWN row. Flagging just the multistep made it
  // skip the steps that had not started yet, while the step already running carried on to
  // the end : a playbook kept running for as long as it took, and an AWX job was never
  // cancelled. So the running step gets the same abort as a single job would.
  // Ownership was checked on the multistep above, and its steps run as the same user.
  const runningSteps = await mysql.do(
    "SELECT id FROM AnsibleForms.`jobs` WHERE parent_id=? AND status='running'",
    [id]
  );
  for (const step of runningSteps || []) {
    logger.notice(`Aborting step ${step.id} of multistep job ${id}`);
    try {
      await Job.requestAbort(step.id);
    } catch (err) {
      // the multistep itself is flagged already, so it still stops after this step
      logger.error(`[Job ${step.id}] Failed to abort step of job ${id}: ${err.message}`);
    }
  }
  return res;
};
/**
 * Flags one running job for abort and, when its playbook runs on this host, stops it
 * right away. The flag is what actually counts : the runner of the job - here or on
 * another host - polls it and stops the playbook (or cancels the AWX job) itself.
 * No access check here - callers do that (Job.abort, and the multistep runner for its
 * own steps).
 *
 * @param {number|string} id The job to abort.
 * @returns {Promise<object>} The result of the flag update ; changedRows is 1 when the
 *   job was running and is now flagged, 0 when it was not running (or already flagged).
 */
Job.requestAbort = async function (id) {
  // Set the abort_requested flag first (database as source of truth)
  const res = await mysql.do(
    "UPDATE AnsibleForms.`jobs` set abort_requested=1 WHERE id=? AND status='running'",
    [id]
  );
  
  if (res.changedRows == 1) {
    // Get the PID and host from the database
    const pidResult = await mysql.do(
      "SELECT pid, host FROM AnsibleForms.`jobs` WHERE id=?",
      [id]
    );
    
    const pid = pidResult[0]?.pid;
    const jobHost = pidResult[0]?.host;
    const currentHost = os.hostname();
    
    if (pid && jobHost) {
      // Only attempt to kill if this is the correct host
      if (jobHost === currentHost) {
        logger.info(`[Job ${id}] Killing process with PID ${pid} on host ${currentHost}`);
        try {
          // the playbook runs in its own process group (Exec.executeCommand), so one
          // signal stops the whole pipeline ; walking the tree needs `ps`, which the
          // image does not ship, so it is only the fallback
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            await Cmd.killChildren(pid);
          }
          logger.info(`[Job ${id}] Successfully sent kill signal to PID ${pid}`);
        } catch (err) {
          logger.error(`[Job ${id}] Failed to kill PID ${pid}: ${err.message}`);
          // Don't throw - the abort flag is set, so the process will still abort on next output
        }
      } else {
        logger.warning(`[Job ${id}] Process is running on different host (job on '${jobHost}', current '${currentHost}'). Abort flag set, that instance stops it within a few seconds.`);
      }
    } else if (!pid && !jobHost) {
      logger.warning(`[Job ${id}] No PID/host found for job, abort flag set but cannot kill process directly`);
    } else {
      logger.warning(`[Job ${id}] Incomplete PID info (pid: ${pid}, host: ${jobHost}), abort flag set`);
    }
  }
  return res;
};
Job.deleteOutput = async function (record) {
  // delete last output
  await mysql.do(
    "DELETE FROM AnsibleForms.`job_output` WHERE job_id=? ORDER BY `order` DESC LIMIT 1",
    [record.job_id]
  );
};
Job.createOutput = async function (record) {
  // logger.debug(`Creating job output`)
  if (record.output) {
    // insert output and return status in 1 go
    await Job.checkExists(record.job_id);
    await mysql.do(
      "INSERT INTO AnsibleForms.`job_output` set ?;",
      [record]
    );
  }
  return await Job.isAbortRequested(record.job_id);
};
Job.delete = async function (user, id) {
  logger.notice(`Deleting job ${id}`);

  var query;
  var params;
  await Job.checkExists(id);
  if (user.roles.includes("admin") || user.options?.showAllJobLogs) {
    query =
      "SELECT j.*,sj.subjobs,j2.no_of_records,o.counter FROM AnsibleForms.jobs j LEFT JOIN (SELECT parent_id,GROUP_CONCAT(id separator ',') subjobs FROM AnsibleForms.jobs GROUP BY parent_id) sj ON sj.parent_id=j.id,(SELECT COUNT(id) no_of_records FROM AnsibleForms.jobs)j2,(SELECT max(`order`)+1 counter FROM AnsibleForms.job_output WHERE job_output.job_id=?)o WHERE j.id=?;";
    params = [id, id];
  } else {
    query =
      "SELECT j.*,sj.subjobs,j2.no_of_records,o.counter FROM AnsibleForms.jobs j LEFT JOIN (SELECT parent_id,GROUP_CONCAT(id separator ',') subjobs FROM AnsibleForms.jobs GROUP BY parent_id) sj ON sj.parent_id=j.id,(SELECT COUNT(id) no_of_records FROM AnsibleForms.jobs WHERE user=? AND user_type=?)j2,(SELECT max(`order`)+1 counter FROM AnsibleForms.job_output WHERE job_output.job_id=?)o WHERE j.id=? AND ((j.user=? AND j.user_type=?) OR (j.status='approve'));";
    params = [user.username, user.type, id, id, user.username, user.type];
  }
  // get normal data
  var res = await mysql.do(query, params, true);
  if (res.length != 1) {
    throw new Errors.AccessDeniedError(`You do not have access to job ${id}`);
  }
  // Send delete notification BEFORE deleting the job
  await Job.sendEventNotification(id, 'delete', user);
  const result = await mysql.do(
    "DELETE FROM AnsibleForms.`jobs` WHERE id = ? OR parent_id = ?",
    [id, id]
  );
  return result;
};
// Retention. `job_output.job_id` is ON DELETE CASCADE, so output rows follow their
// job automatically - but `parent_id` has NO foreign key, so a multistep parent has
// to take its children with it explicitly or they are orphaned (the same reason
// Job.delete above matches `id = ? OR parent_id = ?`).
//
// Only FINISHED jobs are eligible : `end IS NOT NULL` plus an explicit exclusion of
// 'running', so a long-running or awaiting-approval job is never removed however old
// it is. Parents are selected first and deleted with their children, which also means
// a child is never deleted out from under a parent that is still running.
//
// Deleted in batches : the first run on an instance that has never pruned could
// otherwise lock the table for minutes.
// The statuses a job can never leave. WHITELISTED on purpose : blacklisting 'running'
// looked equivalent and was not, because all four approval paths write status 'approve'
// TOGETHER WITH an `end` timestamp (see the Job.update calls around the approval
// handling). A job awaiting approval therefore looks finished, and pruning it destroys
// un-executed work plus the approval link that was mailed out - not history.
// 'abandoned' has no `end` at all (Job.abandon only sets the status), so age is measured
// on COALESCE(end, start) or those rows would never be prunable.
// 'warning' belongs here : Multistep.launch writes it as a FINAL status when a step failed
// with continue:true. Leaving it out meant the retention sweep never selected those parents,
// and because children are only removed via `OR parent_id IN (?)`, every step row and all
// their job_output survived too - for exactly the jobs that tend to be the largest.
const TERMINAL_STATUS = ['success', 'failed', 'aborted', 'rejected', 'abandoned', 'warning'];

Job.removeOlderThan = async function (days, batchSize = 500) {
  const keep = parseInt(days, 10);
  // 0 / absent / negative means keep for ever - never turn that into a delete
  if (!keep || keep < 1) return 0;
  var removed = 0;
  for (;;) {
    const candidates = await mysql.do(
      "SELECT id FROM AnsibleForms.`jobs` " +
      "WHERE parent_id IS NULL AND status IN (?) " +
      "AND COALESCE(`end`, `start`) < (NOW() - INTERVAL ? DAY) LIMIT ?",
      [TERMINAL_STATUS, keep, batchSize]
    );
    if (candidates.length === 0) break;
    const ids = candidates.map((r) => r.id);
    const res = await mysql.do(
      "DELETE FROM AnsibleForms.`jobs` WHERE id IN (?) OR parent_id IN (?)",
      [ids, ids]
    );
    removed += res?.affectedRows || 0;
    // a batch that deleted nothing would loop for ever
    if (!res?.affectedRows) break;
  }
  return removed;
};
Job.checkExists = async function (id) {
  const res = await mysql.do(
    "SELECT id FROM AnsibleForms.`jobs` WHERE id = ?",
    [id]
  );
  if (res.length == 1) {
    return;
  } else {
    throw new Errors.NotFoundError(`Job ${id} not found`);
  }
};
Job.findAll = async function (user, records) {
  logger.info("Finding all jobs");
  var query;
  if (user.roles.includes("admin") || user.options?.showAllJobLogs) {
    query =
      "SELECT id,form,target,status,CONVERT_TZ(start, 'UTC', ?) AS start,CONVERT_TZ(end, 'UTC', ?) AS end,user,user_type,job_type,parent_id,approval FROM AnsibleForms.`jobs` ORDER BY id DESC LIMIT ?";
    return await mysql.do(query, [loggerConfig.tz, loggerConfig.tz, records], true);
  } else {
    query =
      "SELECT id,form,target,status,CONVERT_TZ(start, 'UTC', ?) AS start,CONVERT_TZ(end, 'UTC', ?) AS end,user,user_type,job_type,parent_id,approval FROM AnsibleForms.`jobs` WHERE (user=? AND user_type=?) OR (status='approve') ORDER BY id DESC LIMIT ?";
    return await mysql.do(query, [loggerConfig.tz, loggerConfig.tz, user.username, user.type, records], true);
  }
};
Job.findApprovals = async function (user) {
  logger.debug("Finding all approval jobs");
  var count = 0;
  var query =
    "SELECT approval FROM AnsibleForms.`jobs` WHERE status='approve' AND approval IS NOT NULL;";
  const res = await mysql.do(query, undefined, true);

  if (user.roles.includes("admin")) {
    return res.length;
  } else {
    res.forEach((item) => {
      //
      var matches = item.approval
        .match(/"roles":\[([^\]]*)\]/)[1]
        .replaceAll('"', "")
        .split(",")
        .filter((x) => user.roles.includes(x));
      if (matches.length > 0) count++;
    });
    return count;
  }
};
// form name -> { at, fields, subforms } : the definitions masking needs, kept for a minute -
// a job being followed is read every few seconds, and Form.load reads the whole config
const PASSWORD_FIELDS_TTL_MS = 60 * 1000;
const passwordFieldsCache = new Map();

// a launch hands over the exact definition its job runs with : a password field added a
// moment ago is then masked on that job's very first read, whatever was cached before
function rememberFormFields(formName, formObj) {
  if (!formName || !formObj) return;
  if (passwordFieldsCache.size > 500) passwordFieldsCache.clear();
  passwordFieldsCache.set(formName, { at: Date.now(), fields: formObj.fields || [], subforms: formObj.subforms || [] });
}

async function formFieldsFor(formName) {
  const hit = passwordFieldsCache.get(formName);
  if (hit && Date.now() - hit.at < PASSWORD_FIELDS_TTL_MS) return hit;
  // the definition is only read to know which fields are passwords, never returned : load
  // it regardless of the reader's roles (an approver may not have the form's role)
  const formObj = (await Form.load(["admin"], formName))?.forms?.[0];
  const entry = { at: Date.now(), fields: formObj?.fields || [], subforms: formObj?.subforms || [] };
  if (passwordFieldsCache.size > 500) passwordFieldsCache.clear();
  passwordFieldsCache.set(formName, entry);
  return entry;
}

/**
 * Stored extravars (JSON text) with the value of every password field of the form masked,
 * at its model path, list rows and yaml subforms included. Anything that goes wrong leaves
 * the text as it was - it has been through the key-name regex already.
 */
async function maskPasswordFields(formName, extravarsText) {
  if (!formName || !extravarsText) return extravarsText;
  try {
    const { fields, subforms } = await formFieldsFor(formName);
    const hasPassword = [{ fields }, ...subforms].some((f) => (f?.fields || []).some((x) => x?.type === 'password'));
    if (!hasPassword) return extravarsText;
    const data = JSON.parse(extravarsText);
    return JSON.stringify(maskPasswords(data, fields, subforms));
  } catch (err) {
    logger.debug(`Could not mask the password fields of form '${formName}' : ${err.message}`);
    return extravarsText;
  }
}

Job.findById = async function (user, id, asText, logSafe = false) {
  logger.info(`Finding job ${id}`);
  var query;
  var params;
  await Job.checkExists(id);
  // Sanitize timezone to prevent SQL injection - only allow valid timezone format
  // Sanitize timezone to prevent SQL injection - only allow valid timezone format
  const safeTimezone = loggerConfig.tz.match(/^[A-Za-z/_+-]+$/) ? loggerConfig.tz : 'UTC';
  
  if (user.roles.includes("admin") || user.options?.showAllJobLogs) {
    query =
      "SELECT j.id,j.form,j.target,j.status,CONVERT_TZ(j.start, 'UTC', ?) AS start,CONVERT_TZ(j.end, 'UTC', ?) AS end,j.user,j.user_type,j.job_type,j.extravars,j.credentials,j.notifications,j.approval,j.step,j.parent_id,j.awx_id,j.awx_artifacts,j.awx_workflow,j.abort_requested,j.raw_form_data,sj.subjobs,j2.no_of_records,o.counter FROM AnsibleForms.jobs j LEFT JOIN (SELECT parent_id,GROUP_CONCAT(id separator ',') subjobs FROM AnsibleForms.jobs GROUP BY parent_id) sj ON sj.parent_id=j.id,(SELECT COUNT(id) no_of_records FROM AnsibleForms.jobs)j2,(SELECT max(`order`)+1 counter FROM AnsibleForms.job_output WHERE job_output.job_id=?)o WHERE j.id=?;";
    params = [safeTimezone, safeTimezone, id, id];
  } else {
    query =
      "SELECT j.id,j.form,j.target,j.status,CONVERT_TZ(j.start, 'UTC', ?) AS start,CONVERT_TZ(j.end, 'UTC', ?) AS end,j.user,j.user_type,j.job_type,j.extravars,j.credentials,j.notifications,j.approval,j.step,j.parent_id,j.awx_id,j.awx_artifacts,j.awx_workflow,j.abort_requested,j.raw_form_data,sj.subjobs,j2.no_of_records,o.counter FROM AnsibleForms.jobs j LEFT JOIN (SELECT parent_id,GROUP_CONCAT(id separator ',') subjobs FROM AnsibleForms.jobs GROUP BY parent_id) sj ON sj.parent_id=j.id,(SELECT COUNT(id) no_of_records FROM AnsibleForms.jobs WHERE user=? AND user_type=?)j2,(SELECT max(`order`)+1 counter FROM AnsibleForms.job_output WHERE job_output.job_id=?)o WHERE j.id=? AND ((j.user=? AND j.user_type=?) OR (j.status='approve'));";
    params = [safeTimezone, safeTimezone, user.username, user.type, id, id, user.username, user.type];
  }
  try {
    var res = await mysql.do(query, params, true);

    if (res.length != 1) {
      throw new Errors.AccessDeniedError(`You do not have access to job ${id}`);
    }
    var job = res[0];
    // convert artifacts
    job.awx_artifacts = safeParse(job.awx_artifacts, {}, `job.awx_artifacts id=${id}`);
    // convert awx workflow info (null when not a workflow job)
    job.awx_workflow = safeParse(job.awx_workflow, null, `job.awx_workflow id=${id}`);
    // mask passwords : by key name (MASK_EXTRAVARS_REGEX), and every password field of the
    // form by its definition - a password field whose key the regex does not catch (`pw`)
    // was returned readable
    if (logSafe) job.extravars = await maskPasswordFields(job.form, Helpers.logSafe(job.extravars));
    // get output summary
    res = await mysql.do(
      `SELECT 
        COALESCE(output,'') output,
        COALESCE(CONVERT_TZ(\`timestamp\`, 'UTC', ?), '') \`timestamp\`,
        COALESCE(output_type,'stdout') output_type 
      FROM AnsibleForms.\`job_output\` 
      WHERE job_id=? 
      ORDER BY job_output.order;`,
      [safeTimezone, id],
      true
    );

    // Try to read job_log_<jobid>.log if it exists
    // The log is written by the playbook to: <playbook_dir>/.joblogs/job_log_<id>.log
    // playbook_dir = ansible base path + optional playbookSubPath (from extravars)
    let jobLogContent = null;
    try {
      const ansibleBasePath = (await Repository.getAnsiblePath()) || ansibleConfig.path;
      let playbookSubPath = "";
      const ev = safeParse(job.extravars, {}, `job.extravars id=${id}`);
      playbookSubPath = ev.__playbookSubPath__ || "";
      const playbookDir = playbookSubPath
        ? path.join(ansibleBasePath, playbookSubPath)
        : ansibleBasePath;
      const logPath = path.join(playbookDir, ".joblogs", `job_log_${id}.log`);
      if (fs.existsSync(logPath)) {
        jobLogContent = fs.readFileSync(logPath, "utf-8");
      }
    } catch (e) {
      // logger.warning, not .warn : this logger is built with winston.config.syslog.levels,
      // which has no `warn`. The TypeError thrown here escaped to the outer catch, which
      // returns [] - so a job whose extravars made the try block throw became permanently
      // unviewable (200 with an empty body) and the AccessDeniedError path never fired.
      logger.warning(`Could not read job_log_${id}.log: ${e.message}`);
    }

    return { ...job, ...{ output: Helpers.formatOutput(res, asText), job_log: jobLogContent } };
  } catch (err) {
    // Rethrow. This used to `return []`, which swallowed the AccessDeniedError thrown a
    // few lines up - the comment above already described the symptom while the cause was
    // still here. Every caller then read [] as a job:
    //
    //   GET /api/v2/job/<someone else's id>  answered 200 with an empty body instead of
    //     403, and the controller's AccessDeniedError branch could never run;
    //   the download route produced an empty attachment named ...job-undefined.txt;
    //   worst, approve/reject read `job.approval` off [] as undefined, so the block that
    //     checks the caller against the job's approval roles was skipped entirely - the
    //     check only failed to be a hole because the status test after it threw.
    //
    // The controllers already map AccessDeniedError to 403 and NotFoundError to 404, and
    // a genuine database fault deserves a 500 rather than a plausible empty job.
    logger.error("Error : ", err);
    throw err;
  }
};
Job.getRawFormData = async function (user, id) {
  logger.info(`Getting raw form data for job ${id}`);
  
  try {
    // Check if user has access to this job
    const job = await Job.findById(user, id, false, false);
    logger.info(`Job found: ${job.form}`);
    
    // Get form to check relaunch permissions
    logger.info(`Loading form: ${job.form}`);
    const formConfig = await Form.load(user?.roles, job.form);
    const formObj = formConfig.forms?.[0];
    if (!formObj) {
      throw new Errors.NotFoundError(`Form '${job.form}' not found or you don't have access to it`);
    }
    logger.info(`Form loaded, checking allowRelaunch: ${formObj.allowRelaunch}`);
    
    assertRelaunchable(job, formObj, user);
    
    // Read raw form data from database
    logger.info(`Loading raw form data from database for job ${id}`);
    
    const result = await mysql.do(
      `SELECT raw_form_data FROM AnsibleForms.jobs WHERE id = ?`,
      [id]
    );
    
    if (!result || result.length === 0 || !result[0].raw_form_data) {
      throw new Errors.NotFoundError(`No saved form data found for job ${id}. This job may have been created before the relaunch feature was enabled.`);
    }
    
    const parsedData = safeParse(result[0].raw_form_data, null, `raw_form_data id=${id}`);
    if (!parsedData) {
      throw new Errors.BadRequestError(`Saved form data for job ${id} is corrupted and cannot be parsed.`);
    }
    
    // Validate form name matches
    if (parsedData.__form__ && parsedData.__form__ !== job.form) {
      throw new Errors.BadRequestError(`Cannot relaunch: saved data is from form '${parsedData.__form__}' but you're trying to load it into form '${job.form}'. Form names must match.`);
    }
    
    // Remove __form__ before returning to client
    // eslint-disable-next-line no-unused-vars -- destructured only to omit __form__ from cleanData
    const { __form__, ...cleanData } = parsedData;
    logger.info(`Successfully loaded raw form data for job ${id} with ${Object.keys(cleanData).length} fields`);
    return cleanData;
  } catch (err) {
    logger.error(`Error in getRawFormData: ${err.message}`, err);
    throw err;
  }
};


/**
 * LAUNCH_VALIDATION (or the form's `launchValidation`, the stricter wins) : validate the raw
 * field values of a REST launch with the form engine the browser and the MCP server use.
 *   - `off` (default) does nothing - the check re-runs the form's expressions and queries,
 *     so an upgrade must not start doing that unasked ;
 *   - `log` logs what would be refused, and where the client's extravars differ from the
 *     ones the server builds, so an operator can see what enforcing would do ;
 *   - `enforce` refuses an invalid launch with a ValidationError (422) carrying the failing
 *     fields, and for a valid one RETURNS the extravars and credentials the server built
 *     from the validated values : Job.launch runs those, not the client's. Otherwise valid
 *     rawFormData next to arbitrary extravars would pass. Computed fields are the server's
 *     evaluation. A wizard form cannot be checked yet, so it is refused.
 *
 * A launch without rawFormData (a raw REST call leaving it out) cannot be
 * validated, and with enforcement on that is itself a refusal : otherwise leaving it out
 * would be the way around the check.
 *
 * @returns {Promise<{extravars: object, credentials: object}|undefined>} enforce only
 */
const LAUNCH_VALIDATION_LEVELS = ['off', 'log', 'enforce'];

/**
 * The launch validation of a form : the stricter of the form's `launchValidation` and the
 * LAUNCH_VALIDATION environment variable. An architect can make a form stricter than the
 * instance (a form that is launched over REST : enforce), never looser.
 */
function launchValidationMode(formObj) {
  const level = (v) => Math.max(0, LAUNCH_VALIDATION_LEVELS.indexOf(String(v || 'off').toLowerCase()));
  return LAUNCH_VALIDATION_LEVELS[Math.max(level(formObj?.launchValidation), level(appConfig.launchValidation))];
}

async function guardLaunch({ form, formConfig, formObj, user, rawFormData, extravars, files = {} }) {
  const mode = launchValidationMode(formObj);
  if (mode !== 'log' && mode !== 'enforce') return;
  const enforce = mode === 'enforce';
  const hasRaw = !!rawFormData && typeof rawFormData === 'object' && Object.keys(rawFormData).length > 0;
  const hasFields = (formObj?.fields || []).length > 0;
  let result;
  if (!hasRaw && hasFields) {
    result = { ok: false, reason: 'no rawFormData was sent (a raw REST call), so the field values cannot be validated' };
  } else {
    try {
      result = await validateLaunch({
        formConfig, formObj, user, rawFormData, extravars, files,
        uploadPath: appConfig.uploadPath,
        services: createFormServices({ user, formConfig, formObj, deps: { Expression, Query, resolveFormQuery } }),
        // an untouched list row passes only when the list's own source produces it : a
        // REST caller cannot slip a plain row past the row checks
        verifyUntouched: true,
      });
    } catch (err) {
      if (enforce) throw new Errors.ValidationError(`Launch validation of form '${form}' failed : ${err.message}`);
      logger.error(`Launch validation of form '${form}' failed, launching anyway (launch validation 'log') : ${err.message}`);
      return;
    }
  }
  if (result.skipped) {
    if (enforce) {
      const err = new Errors.ValidationError(`Form '${form}' cannot be launched with launch validation 'enforce' yet : ${result.skipped}`);
      err.details = { reason: result.skipped };
      throw err;
    }
    logger.debug(`Launch validation of form '${form}' skipped : ${result.skipped}`);
    return;
  }
  if (result.ok) {
    if (enforce) return result.payload;
    const differ = compareExtravars(extravars, result.payload.extravars, result.uploadKeys || []);
    if (differ.length) {
      logger.warning(`Launch of form '${form}' : the extravars differ from the ones the server builds for ${differ.join(', ')} (launch validation 'log' ; 'enforce' would run the server's)`);
    }
    return;
  }
  const why = result.reason || describeLaunchErrors(result.errors);
  if (enforce) {
    const err = new Errors.ValidationError(`The form data of '${form}' is not valid - ${why}`);
    err.details = result.errors || { reason: result.reason };
    throw err;
  }
  logger.warning(`Launch validation would refuse form '${form}' for ${user?.username || 'unknown'} (launch validation 'log') : ${why}`);
}

Job.launch = async function ({
  form,
  formObj = null,
  user,
  credentials = {},
  extravars = {},
  parentId = null,
  rawFormData = {},
  waitForCompletion = false,
  // Set ONLY by the two launch controllers : it means `extravars` came from a request body
  // and must be stripped of reserved keys the form did not declare. The other callers
  // (datasource, schedule, and a multistep launching its own steps) build extravars server
  // side from stored configuration, where a `__x__` key is legitimate and stripping it
  // would break the run.
  fromClient = false,
  // Set ONLY by Job.relaunch : keep the submitter stored in the replayed extravars instead
  // of putting `user` there (see setUserExtravars).
  replay = false,
  // Set ONLY by the MCP server, which resolved and validated the form with the same engine
  // just before : the launch validation below need not run it a second time.
  validated = false,
  // the uploads of the form's file fields (POST /api/v2/job/upload results), keyed by field
  files = {}
}) {
  let creds = credentials; // Alias for backward compatibility internally

  // A step of a multistep arrives with its formObj already built; a real form arrives with
  // a name and is loaded below. The difference matters for the user trim further down, so
  // record it before the load overwrites the distinction.
  const isStep = !!formObj;

  // a formobj can be a full step pushed
  let formConfig = null;
  if (!formObj) {
    // we load it, it's an actual form
    formConfig = await Form.load(user?.roles, form);
    if (formConfig.forms.length == 0) {
      throw new Errors.NotFoundError(`No such form '${form}'`);
    }
    formObj = formConfig.forms[0]; // we take the first one, as it should be the only one
  }

  if (!isStep) rememberFormFields(form, formObj);

  // Here rather than in the controller : this is the first point where the FORM is known,
  // and the form is what says which reserved keys it declares as fields. It must run BEFORE
  // pushForminfoToExtravars, which fills a reserved key from the static form property only
  // when the key is absent - so stripping afterwards would be indistinguishable from the
  // form's own value. formObj comes from Form.load(user.roles, ...), so the declarations are
  // read from a form this user is allowed to run.
  if (fromClient) stripReservedExtravars(extravars, formObj);

  // the field values of a REST launch against the form's rules, as the browser checks them
  if (fromClient && !validated && !isStep) {
    const built = await guardLaunch({ form, formConfig, formObj, user, rawFormData, extravars, files });
    // LAUNCH_VALIDATION=enforce : the job runs what the server built from the validated values
    if (built) {
      extravars = built.extravars;
      creds = built.credentials;
    }
  }

  if (!isStep) setUserExtravars(extravars, user, formObj, replay);

  pushForminfoToExtravars(formObj, extravars, creds);

  // we have form and we have access
  var notifications = formObj.notifications || {};
  var jobtype = formObj.type;
  var target = formObj.name;

  if (!target) {
    throw new Errors.ConflictError("Invalid form or step info");
  }

  // create a new job in the database
  // if reuseId is passed, we don't create a new job and continue the existing one (for approve)
  logger.notice(`Launching form ${form}`);
  var jobid;
  try {
    jobid = await Job.create(
      new Job({
        form: form,
        target: target,
        user: user.username,
        user_type: user.type,
        status: "running",
        job_type: jobtype,
        parent_id: parentId,
        extravars: JSON.stringify(extravars),
        credentials: JSON.stringify(creds),
        notifications: JSON.stringify(notifications),
      })
    );
  } catch (err) {
    logger.error("Failed to create job", err);
    throw new Errors.ApiError(
      `Failed to create job for form ${form} : ${err.message}`
    );
  }

  logger.debug(`Job id ${jobid} is created`);
  extravars["__jobid__"] = jobid;
  
  // Store raw form data in database if provided (exclude sensitive/irrelevant fields)
  if (rawFormData && Object.keys(rawFormData).length > 0) {
    try {
      const filteredRawFormData = {};
      
      // Add form name for validation on reload
      filteredRawFormData.__form__ = form;
      
      // Only the user's input : no constants, no passwords (list rows included), no
      // system fields - the same filter the browser applies before it sends them
      Object.assign(filteredRawFormData, filterRawFormData(formObj.fields || [], rawFormData, formObj.subforms || []));

      // Store in database
      const rawFormDataJson = JSON.stringify(filteredRawFormData);
      await mysql.do(
        `UPDATE AnsibleForms.jobs SET raw_form_data = ? WHERE id = ?`,
        [rawFormDataJson, jobid]
      );
      logger.debug(`Raw form data stored to database for job ${jobid} (filtered: constants, passwords, system fields excluded)`);
    } catch (err) {
      logger.error(`Failed to store raw form data for job ${jobid}:`, err);
    }
  }
  
  // Define the execution function
  const executeJob = async () => {
    // Send launch notification
    await Job.sendEventNotification(jobid, 'launch', user);
    
    // the rest is now happening in the background
    // if credentials are requested, we now get them.
    // perhaps credentials were passed through extravars, they have precedence over the others !
    const credentials = await Credential.resolveCredentialMap(extravars.__credentials__ || creds || {});

    if (jobtype == "ansible") {
      return await Ansible.launch(
        extravars,
        credentials,
        jobid,
        null,
        parentId ? null : formObj.approval // if multistep: no individual approvals checks
      );
    }
    if (jobtype == "awx") {
      return await Awx.launch(
        extravars,
        credentials,
        jobid,
        null,
        parentId ? null : formObj.approval, // if multistep: no individual approvals checks,
        null,
        notifications
      );
    }
    if (jobtype == "multistep") {
      return await Multistep.launch({
        form,
        steps: formObj.steps,
        user,
        extravars,
        credentials: creds,
        jobid,
        counter: null,
        approval: formObj.approval
      });
    }
  };

  // If waitForCompletion is true (multistep), return jobid immediately with a promise to await
  // Otherwise fire and forget - start execution in background and return job ID immediately
  if (waitForCompletion) {
    const completionPromise = executeJob();
    return { id: jobid, completionPromise };
  } else {
    executeJob().catch(err => {
      logger.error(`Background job ${jobid} failed:`, err);
    });
    return { id: jobid };
  }
};


Job.continue = async function ({ form, user, credentials = {}, extravars = {}, jobid }) {
  const creds = credentials; // Alias for backward compatibility internally
  var formObj;
  // we load it, it's an actual form
  await Job.checkExists(jobid);
  const formConfig = await Form.load(user?.roles, form);
  if (formConfig.forms.length == 0) {
    throw new Errors.NotFoundError(`No such form '${form}'`);
  }
  formObj = formConfig.forms[0]; // we take the first one, as it should be the only one

  pushForminfoToExtravars(formObj, extravars, creds);
  extravars["__jobid__"] = jobid;

  // console.log(formObj)
  // we have form and we have access
  var jobtype = formObj.type;
  var target;
  if (jobtype == "ansible") {
    target = formObj.playbook;
  }
  if (jobtype == "awx") {
    target = formObj.template;
  }
  if (jobtype == "multistep") {
    target = formObj.name;
  }
  if (!target) {
    // throw "Invalid form or step info"
    throw new Errors.ConflictError("Invalid form or step info");
  }
  const job = await Job.findById(user, jobid, true);

  var step = job.step;
  var counter = job.counter;
  await Job.printJobOutput(
    `changed: [approved by ${user.username}]`,
    "stdout",
    jobid,
    ++counter
  );
  // Conditional claim, not a blind update. Job.approve reads the row, sees 'approve' and
  // calls this - so two approvers clicking within the same second (or one double click)
  // both got here and both launched the SAME job: two ansible-playbook processes,
  // interleaved output, and jobs.pid overwritten by whichever started second, so a later
  // abort killed only one of them. Job.abort already uses this pattern.
  const claimed = await mysql.do(
    "UPDATE AnsibleForms.`jobs` SET status='running' WHERE id=? AND status='approve'",
    [jobid]
  );
  if (!claimed.affectedRows) {
    logger.warning(`Job ${jobid} is no longer awaiting approval, not continuing`);
    return;
  }

  // the rest is now happening in the background
  // if credentials are requested, we now get them.
  credentials = await Credential.resolveCredentialMap(creds);

  // Launch job in background and return immediately
  const executeApprovedJob = async () => {
    if (jobtype == "ansible") {
      return await Ansible.launch(
        extravars,
        credentials,
        jobid,
        ++counter,
        formObj.approval,
        true
      );
    }
    if (jobtype == "awx") {
      return await Awx.launch(
        extravars,
        credentials,
        jobid,
        ++counter,
        formObj.approval,
        true
      );
    }
    if (jobtype == "multistep") {
      return await Multistep.launch({
        form,
        steps: formObj.steps,
        user,
        extravars,
        credentials: creds,
        jobid,
        counter: ++counter,
        approval: formObj.approval,
        fromStep: step,
        approved: true
      });
    }
  };

  // Fire and forget - execute in background
  executeApprovedJob().catch(err => {
    logger.error(`Approved job ${jobid} failed:`, err);
  });

  return { id: jobid };
};
/**
 * Whether this user may relaunch this job of this form : the form allows it
 * (allowRelaunch) and the user's roles grant
 * allowJobRelaunch. Shared by the plain replay, the raw form data read and the relaunch
 * with changes, so they can never disagree.
 */
function assertRelaunchable(job, formObj, user) {
  // Job.findById also hands a non-owner every job waiting for approval (so it can be
  // approved) : that is not a licence to read its form data or launch it again under
  // another name. Only the owner, an admin, or a user who sees every job may.
  const seesAll = (user?.roles || []).includes("admin") || !!user?.options?.showAllJobLogs;
  if (!seesAll && !(job.user === user?.username && (job.user_type ?? user?.type) === user?.type)) {
    throw new Errors.AccessDeniedError(`You can only relaunch your own jobs`);
  }
  if (formObj.allowRelaunch === false) {
    throw new Errors.AccessDeniedError(`Form '${job.form}' has job relaunch disabled`);
  }
  if (!user?.options?.allowJobRelaunch) {
    throw new Errors.AccessDeniedError(`You do not have permission to relaunch jobs. Contact your administrator to enable the 'allowJobRelaunch' role option.`);
  }
}

/** An error the MCP server passes on with its own code (tools.js wrap) and the details. */
function codedError(ErrorClass, message, code, details = {}) {
  const err = new ErrorClass(message);
  err.code = code;
  err.details = details;
  return err;
}

/**
 * Relaunch a job with some fields changed : the stored raw form data, with `values` laid
 * over it, goes through the form engine again - resolved, validated, the extravars built
 * by the server - as a NEW launch by `user` (ansibleforms_user is the caller, not the
 * original submitter ; a plain Job.relaunch replays the stored extravars instead).
 *
 * Passwords are never stored and never reused, so a form with a password field anywhere -
 * its subforms included - cannot be relaunched this way : the data lost the password. The uploads of file fields are reused (verified
 * again). A wizard form cannot be relaunched this way yet, and neither can a job from
 * before raw form data was stored.
 *
 * @param {object} args
 * @param {boolean} [args.preview]  resolve and build only : { form, extravars (passwords
 *   masked), credentials, payloadHash, warnings } - nothing is launched
 * @param {string} [args.expectedPayloadHash]  refuse when the payload differs (payload_mismatch)
 */
Job.relaunchWithValues = async function ({ user, id, values = {}, verbose = false, preview = false, expectedPayloadHash }) {
  const job = await Job.findById(user, id, true); // not log-safe : the stored passwords are needed
  const formConfig = await Form.load(user?.roles, job.form);
  const formObj = formConfig.forms?.[0];
  if (!formObj) {
    throw new Errors.NotFoundError(`Form '${job.form}' not found or you don't have access to it`);
  }
  assertRelaunchable(job, formObj, user);
  if (verbose && !user?.options?.allowVerboseMode) {
    throw new Errors.AccessDeniedError(`You do not have permission to run jobs in verbose mode.`);
  }
  const changed = !!values && Object.keys(values).length > 0;

  // no changes, and the form is not enforced : a replay of the job as it ran - its stored
  // extravars, on the server, as a relaunch always was (passwords included, they never leave
  // the server ; the preview masks them)
  if (!changed && launchValidationMode(formObj) !== 'enforce') {
    const storedExtravars = safeParse(job.extravars, {}, `job.extravars id=${id}`) || {};
    delete storedExtravars.__verbose__;
    const credentials = safeParse(job.credentials, {}, `job.credentials id=${id}`) || {};
    const payloadHash = sha256({ form: job.form, extravars: storedExtravars, credentials });
    if (expectedPayloadHash && expectedPayloadHash !== payloadHash) {
      throw codedError(Errors.ConflictError, 'The payload differs from the one that was previewed - preview again and have it confirmed.',
        'payload_mismatch', { expectedPayloadHash, payloadHash });
    }
    if (preview) {
      // masked with the form just loaded - by definition - and then by key name
      const byDefinition = maskPasswords(storedExtravars, formObj.fields || [], formObj.subforms || []);
      const masked = safeParse(Helpers.logSafe(JSON.stringify(byDefinition)), {}, `masked extravars id=${id}`);
      return { form: job.form, replayed: true, extravars: masked, credentials, payloadHash, warnings: [] };
    }
    const replayed = await replayJob(user, job, verbose);
    return { ...replayed, replayed: true, payloadHash, warnings: [] };
  }

  // otherwise through the form engine : resolved, validated, the extravars built here
  if (Array.isArray(formObj.wizard) && formObj.wizard.length > 0) {
    throw codedError(Errors.BadRequestError, `'${job.form}' is a wizard form ; it cannot be ${changed ? 'relaunched with changes' : 'checked under launch validation \'enforce\''} yet`, 'unsupported');
  }
  const stored = job.raw_form_data ? safeParse(job.raw_form_data, null, `job.raw_form_data id=${id}`) : null;
  if (!stored) {
    throw new Errors.NotFoundError(`No saved form data found for job ${id}, so it cannot be relaunched with changes. This job may have been created before the relaunch feature was enabled.`);
  }
  if (stored.__form__ && stored.__form__ !== job.form) {
    throw new Errors.BadRequestError(`Cannot relaunch: saved data is from form '${stored.__form__}', not '${job.form}'.`);
  }
  const { __form__, ...raw } = stored; // eslint-disable-line no-unused-vars
  // read for the uploads only - never for a password
  const storedExtravars = safeParse(job.extravars, {}, `job.extravars id=${id}`) || {};
  const files = {};
  for (const f of formObj.fields || []) {
    if (f?.type !== 'file' || !f.name) continue;
    const upload = readModelPath(storedExtravars, [].concat(f.model || f.name)[0]);
    if (upload && typeof upload === 'object') files[f.name] = upload;
  }
  const rawFormData = { ...raw, ...(values || {}) };
  const result = await validateLaunch({
    // no extravars : a password is never taken from the stored data here
    formConfig, formObj, user, rawFormData, extravars: {}, files,
    uploadPath: appConfig.uploadPath,
    services: createFormServices({ user, formConfig, formObj, deps: { Expression, Query, resolveFormQuery } }),
    allRows: true,
  });
  // a password is never stored in the form data, so a password field the form SHOWS - at the
  // top or in a row - lost its value : that cannot be relaunched from the data. One its
  // dependencies hide is not needed, and does not stand in the way.
  if (result.passwordsVisible?.length) {
    throw codedError(Errors.BadRequestError,
      `Job ${id} cannot be relaunched ${changed ? 'with changes' : 'under launch validation \'enforce\''} : its password field(s) ${result.passwordsVisible.join(', ')} are shown and passwords are never stored ; launch the form again and enter them`,
      'unsupported', { passwordFields: result.passwordsVisible });
  }
  if (!result.ok) {
    throw codedError(Errors.ValidationError,
      `Job ${id} cannot be relaunched with these values - ${describeLaunchErrors(result.errors)}`,
      'form_incomplete', result.errors);
  }
  const { extravars, credentials } = result.payload;
  delete extravars.__verbose__;
  const payloadHash = sha256({ form: job.form, extravars, credentials });
  if (expectedPayloadHash && expectedPayloadHash !== payloadHash) {
    throw codedError(Errors.ConflictError, 'The payload differs from the one that was previewed - preview again and have it confirmed.',
      'payload_mismatch', { expectedPayloadHash, payloadHash });
  }
  if (preview) {
    return {
      form: job.form,
      extravars: maskPasswords(extravars, formObj.fields || [], formObj.subforms || []),
      credentials,
      payloadHash,
      warnings: result.warnings,
    };
  }
  if (job.status == "running" || job.abort_requested) {
    throw new Errors.ConflictError(`Job ${id} is not in a status to be relaunched (status=${job.status})`);
  }
  if (verbose) extravars.__verbose__ = true;
  logger.notice(`Relaunching job ${id} with form ${job.form}, with ${Object.keys(values || {}).length} changed field(s)`);
  const launched = await Job.launch({
    form: job.form, user, credentials, extravars, rawFormData, fromClient: true, validated: true,
  });
  await Job.sendEventNotification(id, 'relaunch', user);
  return { ...launched, payloadHash, warnings: result.warnings };
};

/**
 * Relaunch a job as it ran. A form under launch validation 'enforce' goes through the form
 * engine instead (relaunchWithValues without changes) : its stored extravars are not
 * trusted as they are, and a password field it shows makes it refuse.
 */
Job.relaunch = async function (user, id, verbose) {
  const job = await Job.findById(user, id, true);
  const formConfig = await Form.load(user?.roles, job.form);
  const formObj = formConfig.forms?.[0];
  if (!formObj) {
    throw new Errors.NotFoundError(`Form '${job.form}' not found or you don't have access to it`);
  }
  assertRelaunchable(job, formObj, user);
  if (launchValidationMode(formObj) === 'enforce') {
    return Job.relaunchWithValues({ user, id, values: {}, verbose });
  }
  return replayJob(user, job, verbose);
};

/** the replay itself : the stored extravars, credentials and raw form data, launched again */
async function replayJob(user, job, verbose) {
  const id = job.id;
  var extravars = {};
  var credentials = {};
  var rawFormData = {};
  if (job.extravars) {
    extravars = safeParse(job.extravars, {}, `job.extravars id=${id}`);
  }
  // The stored extravars carry whatever the ORIGINAL launch used, __verbose__ included, so
  // a user without allowVerboseMode could relaunch a verbose job (or any job in 'approve',
  // which findById exposes to everyone) and get -vvv output. The controller checks the
  // ?verbose= query parameter; it never looked at what was already in the row.
  delete extravars["__verbose__"];
  if (verbose) {
    if (!user.options?.allowVerboseMode) {
      throw new Errors.AccessDeniedError(`You do not have permission to run jobs in verbose mode.`);
    }
    extravars["__verbose__"] = true;
  }
  if (job.credentials) {
    credentials = safeParse(job.credentials, {}, `job.credentials id=${id}`);
  }
  if (job.raw_form_data) {
    rawFormData = safeParse(job.raw_form_data, {}, `job.raw_form_data id=${id}`);
    logger.debug(`Retrieved raw form data for relaunch with ${Object.keys(rawFormData).length} fields`);
  }
  if (job.status != "running" && !job.abort_requested) {
    logger.notice(`Relaunching job ${id} with form ${job.form}`);
    const result = await Job.launch({
      form: job.form,
      user,
      credentials,
      extravars,
      rawFormData,
      replay: true
    });
    // Send relaunch notification
    await Job.sendEventNotification(id, 'relaunch', user);
    return result;
  } else {
    throw new Errors.ConflictError(
      `Job ${id} is not in a status to be relaunched (status=${job.status})`
    );
  }
}
Job.approve = async function (user, id) {
  const job = await Job.findById(user, id, true);

  var approval = safeParse(job.approval, null, `job.approval id=${id}`);
  if (approval) {
    var access = approval?.roles.filter((role) => user?.roles?.includes(role));
    if (access?.length > 0 || user?.roles?.includes("admin")) {
      logger.notice(`Approve allowed for user ${user.username}`);
    } else {
      logger.warning(`Approve denied for user ${user.username}`);
      throw new Errors.AccessDeniedError(
        `Approve denied for user ${user.username}`
      );
    }
  }
  var extravars = {};
  var credentials = {};
  if (job.extravars) {
    extravars = safeParse(job.extravars, {}, `job.extravars id=${id}`);
  }
  if (job.credentials) {
    credentials = safeParse(job.credentials, {}, `job.credentials id=${id}`);
  }
  if (job.status == "approve") {
    logger.notice(`Approving job ${id} with form ${job.form}`);
    try {
      const result = await Job.continue({
        form: job.form,
        user,
        credentials,
        extravars,
        jobid: id
      });
      // Send approve notification
      await Job.sendEventNotification(id, 'approve', user);
      return result;
    } catch (err) {
      logger.error("Failed to continue the job : ", err);
      throw err;
    }
  } else {
    throw new Errors.ConflictError(
      `Job ${id} is not in approval status (status=${job.status})`
    );
  }
};
/**
 * Helper method to build and send email notifications
 * @private
 */
Job._buildAndSendEmail = async function ({
  recipients,
  subject,
  templatePath,
  replacements = {},
  logContext = 'notification'
}) {
  try {
    const config = await Settings.findUrl();
    const url = config.url ? stripTrailingSlashes(config.url) : config.url;

    if (!url) {
      logger.warning(
        `Host URL is not set, no ${logContext} can be sent. Go to 'settings' to correct this.`
      );
      return false;
    }

    // Read template : the bundled ones live in templates/email, but a copy mounted
    // where they used to be (src/templates, documented up to 7.1) still overrides it
    var legacyTemplate = `${__dirname}/../templates/${templatePath}`;
    var templateFile = fs.existsSync(legacyTemplate) ? legacyTemplate : `${__dirname}/../../templates/email/${templatePath}`;
    var buffer = fs.readFileSync(templateFile);
    var message = buffer.toString();
    
    // Default replacements
    var color = "#158cba";
    var color2 = "#ffa73b";
    var logo = `${url}/assets/img/logo.png`;
    
    // Apply all replacements.
    // Every value goes in through a FUNCTION replacement so it is inserted verbatim. As a
    // plain string it is read for the special replacement patterns, so a job carrying $&
    // in its name, its message or its run details had the placeholder text itself pasted
    // back in ($&), or the whole surrounding template ($` / $'), into the mail body.
    const lit = (v) => () => (v ?? "");
    message = message
      .replace("${message}", lit(replacements.message))
      .replaceAll("${url}", lit(url))
      .replaceAll("${jobid}", lit(replacements.jobid))
      .replaceAll("${title}", lit(subject))
      .replaceAll("${logo}", lit(logo))
      .replaceAll("${color}", lit(color))
      .replaceAll("${color2}", lit(color2))
      .replaceAll("${heading}", lit(replacements.heading))
      .replaceAll("${subtitle}", lit(replacements.subtitle))
      .replaceAll("${buttonLabel}", lit(replacements.buttonLabel))
      .replaceAll("${regards}", lit(replacements.regards))
      .replaceAll("${runDetails}", lit(replacements.runDetails));
    
    const messageid = await Settings.mailsend(
      recipients.join(","),
      subject,
      message
    );
    
    if (!messageid) {
      logger.notice(`No ${logContext} sent`);
      return false;
    } else {
      logger.notice(`${logContext} sent to ${recipients.join(",")} with id ${messageid}`);
      return true;
    }
  } catch (err) {
    logger.error(`Failed to send ${logContext}: `, err);
    return false;
  }
};
Job.sendApprovalNotification = async function (approval, extravars, jobid) {
  if (!approval?.notifications?.length > 0) return false;
  
  var subject =
    Helpers.replacePlaceholders(approval.title, extravars) ||
    "AnsibleForms Approval Request";
  var approvalMessage = Helpers.replacePlaceholders(
    approval.message,
    extravars
  );
  
  return await Job._buildAndSendEmail({
    recipients: approval.notifications,
    subject: subject,
    templatePath: "approval.html",
    replacements: {
      message: approvalMessage,
      jobid: jobid,
      heading: i18n.t(null, 'email.approval.heading'),
      subtitle: i18n.t(null, 'email.approval.subtitle'),
      buttonLabel: i18n.t(null, 'email.approval.button'),
      regards: i18n.t(null, 'email.approval.regards'),
    },
    logContext: "Approval mail"
  });
};
Job.sendStatusNotification = async function (jobid) {
  try {
    logger.notice(`Sending status mail for jobid ${jobid}`);
    var user = {
      roles: ["admin"],
    };

    const job = await Job.findById(user, jobid, false, true);
    var notifications = safeParse(job.notifications, null, `job.notifications id=${jobid}`);
    
    // Default to 'any' if onStatus not specified
    if (notifications && !notifications.onStatus) {
      notifications.onStatus = ["any"];
    }
    
    if (!notifications?.recipients) {
      logger.notice("No notifications set");
      return false;
    }
    
    if (
      !notifications.onStatus?.includes(job.status) &&
      !notifications.onStatus?.includes("any")
    ) {
      logger.notice(`Skipping notification for status ${job.status}`);
      return false;
    }
    
    // Send the mail
    var subject = `AnsibleForms '${job.form}' [${job.job_type}] (${jobid}) - ${job.status}`;
    
    return await Job._buildAndSendEmail({
      recipients: notifications.recipients,
      subject: subject,
      templatePath: "jobstatus.html",
      replacements: {
        message: job.output.replaceAll("\r\n", "<br>"),
        jobid: jobid,
        heading: i18n.t(null, 'email.jobstatus.heading'),
        subtitle: i18n.t(null, 'email.jobstatus.subtitle'),
        buttonLabel: i18n.t(null, 'email.jobstatus.button'),
        runDetails: i18n.t(null, 'email.jobstatus.runDetails'),
        regards: i18n.t(null, 'email.jobstatus.regards'),
      },
      logContext: "Status mail"
    });
  } catch (err) {
    logger.error("Failed to send status notification: ", err);
    return false;
  }
};
Job.sendEventNotification = async function (jobid, eventType, user = null) {
  try {
    logger.notice(`Sending ${eventType} notification for jobid ${jobid}`);
    var adminUser = {
      roles: ["admin"],
    };

    const job = await Job.findById(adminUser, jobid, false, true);
    var notifications = safeParse(job.notifications, null, `job.notifications id=${jobid}`);
    
    // Check if this event type is in the onEvent array
    if (!notifications || !notifications.onEvent || !Array.isArray(notifications.onEvent)) {
      logger.notice(`No event notifications configured`);
      return false;
    }
    
    if (!notifications.onEvent.includes(eventType) && !notifications.onEvent.includes('any')) {
      logger.notice(`Event '${eventType}' not in notification list`);
      return false;
    }
    
    if (!notifications.recipients || notifications.recipients.length === 0) {
      logger.notice("No notification recipients set");
      return false;
    }

    // Event-specific subject and message content
    const eventTitles = {
      'launch': 'Launched',
      'relaunch': 'Relaunched',
      'delete': 'Deleted',
      'approve': 'Approved',
      'reject': 'Rejected'
    };
    
    const byStr = user ? ' by ' + user.username : '';
    const eventMessage = i18n.t(null, `email.jobevent.${eventType}`, { by: byStr });

    var subject = `AnsibleForms '${job.form}' [${job.job_type}] (${jobid}) - ${eventTitles[eventType]}`;
    
    return await Job._buildAndSendEmail({
      recipients: notifications.recipients,
      subject: subject,
      templatePath: "jobevent.html",
      replacements: {
        message: eventMessage,
        jobid: jobid,
        buttonLabel: i18n.t(null, 'email.jobevent.button'),
        regards: i18n.t(null, 'email.jobevent.regards'),
      },
      logContext: `${eventType} notification`
    });
  } catch (err) {
    logger.error(`Failed to send ${eventType} notification: `, err);
    return false;
  }
};
Job.reject = async function (user, id) {
  const job = await Job.findById(user, id, true);

  var approval = safeParse(job.approval, null, `job.approval id=${id}`);
  if (approval) {
    var access = approval?.roles.filter((role) => user?.roles?.includes(role));
    if (access?.length > 0 || user?.roles?.includes("admin")) {
      logger.notice(`Reject allowed for user ${user.username}`);
    } else {
      logger.warning(`Reject denied for user ${user.username}`);
      throw new Errors.AccessDeniedError(
        `Reject denied for user ${user.username}`
      );
    }
  }
  var counter = job.counter;
  if (job.status == "approve") {
    logger.notice(`Rejecting job ${id} with form ${job.form}`);
    await Job.printJobOutput(
      `changed: [rejected by ${user.username}]`,
      "stderr",
      id,
      counter + 1
    );
    const result = await Job.update({ status: "rejected", end: getTimestamp() }, id);
    // Send reject notification
    await Job.sendEventNotification(id, 'reject', user);
    return result;
  } else {
    throw new Errors.ConflictError(
      `Job ${id} is not in rejectable status (status=${job.status})`
    );
  }
};
// Multistep stuff
var Multistep = function () {};


Multistep.launch = async function ({
  form,
  steps,
  user,
  extravars = {},
  credentials = {},
  jobid,
  counter = null,
  approval = null,
  fromStep = null,
  approved = false
}) {
  const creds = credentials; // Alias for backward compatibility internally
  // create a new job in the database
  if (!counter) {
    counter = 0;
  } else {
    counter++;
  }
  // global approval
  if (!fromStep && approval) {
    if (!approved) {
      await Job.sendApprovalNotification(approval, extravars, jobid);
      await Job.printJobOutput(
        `APPROVE [${form}] ${"*".repeat(69 - form.length)}`,
        "stdout",
        jobid,
        counter + 1
      );
      await Job.update(
        {
          status: "approve",
          approval: JSON.stringify(approval),
          end: getTimestamp(),
        },
        jobid
      );
      return true;
    } else {
      logger.notice("Continuing multistep " + form + " it has been approved");
      // reset flag for steps
      approved = false;
    }
  }
  var ok = 0;
  var failed = 0;
  var skipped = 0;
  var abort_requested; // set per step, and re-read once all steps are done

  try {
    var finalSuccessStatus = true; // multistep success from start to end ?
    var partialstatus = false; // was there a step that failed and had continue ?
    var approve = false; // flag to halt at approval
    for await (const step of steps) {
      try {
        // HANDLE SKIPPING --------------------------------
        // console.log("fromstep : " + fromStep)
        if (fromStep && fromStep != step.name) {
          // Job.printJobOutput(`STEP [${step.name}] ${'*'.repeat(72-step.name.length)}`,"stdout",jobid,++counter)
          // Job.printJobOutput(`skipped: due to continue`,"stdout",jobid,++counter)
          logger.info("Skipping step " + step.name + " - in continue phase");
          // skipped++
          continue; // next step
        }
        // reset from step
        fromStep = undefined;
        if (approve && !approved) {
          // Job.printJobOutput(`STEP [${step.name}] ${'*'.repeat(72-step.name.length)}`,"stdout",jobid,++counter)
          // Job.printJobOutput(`skipped: due to approval`,"stdout",jobid,++counter)
          logger.info("Skipping step " + step.name + " due to approval");
          // skipped++
          continue;
        }
        if (step.ifExtraVar && extravars[step.ifExtraVar] !== true) {
          await Job.printJobOutput(
            `STEP [${step.name}] ${"*".repeat(72 - step.name.length)}`,
            "stdout",
            jobid,
            ++counter
          );
          await Job.printJobOutput(
            `skipped: due to condition`,
            "stdout",
            jobid,
            ++counter
          );
          logger.info("Skipping step " + step.name + " due to condition");
          skipped++;
          continue;
        }
        // ------- SKIPPING HANDLED -----------------------
        logger.notice("Running step " + step.name);
        await Job.update({ step: step.name, status: "running" }, jobid);

        // set step in parent
        // if this step has an approval
        if (step.approval) {
          if (!approved) {
            logger.notice("Approve needed for " + step.name);
            await Job.sendApprovalNotification(step.approval, extravars, jobid);
            await Job.printJobOutput(
              `APPROVE [${step.name}] ${"*".repeat(69 - step.name.length)}`,
              "stdout",
              jobid,
              ++counter
            );
            try {
              await Job.update(
                {
                  status: "approve",
                  approval: JSON.stringify(step.approval),
                  end: getTimestamp(),
                },
                jobid
              );
            } catch (error) {
              logger.error("Failed to update job", error);
            }
            approve = true; // set approve flag
            continue; // complete this step
          } else {
            approved = false; // approved is done, reset approved flag
          }
        }
        // print title of new step and check abort
        abort_requested = await Job.printJobOutput(
          `STEP [${step.name}] ${"*".repeat(72 - step.name.length)}`,
          "stdout",
          jobid,
          ++counter
        );

        // if aborted is requested, stop the flow
        if (abort_requested) {
          skipped++;
          logger.debug("skipping: step " + step.name);
          finalSuccessStatus = false;
          await Job.printJobOutput(
            "skipping: [Abort is requested]",
            "stdout",
            jobid,
            ++counter
          );
          // fail this step
          continue;
        } // fail step due to abort
        else {
          // if the previous steps were ok (or failed with continue) OR step has always:true
          if (finalSuccessStatus || step.always) {
            // filter the extravars with "key"
            var ev = { ...extravars };
            // steps can have a key, we then take a partial piece of the extravars to send to the step
            if (step.key && ev[step.key]) {
              // logger.warning(step.key + " exists using it")
              ev = ev[step.key];
              // we copy the user profile in the step data - unless the form asked for no
              // user at all, in which case there is nothing to copy and assigning undefined
              // would put a key back that the setting just removed
              // the slice is client data, so one it carries itself is dropped either way
              if (extravars.ansibleforms_user !== undefined) {
                ev.ansibleforms_user = extravars.ansibleforms_user;
              } else {
                delete ev.ansibleforms_user;
              }
            }
            // wait the promise of step
            if (!finalSuccessStatus) {
              await Job.printJobOutput(
                `ALWAYS step ${step.name}`,
                "stdout",
                jobid,
                ++counter
              );
            }
            var jobSuccess = await Job.launch({
              form,
              formObj: step,
              user,
              credentials: creds,
              extravars: ev,
              parentId: jobid,
              waitForCompletion: true
            });
            if (jobSuccess && jobSuccess.id) {
              await Job.printJobOutput(
                `ok: [Launched step ${step.name} with jobid '${jobSuccess.id}']`,
                "stdout",
                jobid,
                ++counter
              );
              // an abort that came in after the check above but before this step's row
              // existed only flagged the multistep (Job.abort aborts the steps it finds
              // running) - pass it on, or this step would still run to the end
              // (a failure here must not skip the wait below : the step would carry on
              // unwatched while the multistep moved on as if it had failed)
              try {
                if (await Job.isAbortRequested(jobid)) {
                  await Job.requestAbort(jobSuccess.id);
                }
              } catch (err) {
                logger.error(`[Job ${jobSuccess.id}] Failed to pass the abort of job ${jobid} on to its step: ${err.message}`);
              }
              
              // Now wait for the step to complete
              if (jobSuccess.completionPromise) {
                await jobSuccess.completionPromise;
                
                // Check the actual status of the child job
                const childJob = await Job.findById(user, jobSuccess.id, false);
                // A step counts as passed only when it can be READ and says so. findById
                // returns [] on any internal error, and `[].status` is undefined - which
                // used to skip this throw entirely, so the multistep carried on to the next
                // step and reported success for a step whose outcome was never established.
                // Treat unreadable as a failure: a step you cannot check has not passed.
                const childStatus = Array.isArray(childJob) ? undefined : childJob?.status;
                if (!childStatus) {
                  throw new Errors.ApiError(
                    `Step ${step.name} (jobid ${jobSuccess.id}) : could not read the step status, treating it as failed`
                  );
                }
                if (childStatus === 'failed' || childStatus === 'aborted') {
                  throw new Errors.ApiError(
                    `Step ${step.name} (jobid ${jobSuccess.id}) ${childStatus}`
                  );
                }
                
                await Job.printJobOutput(
                  `ok: [Completed step ${step.name} with jobid '${jobSuccess.id}']`,
                  "stdout",
                  jobid,
                  ++counter
                );
              }
            }
            if (!jobSuccess) {
              throw new Errors.ApiError(
                `Check the step-logs for jobid '${jobid}' for more information`
              );
            }
            // job was success
            ok++;
            continue;
          } else {
            // previous was not success or there was fail in other steps
            // skip this step
            skipped++;
            logger.debug("skipping: step " + step.name);
            finalSuccessStatus = false;
            await Job.printJobOutput(
              "skipping: [due to previous failure]",
              "stdout",
              jobid,
              ++counter
            );
            // fail this step
            continue;
          }
        }
      } catch (error) {
        // step failed - something was wrong
        failed++;
        logger.error("Failed step " + step.name + " : ", error);
        await Job.printJobOutput(
          "[ERROR]: Failed step " + step.name + " : " + error.message,
          "stderr",
          jobid,
          ++counter
        );
        // if continue, we mark partial and mark as success - unless the multistep was
        // aborted : then this step failed because the abort stopped it, and continuing
        // would end an aborted run as warning (the last step) instead of aborted
        const abortedRun = step.continue
          ? await Job.isAbortRequested(jobid).catch(() => false)
          : false;
        if (step.continue && !abortedRun) {
          await Job.printJobOutput(
            `CONTINUE on failure`,
            "stdout",
            jobid,
            ++counter
          );
          partialstatus = true;
          continue;
        } else {
          // no continue, we fail the multistep
          finalSuccessStatus = false;
          continue;
        }
      }
    }

    // create recap
    if (!approve) {
      // re-read the flag : an abort during the LAST step stopped that step (Job.abort
      // aborts the running step too) but never reached the check at the top of the loop,
      // so the multistep ended as failed - or, if the step finished anyway, as success
      // with the flag left set, which then refused every later abort of this job
      abort_requested = await Job.isAbortRequested(jobid);
      await Job.printJobOutput(
        `MULTISTEP RECAP ${"*".repeat(64)}`,
        "stdout",
        jobid,
        ++counter
      );
      await Job.printJobOutput(
        `localhost   : ok=${ok}    failed=${failed}    skipped=${skipped}`,
        "stdout",
        jobid,
        ++counter
      );
      if (finalSuccessStatus) {
        // if multistep was success
        // (an abort that came too late, after every step had finished, is cleared)
        if (abort_requested) await Job.resetAbortRequested(jobid);
        if (partialstatus) {
          // but a step failed with continue => mark as warning
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stdout",
            "warning",
            "[WARNING]: Finished multistep with warnings"
          );
        } else {
          // mark as full success
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stdout",
            "success",
            "ok: [Finished multistep successfully]"
          );
        }
      } else {
        // no multistep success
        if (abort_requested) {
          // if aborted mark as such
          await Job.resetAbortRequested(jobid);
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stderr",
            "aborted",
            "multistep was aborted"
          );
        } else {
          // else, mark failed
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stderr",
            "failed",
            "[ERROR]: Finished multistep with errors"
          );
        }
      }
    }
    return true
  } catch (err) {
    logger.error("Error in multistep, this should not happen : ", err);
  }
};
// Ansible stuff
var Ansible = function () {};
Ansible.launch = async (
  ev,
  credentials,
  jobid,
  counter,
  approval,
  approved = false
) => {
  if (!counter) {
    counter = 0;
  } else {
    counter++;
  }

  // we make a copy, we don't want to mutate the original
  var extravars = { ...ev };
  // ansible can have multiple inventories
  var inventory = [];
  var invent = extravars?.__inventory__;
  if (invent) {
    inventory.push(invent); // push the main inventory
  }
  if (extravars["__inventory__"]) {
    [].concat(extravars["__inventory__"]).forEach((item) => {
      if (typeof item == "string") {
        inventory.push(item); // add extra inventories
      } else {
        logger.warning("Non-string inventory entry");
      }
    });
  }

  var playbook = extravars?.__playbook__;
  var tags = extravars?.__tags__ || "";
  var check = extravars?.__check__ || false;
  var verbose = extravars?.__verbose__ || false;
  var limit = extravars?.__limit__ || "";
  var keepExtravars = extravars?.__keepExtravars__ || false;
  var diff = extravars?.__diff__ || false;
  var ansibleCredentials = extravars?.__ansibleCredentials__ || "";
  var vaultCredentials = extravars?.__vaultCredentials__ || "";
  var playbookSubPath = extravars?.__playbookSubPath__ || "";
  if (approval) {
    if (!approved) {
      await Job.sendApprovalNotification(approval, ev, jobid);
      await Job.printJobOutput(
        `APPROVE [${playbook}] ${"*".repeat(69 - playbook.length)}`,
        "stdout",
        jobid,
        counter + 1
      );
      await Job.update(
        {
          status: "approve",
          approval: JSON.stringify(approval),
          end: getTimestamp(),
        },
        jobid
      );
      return true;
    } else {
      logger.notice("Continuing ansible " + playbook + " it has been approved");
    }
  }
  // merge credentials now
  extravars = { ...extravars, ...credentials };
  // convert to string for the command
  extravars = JSON.stringify(extravars);
  // define hiddenExtravars
  var hiddenExtravars = {};
  try {
    if (ansibleCredentials) {
      const runCredential = await Credential.resolveCredential(ansibleCredentials);
      hiddenExtravars.ansible_user = runCredential.user;
      hiddenExtravars.ansible_password = runCredential.password;
    }
    // convert to string for the command
    hiddenExtravars = JSON.stringify(hiddenExtravars);
  } catch (err) {
    logger.error("Failed to get ansible credentials : ", err);
    await Job.endJobStatus(
      jobid,
      counter + 1,
      "stderr",
      "failed",
      "[ERROR]: Failed to get ansible credentials"
    );
    return false;
  }
  // define vaultPassword
  var vaultPassword = "";
  try {
    if (vaultCredentials) {
      const vaultCredential = await Credential.resolveCredential(vaultCredentials);
      vaultPassword = vaultCredential.password;
    }
  } catch (err) {
    logger.error("Failed to get vault credentials : ", err);
    await Job.endJobStatus(
      jobid,
      counter + 1,
      "stderr",
      "failed",
      "[ERROR]: Failed to get vault credentials"
    );
    return false;
  }
  // make extravars file
  const extravarsFileName = `extravars_${jobid}.json`;
  const hiddenExtravarsFileName = `he_${extravarsFileName}`;
  logger.debug(`Extravars File: ${extravarsFileName}`);
  // prepare my ansible command line

  // the ansible-playbook arguments ; no shell runs them, so no value needs quoting. Each
  // is text the way the quoted shell string made it : a list becomes "a,b", empty "".
  const arg = (value) => String(value ?? "");
  var args = ["-e", `@${extravarsFileName}`, "-e", `@${hiddenExtravarsFileName}`];
  if (vaultPassword) {
    // the vault password goes in on stdin, never into a file or the command line
    args.push("--vault-password-file=/bin/cat");
  }
  inventory.forEach((item) => {
    args.push("-i", arg(item));
  });
  if (tags) {
    args.push("-t", arg(tags));
  }
  if (check) {
    args.push("--check");
  }
  if (diff) {
    args.push("--diff");
  }
  if (verbose) {
    args.push("-vvv");
  }
  if (limit) {
    args.push("--limit", arg(limit));
  }
  args.push(arg(playbook));
  var directory = await Repository.getAnsiblePath();
  directory = directory || ansibleConfig.path;
  if (playbookSubPath) {
    directory = path.join(directory, playbookSubPath);
  }
  var cmdObj = {
    directory: directory,
    file: "ansible-playbook",
    args: args,
    stdin: vaultPassword,
    description: "Running playbook",
    task: "Playbook",
    extravars: extravars,
    hiddenExtravars: hiddenExtravars,
    extravarsFileName: extravarsFileName,
    hiddenExtravarsFileName: hiddenExtravarsFileName,
    keepExtravars: keepExtravars,
  };

  logger.notice("Running from directory : " + cmdObj.directory);
  logger.notice("Running playbook : " + playbook);
  logger.debug("extravars : " + extravars);
  logger.debug("inventory : " + inventory);
  logger.debug("check : " + check);
  logger.debug("diff : " + diff);
  logger.debug("tags : " + tags);
  logger.debug("limit : " + limit);
  // in the background, start the commands
  try {
    await Exec.executeCommand(cmdObj, jobid, counter);
    return true;
  } catch (err) {
    logger.error("Ansible job failed : ", err);
    return false;
  }
};

// awx stuff, interaction with awx
var Awx = function () {};
Awx.abortJob = async function (awxName, id, isWorkflow = false) {
  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  logger.info(`aborting awx ${isWorkflow ? "workflow " : ""}job ${id}`);
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  // workflow jobs have their own cancel endpoint
  const jobsPath = isWorkflow ? "/workflow_jobs/" : "/jobs/";
  try {
    const axiosResult = await axios.post(
      awxConfig.uri + appConfig.awxApiPrefix + jobsPath + id + "/cancel/",
      {},
      axiosConfig
    );
    const job = axiosResult.data;
    return job;
  } catch (error) {
    if (error.response && error.response.status === 405) {
      const message = `cannot cancel job id ${id}`;
      logger.error(message);
      throw new Errors.ConflictError(message);
    } else {
      logger.error("Failed to abort awx job : ", error);
      throw new Errors.ApiError(
        `Failed to abort awx job ${id} : ${error.message}`
      );
    }
  }
};
Awx.launch = async function (
  ev,
  credentials,
  jobid,
  counter,
  approval,
  approved = false
) {
  var message;
  if (!counter) {
    counter = 0;
  } else {
    counter++;
  }

  // we make a copy, we don't mutate the original
  var extravars = { ...ev };

  // get awx data from the extravars
  var invent = extravars?.__inventory__;
  var execenv = extravars?.__executionEnvironment__;
  var instanceGroups = [].concat(extravars?.__instanceGroups__ || []); // always array ! force to array
  var tags = extravars?.__tags__ || "";
  var scmBranch = extravars?.__scmBranch__ || "";
  var check = extravars?.__check__ || false;
  var verbose = extravars?.__verbose__ || false;
  var limit = extravars?.__limit__ || "";
  var diff = extravars?.__diff__ || false;
  var template = extravars?.__template__;
  var awxName = extravars?.__awx__;

  var awxCredentials = extravars?.__awxCredentials__ || [];
  if (approval) {
    if (!approved) {
      await Job.sendApprovalNotification(approval, ev, jobid);
      await Job.printJobOutput(
        `APPROVE [${template}] ${"*".repeat(69 - template.length)}`,
        "stdout",
        jobid,
        counter + 1
      );
      await Job.update(
        {
          status: "approve",
          approval: JSON.stringify(approval),
          end: getTimestamp(),
        },
        jobid
      );
      return true;
    } else {
      logger.notice("Continuing awx " + template + " it has been approved");
    }
  }
  try {
    const jobTemplate = await Awx.findJobTemplateByName(awxName, template);
    logger.debug("Found jobtemplate, id = " + jobTemplate.id);
    await Awx.launchTemplate(
      awxName,
      jobTemplate,
      ev,
      invent,
      tags,
      limit,
      check,
      diff,
      verbose,
      credentials,
      awxCredentials,
      execenv,
      instanceGroups,
      scmBranch,
      jobid,
      ++counter
    );
    return true;
  } catch (err) {
    message = "failed to launch awx template " + template + "\n" + err.message;
    // any error, we just end the job, no need to throw an error.
    await Job.endJobStatus(jobid, counter + 1, "stdout", "failed", message);
    throw new Errors.ApiError(message);
  }
};
Awx.launchTemplate = async function (
  awxName,
  template,
  ev,
  invent,
  tags,
  limit,
  check,
  diff,
  verbose,
  credentials,
  awxCredentials,
  execenv,
  instanceGroups,
  scmBranch,
  jobid,
  counter
) {
  var message;
  if (!counter) {
    counter = 0;
  }
  // get existing credentials in the template, and then add the external ones.
  var awxCredentialList = [];
  try {
    awxCredentialList = await Awx.findCredentialsByTemplate(
      awxName,
      template.id
    );
    logger.notice(`Found ${awxCredentialList.length} existing creds`);
  } catch (e) {
    logger.warning("No credentials available... could be workflow template");
  }
  // add external ones
  for (let i = 0; i < awxCredentials.length; i++) {
    var ac = awxCredentials[i];
    var credId = await Awx.findCredentialByName(awxName, ac);
    logger.debug(`Found awx credential '${ac}'; id = ${credId}`);
    awxCredentialList.push(credId);
  }
  awxCredentialList = [...new Set(awxCredentialList)];

  // get inventory
  var inventory = await Awx.findInventoryByName(awxName, invent);
  // get execution environment
  var executionEnvironment = await Awx.findExecutionEnvironmentByName(
    awxName,
    execenv
  );

  // get instance groups
  var instanceGroupIds = [];
  for (let index = 0; index < instanceGroups.length; index++) {
    instanceGroupIds.push(
      await Awx.findInstanceGroupByName(awxName, instanceGroups[index])
    );
  }

  // get config and go

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");

  var extravars = { ...ev }; // we make a copy of the main extravars
  // merge credentials now
  extravars = { ...extravars, ...credentials };
  extravars = JSON.stringify(extravars);
  // prep the post data
  var postdata = {
    extra_vars: extravars,
  };
  if (awxCredentialList.length > 0) {
    postdata.credentials = awxCredentialList;
  }
  if (executionEnvironment) {
    postdata.execution_environment = executionEnvironment.id;
  }
  if (instanceGroups) {
    postdata.instance_groups = instanceGroupIds.map((x) => x.id);
  }
  if (inventory) {
    postdata.inventory = inventory.id;
  }
  if (check) {
    postdata.job_type = "check";
  } else {
    postdata.job_type = "run";
  }
  if (diff) {
    postdata.diff_mode = true;
  } else {
    postdata.diff_mode = false;
  }
  if (verbose) {
    postdata.verbosity = 3;
  }
  if (limit) {
    postdata.limit = limit;
  }
  if (scmBranch) {
    postdata.scm_branch = scmBranch;
  }
  if (tags) {
    postdata.job_tags = tags;
  }

  logger.notice("Running template : " + template.name);
  logger.info("extravars : " + extravars);
  logger.info("inventory : " + inventory);
  logger.info("execution_environment : " + executionEnvironment);
  logger.info("instance_groups : " + instanceGroups);
  logger.info("credentials : " + awxCredentialList);
  logger.info("check : " + check);
  logger.info("diff : " + diff);
  logger.info("verbose : " + verbose);
  logger.info("tags : " + tags);
  logger.info("limit : " + limit);
  logger.info("scm_branch : " + scmBranch);
  // post
  if (template.related === undefined) {
    message = `Failed to launch, no launch attribute found for template ${template.name}`;
    logger.error(message);
    await Job.endJobStatus(jobid, counter + 1, "stderr", "failed", message);
    throw new Errors.ConflictError(message);
  } else {
    // prepare axiosConfig
    const axiosConfig = AwxModel.getAuthorization(awxConfig);
    // logger.debug("Lauching awx with data : " + JSON.stringify(postdata))
    logger.debug("Launching awx template");
    // launch awx job
    var axiosResult;
    try {
      axiosResult = await axios.post(
        awxConfig.uri + template.related.launch,
        postdata,
        axiosConfig
      );
    } catch (error) {
      message = `failed to launch ${template.name}`;
      if (error.response) {
        logger.error("", error.response.data);
        message += "\r\n" + yaml.stringify(error.response.data);
        await Job.endJobStatus(
          jobid,
          counter + 1,
          "stderr",
          // "failed", not "success". endJobStatus writes the status AND sends the status
          // notification built from it, so a template AWX refused to launch (a missing
          // survey variable, a credential that is not prompt-on-launch) mailed everyone
          // "- success" and then a second mail "- failed" once Awx.launch's own catch
          // corrected the row.
          "failed",
          `Failed to launch template ${template.name}. ${message}`
        );
      } else {
        logger.error("Failed to launch : ", error);
        await Job.endJobStatus(
          jobid,
          counter + 1,
          "stderr",
          // "failed", not "success". endJobStatus writes the status AND sends the status
          // notification built from it, so a template AWX refused to launch (a missing
          // survey variable, a credential that is not prompt-on-launch) mailed everyone
          // "- success" and then a second mail "- failed" once Awx.launch's own catch
          // corrected the row.
          "failed",
          `Failed to launch template ${template.name}. ${error}`
        );
      }
      throw new Errors.ApiError(message);
    }

    // get awx job (= remote job !!)
    var job = axiosResult.data;
    if (job) {
      logger.info(`awx job id = ${job.id}`);
      // log launch
      await Job.update({ awx_id: job.id }, jobid);
      await Job.printJobOutput(
        `Launched template ${template.name} with jobid ${job.id}`,
        "stdout",
        jobid,
        ++counter
      );
      // track the job in the background
      return Awx.trackJob(awxName, job, jobid, counter + 1);
    } else {
      // no awx job, end failed
      message = `could not launch job template ${template.name}`;
      await Job.endJobStatus(
        jobid,
        counter,
        "stderr",
        "failed",
        `Failed to launch template ${template.name}`
      );
      logger.error(message);
      throw new Errors.ApiError(message);
    }
  }
};

/**
 * Poll an AWX job to completion.
 *
 * This is a LOOP, and must stay one. It used to call itself for the next poll, once a
 * second, for as long as the job ran - so an hour-long template built up ~3600 nested
 * async frames, and every one of them held its own `o` / `previousoutput` alive: AWX has
 * no incremental output, so those are each a full copy of the job's stdout so far. A job
 * with a few MB of output therefore retained hundreds of MB until it finished and the
 * whole chain finally unwound, on top of a real risk of exhausting the stack.
 *
 * Each place that used to recurse now assigns the next iteration's parameters and
 * `continue`s, so only the current poll's output is reachable.
 */
Awx.trackJob = async function (
  awxName,
  job,
  jobid,
  counter,
  previousoutput,
  previousoutput2 = undefined,
  lastrun = false,
  retryCount = 0
) {
  // workflow jobs have no stdout of their own, we track them node by node
  if (job.type === "workflow_job" || job.related?.workflow_nodes) {
    return Awx.trackWorkflowJob(awxName, job, jobid, counter);
  }
  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Error("Failed to get AWX configuration");
  var message;
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  for (;;) {
  logger.info(`searching for job with id ${job.id}`);
  try {
    // get job info
    const axiosResult = await axios.get(awxConfig.uri + job.url, axiosConfig);
    var j = axiosResult.data;
    if (j) {
      // logger.debug(inspect(j))
      logger.debug(`awx job status : ` + j.status);
      try {
        // get text output
        const o = await Awx.getJobTextOutput(awxName, job);

        var incrementIssue = false;
        var output = o;
        // AWX has no incremental output, so we always need to substract previous output
        // we substract the previous output
        if (output && previousoutput) {
          // does the previous output fit in the new
          if (output.includes(previousoutput)) {
            output = output.substring(previousoutput.length);
          } else {
            if (output && previousoutput2) {
              // here we have an output problem, the incremental of AWX can sometimes deviate
              // and the last output was wrong, in this case we remove the last output from the db and take the second last output
              // as last reference.
              incrementIssue = true;
              // logger.error("Incremental problem")
              output = output.substring(previousoutput2.length);
            }
          }
        }
        // the increment issue (if true) will remove the last entry before add the new (corrected) one.
        const abort_requested = await Job.printJobOutput(
          output,
          "stdout",
          jobid,
          ++counter,
          incrementIssue
        );
        if (abort_requested) {
          await Job.printJobOutput(
            "Abort requested",
            "stderr",
            jobid,
            ++counter
          );
          try {
            // we try to abort the job
            await Awx.abortJob(awxName, j.id);
            await Job.resetAbortRequested(jobid);
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "aborted",
              "Aborted job",
              j.artifacts
            );
            return "Aborted job";
          } catch (error) {
            // abort failed... , revert abort request
            await Job.printJobOutput(
              "Abort request denied, reverting abort request",
              "stderr",
              jobid,
              ++counter
            );
            await Job.resetAbortRequested(jobid);
            // next poll (was: recurse) - previousoutput becomes the second last
            job = j;
            ++counter;
            previousoutput2 = previousoutput;
            previousoutput = o;
            lastrun = j.finished;
            retryCount = 0;
            continue;
          }
        } else {
          if (j.finished && lastrun) {
            if (j.status === "successful") {
              await Job.endJobStatus(
                jobid,
                ++counter,
                "stdout",
                "success",
                `Successfully completed template ${j.name}`,
                j.artifacts
              );
              return true;
            } else {
              // if error, end with status (aborted or failed)
              var status = "failed";
              message = `Template ${j.name} completed with status ${j.status}`;
              if (j.status == "canceled") {
                status = "aborted";
                message = `Template ${j.name} was aborted`;
                await Job.resetAbortRequested(jobid);
              }
              await Job.endJobStatus(
                jobid,
                ++counter,
                "stderr",
                status,
                message,
                j.artifacts
              );
              return message;
            }
          } else {
            // not finished, try again
            await delay(1000);
            if (j.finished) {
              logger.debug("Getting final stdout");
            }
            // next poll (was: recurse). After an increment issue the SECOND last output
            // is the reliable reference, so it is the one carried forward.
            job = j;
            ++counter;
            previousoutput2 = incrementIssue ? previousoutput2 : previousoutput;
            previousoutput = o;
            lastrun = j.finished;
            retryCount = 0;
            continue;
          }
        }
      } catch (err) {
        message = err.toString();
        logger.error(message);
        retryCount++;
        if (retryCount == 10) {
          return Promise.resolve(message);
        } else {
          logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
          await delay(1000);
          // retry the SAME poll : job, counter and both outputs stay as they were
          continue;
        }
      }
    } else {
      message = `could not find job with id ${job.id}`;
      logger.error(message);
      retryCount++;
      if (retryCount == 10) {
        return Promise.resolve(message);
      } else {
        logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
        await delay(1000);
        // retry the SAME poll, as above
        continue;
      }
    }
  } catch (e) {
    logger.error("Failed to track job : ", e);
    return e.message;
  }
  }
};
// format a workflow (node) status line ; Helpers.formatOutput() colors these by status
function workflowStatusLine(prefix, name, status, banner = false) {
  var line = `${prefix} [${name}] (${status})`;
  if (banner) line += " " + "*".repeat(Math.max(5, 79 - line.length));
  return line;
}
// get the nodes of an awx workflow job, simplified to what we need for output and visualization
Awx.getWorkflowNodes = async function (awxName, job) {
  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  if (!job.related?.workflow_nodes) return [];
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  var results = [];
  var url = job.related.workflow_nodes;
  // the node list is paginated, follow the next links
  while (url) {
    const axiosResult = await axios.get(awxConfig.uri + url, axiosConfig);
    results = results.concat(axiosResult.data?.results || []);
    url = axiosResult.data?.next;
  }
  return results.map((n) => ({
    id: n.id,
    name:
      n.summary_fields?.job?.name ||
      n.summary_fields?.unified_job_template?.name ||
      `node ${n.id}`,
    type:
      n.summary_fields?.job?.type ||
      n.summary_fields?.unified_job_template?.unified_job_type ||
      "job",
    status:
      n.summary_fields?.job?.status || (n.do_not_run ? "skipped" : "pending"),
    elapsed: n.summary_fields?.job?.elapsed || 0,
    job: n.job,
    job_url: n.related?.job,
    success_nodes: n.success_nodes || [],
    failure_nodes: n.failure_nodes || [],
    always_nodes: n.always_nodes || [],
    do_not_run: n.do_not_run || false,
  }));
};
// track an awx workflow job ; poll the workflow nodes, dump the output of every
// finished node and store the workflow graph as json for visualization
Awx.trackWorkflowJob = async function (
  awxName,
  job,
  jobid,
  counter,
  printedNodeIds = [],
  previousWorkflowJson = "",
  retryCount = 0
) {
  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Error("Failed to get AWX configuration");
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  try {
    // get workflow job info
    const axiosResult = await axios.get(awxConfig.uri + job.url, axiosConfig);
    var j = axiosResult.data;
    if (!j) throw new Error(`could not find workflow job with id ${job.id}`);
    logger.debug(`awx workflow job status : ` + j.status);
    // get the workflow nodes
    const nodes = await Awx.getWorkflowNodes(awxName, j);
    // store the workflow graph json, the client uses this to visualize the workflow
    const workflowJson = JSON.stringify({
      id: j.id,
      name: j.name,
      status: j.status,
      nodes,
    });
    if (workflowJson != previousWorkflowJson) {
      await Job.update({ awx_workflow: workflowJson }, jobid);
    }
    // dump the output of the nodes that just finished (in completion order)
    const finishedStatuses = ["successful", "failed", "error", "canceled"];
    const finishedNodes = nodes.filter(
      (n) =>
        n.job &&
        finishedStatuses.includes(n.status) &&
        !printedNodeIds.includes(n.id)
    );
    for (const node of finishedNodes) {
      var nodeOutput = "";
      try {
        // get the child job (job, project_update, workflow_approval, ...) and grab its output
        const childResult = await axios.get(
          awxConfig.uri + node.job_url,
          axiosConfig
        );
        nodeOutput =
          (await Awx.getJobTextOutput(awxName, childResult.data)) || "";
      } catch (e) {
        logger.warning(
          `Failed to get output of workflow node ${node.name} : ${e.message}`
        );
      }
      const banner = workflowStatusLine(
        "WORKFLOW NODE",
        node.name,
        node.status,
        true
      );
      await Job.printJobOutput(
        `${banner}\n${nodeOutput}`.trim(),
        "stdout",
        jobid,
        ++counter
      );
      printedNodeIds.push(node.id);
    }
    // check for abort request
    const abort_requested = await Job.isAbortRequested(jobid);
    if (abort_requested) {
      await Job.printJobOutput("Abort requested", "stderr", jobid, ++counter);
      try {
        // we try to abort the workflow job
        await Awx.abortJob(awxName, j.id, true);
        await Job.resetAbortRequested(jobid);
        await Job.endJobStatus(
          jobid,
          ++counter,
          "stderr",
          "aborted",
          "Aborted workflow job"
        );
        return "Aborted workflow job";
      } catch (error) {
        // abort failed... , revert abort request
        await Job.printJobOutput(
          "Abort request denied, reverting abort request",
          "stderr",
          jobid,
          ++counter
        );
        await Job.resetAbortRequested(jobid);
      }
    }
    if (j.finished) {
      // print a summary of all the nodes with their status
      var summary = [workflowStatusLine("WORKFLOW", j.name, j.status, true)];
      nodes.forEach((node) => {
        summary.push(workflowStatusLine("WORKFLOW NODE", node.name, node.status));
      });
      await Job.printJobOutput(summary.join("\n"), "stdout", jobid, ++counter);
      if (j.status === "successful") {
        await Job.endJobStatus(
          jobid,
          ++counter,
          "stdout",
          "success",
          `Successfully completed workflow ${j.name}`
        );
        return true;
      } else {
        // if error, end with status (aborted or failed)
        var status = "failed";
        var message = `Workflow ${j.name} completed with status ${j.status}`;
        if (j.status == "canceled") {
          status = "aborted";
          message = `Workflow ${j.name} was aborted`;
          await Job.resetAbortRequested(jobid);
        }
        await Job.endJobStatus(jobid, ++counter, "stderr", status, message);
        return message;
      }
    }
    // not finished, try again
    await delay(1000);
    return await Awx.trackWorkflowJob(
      awxName,
      j,
      jobid,
      ++counter,
      printedNodeIds,
      workflowJson
    );
  } catch (err) {
    const message = err.toString();
    logger.error(message);
    retryCount++;
    if (retryCount == 10) {
      return Promise.resolve(message);
    } else {
      logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
      await delay(1000);
      return await Awx.trackWorkflowJob(
        awxName,
        job,
        jobid,
        counter,
        printedNodeIds,
        previousWorkflowJson,
        retryCount
      );
    }
  }
};
Awx.getJobTextOutput = async function (awxName, job) {
  if (!job) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  if (job.related === undefined) {
    throw new Errors.ConflictError(
      "No related attribute found for job " + job.id
    );
  } else {
    if (!job.related.stdout) {
      // workflow job... just return status
      return job.status;
    }
    // prepare axiosConfig
    const axiosConfig = AwxModel.getAuthorization(awxConfig);
    const axiosResult = await axios.get(
      awxConfig.uri + job.related.stdout + "?format=txt",
      axiosConfig
    );
    return axiosResult.data;
  }
};
Awx.findJobTemplateByName = async function (awxName, name) {
  if (!name) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  var message;
  logger.info(`searching job template ${name}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  var axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/job_templates/?name=" +
      encodeURI(name),
    axiosConfig
  );
  var job_template = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (job_template) {
    return job_template;
  } else {
    logger.info("Template not found, looking for workflow job template");
    // trying workflow job templates
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/workflow_job_templates/?name=" +
        encodeURI(name),
      axiosConfig
    );
    job_template = axiosResult.data.results.find(function (x) {
      return x.name == name;
    });
    if (job_template) {
      return job_template;
    } else {
      message = `could not find job template ${name}`;
      logger.error(message);
      throw new Errors.NotFoundError(message);
    }
  }
};
Awx.findCredentialByName = async function (awxName, name) {
  if (!name) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  var message;
  logger.info(`searching credential ${name}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  const axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/credentials/?name=" +
      encodeURI(name),
    axiosConfig
  );
  var credential = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (credential) {
    return credential.id;
  } else {
    message = `could not find credential ${name}`;
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findExecutionEnvironmentByName = async function (awxName, name) {
  if (!name) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  var message;
  logger.info(`searching execution environment ${name}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  message = `could not find execution environment ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/execution_environments/?name=" +
        encodeURI(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var execution_environment = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (execution_environment) {
    return execution_environment;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findInstanceGroupByName = async function (awxName, name) {
  if (!name) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  var message;
  logger.info(`searching instance group ${name}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  message = `could not find instance group ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/instance_groups/?name=" +
        encodeURI(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var instance_group = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (instance_group) {
    return instance_group;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findCredentialsByTemplate = async function (awxName, id) {
  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  logger.info(`searching credentials for template id ${id}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  const axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/job_templates/" +
      id +
      "/credentials/",
    axiosConfig
  );
  if (axiosResult.data?.results?.length) {
    return axiosResult.data.results.map((x) => x.id);
  }
  return [];
};
Awx.findInventoryByName = async function (awxName, name) {
  if (!name) return undefined;

  const awxConfig = awxName
    ? await AwxModel.findByName(awxName)
    : await AwxModel.findByProperty("is_default", 1);
  if (!awxConfig) throw new Errors.ApiError("Failed to get AWX configuration");
  var message;
  logger.info(`searching inventory ${name}`);
  // prepare axiosConfig
  const axiosConfig = AwxModel.getAuthorization(awxConfig);
  message = `could not find inventory ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/inventories/?name=" +
        encodeURI(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var inventory = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (inventory) {
    return inventory;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};

export default Job;
// named export of the awx interaction functions (mainly for testing)
export { Awx, Exec, Multistep, stripReservedExtravars, setUserExtravars, guardLaunch, launchValidationMode, pushForminfoToExtravars };
