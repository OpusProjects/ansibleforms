// The built-in runner : ansible-playbook as a child process of this container.
import { runAnsibleJob } from "./ansible-core.js";

export default {
  type: "local",
  capabilities: { playbook: true, template: false },
  // resolves when the playbook has ended, so a multistep can wait for its step
  async launch(ctx) {
    return runAnsibleJob({ jobId: ctx.jobId });
  },
  // abort travels through jobs.abort_requested ; the running process stops itself
  async cancel() {},
};
