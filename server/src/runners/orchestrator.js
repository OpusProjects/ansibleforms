// What happens to a job between "it may start" and "a runner runs it" : the approval gate,
// then the runner. Notifications and the multistep sequence stay in job.model.js.
import moment from "moment";
import logger from "../lib/logger.js";
import Errors from "../lib/errors.js";
import mysql from "../models/db.model.js";
import Job from "../models/job.model.js";
import Runner from "../models/runner.model.js";
import { getRunner } from "./index.js";

function getTimestamp() {
  return moment.utc(Date.now()).format("YYYY-MM-DD HH:mm:ss");
}

/** what the approval line names : the playbook or the template */
function approvalLabel(jobType, extravars) {
  return jobType === "awx" ? extravars?.__template__ : extravars?.__playbook__;
}

/**
 * Halts a job for approval : the APPROVE line, status 'approve' and the notification.
 * The job continues through Job.approve -> Job.continue -> dispatch({ approved: true }).
 */
export async function approvalGate({ jobId, jobType, extravars, approval }) {
  const label = approvalLabel(jobType, extravars);
  await Job.sendApprovalNotification(approval, extravars, jobId);
  await Job.printJobOutput(
    `APPROVE [${label}] ${"*".repeat(69 - label.length)}`,
    "stdout",
    jobId,
    (await Job.lastOrder(jobId)) + 1
  );
  await Job.update(
    {
      status: "approve",
      approval: JSON.stringify(approval),
      end: getTimestamp(),
    },
    jobId
  );
  return true;
}

/**
 * Where a job runs. A playbook form names a runner with `runner: <name>` (extravar
 * __runner__) ; without one, the default runner of type rte. Without that the job fails :
 * since 8.0 the app runs no playbook itself. An AWX form runs on AWX.
 * Returns { impl, row } : the runner implementation and its row.
 */
export async function resolveRunner({ jobType, extravars }) {
  if (jobType === "awx") return { impl: getRunner("awx"), row: null };
  if (jobType !== "ansible") throw new Errors.BadRequestError(`No runner for jobs of type '${jobType}'`);
  const name = extravars?.__runner__;
  if (name) {
    const row = await Runner.findByName(name);
    if (!row) throw new Errors.NotFoundError(`No runner named '${name}' - add it under Connections > Runners`);
    const impl = getRunner(row.type);
    if (!impl.capabilities.playbook) throw new Errors.BadRequestError(`Runner '${name}' (${row.type}) cannot run a playbook`);
    return { impl, row };
  }
  const row = await Runner.findDefault("rte");
  if (row) return { impl: getRunner(row.type), row };
  throw new Errors.NotFoundError("No runner to run this playbook : add one of type rte under Connections > Runners and mark it as default, or name it on the form with runner: <name>");
}

/**
 * Runs an ansible or awx job : through the approval gate (unless approved, or a step of a
 * multistep, which approves as a whole), then on its runner. Resolves when the job ended.
 */
export async function dispatch({ jobId, jobType, extravars, credentialMap, approval = null, approved = false }) {
  if (approval && !approved) {
    return approvalGate({ jobId, jobType, extravars, approval });
  }
  if (approval) logger.notice(`Continuing ${jobType} job ${jobId}, it has been approved`);
  let runner;
  try {
    runner = await resolveRunner({ jobType, extravars });
  } catch (err) {
    await Job.endJobStatus(jobId, (await Job.lastOrder(jobId)) + 1, "stderr", "failed", `[ERROR]: ${err.message}`);
    return false;
  }
  // remembered on the job : an abort knows where to send the cancel
  await mysql.do("UPDATE AnsibleForms.`jobs` SET runner=? WHERE id=?", [runner.row?.name || null, jobId]);
  return runner.impl.launch({ jobId, jobType, extravars, credentialMap, runner: runner.row });
}
