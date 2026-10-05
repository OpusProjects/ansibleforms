// What happens to a job between "it may start" and "a runner runs it" : the approval gate,
// then the runner. Notifications and the multistep sequence stay in job.model.js.
import moment from "moment";
import logger from "../lib/logger.js";
import Job from "../models/job.model.js";
import { getRunner } from "./index.js";
import { lastOrder } from "./ansible-core.js";
import { rteConfigured } from "./rte.js";

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
    (await lastOrder(jobId)) + 1
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
 * The runner for a job ; a form cannot choose one yet, so this follows the form type.
 * PREVIEW : with RTE_URL set, every playbook job runs on that RTE.
 */
export function resolveRunner({ jobType }) {
  if (jobType === "ansible") return getRunner(rteConfigured() ? "rte" : "local");
  if (jobType === "awx") return getRunner("awx");
  throw new Error(`No runner for jobs of type '${jobType}'`);
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
  const runner = resolveRunner({ jobType });
  return runner.launch({ jobId, jobType, extravars, credentialMap });
}
