// AWX / Ansible Automation Platform : the job template runs there, and its output is tracked
// back into the job (Awx.* in job.model.js).
import Credential from "../models/credential.model.v2.js";
// a cycle (job.model imports the orchestrator) ; only used when a job runs
import Job, { Awx } from "../models/job.model.js";

export default {
  type: "awx",
  capabilities: { playbook: false, template: true },
  async launch(ctx) {
    const { jobId, extravars, credentialMap } = ctx;
    const credentials = await Credential.resolveCredentialMap(extravars.__credentials__ || credentialMap || {});
    // the approval gate already ran (orchestrator) : no approval here
    return Awx.launch(extravars, credentials, jobId, await Job.lastOrder(jobId), null, false);
  },
  async cancel(ctx) {
    return Awx.abortJob(ctx.extravars?.__awx__, ctx.awxId, ctx.isWorkflow);
  },
};
