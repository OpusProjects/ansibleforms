// The awx runner : a job or workflow template on AWX / Ansible Automation Platform / Ascender.
// The template's output is tracked back into the job by the app (api.js).
import logger from "../../lib/logger.js";
import mysql from "../../models/db.model.js";
import Credential from "../../models/credential.model.v2.js";
// a cycle (job.model imports the orchestrator) ; only used when a job runs
import Job from "../../models/job.model.js";
import Awx, { check } from "./api.js";

export default {
  type: "awx",
  capabilities: { playbook: false, template: true },
  check,
  // resolves once the template has ended and its output is tracked
  async launch(ctx) {
    const { jobId, extravars, credentialMap, runner } = ctx;
    const credentials = await Credential.resolveCredentialMap(extravars.__credentials__ || credentialMap || {});
    return Awx.launch(runner, extravars, credentials, jobId, await Job.lastOrder(jobId));
  },
  // the fast path : cancels the AWX job straight away ; the tracker also sees the abort flag
  async cancel(ctx) {
    const rows = await mysql.do("SELECT awx_id, awx_workflow FROM AnsibleForms.`jobs` WHERE id=?", [ctx.jobId]);
    const awxId = rows?.[0]?.awx_id;
    if (!awxId) return;
    try {
      await Awx.abortJob(ctx.runner, awxId, !!rows[0].awx_workflow);
    } catch (err) {
      logger.debug(`Job ${ctx.jobId} : AWX did not take the cancel (${err.message}) ; the tracker will`);
    }
  },
};
