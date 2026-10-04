// Where a job runs. A runner is
//   { type, capabilities: { playbook, template }, launch(ctx), cancel(ctx) }
// launch(ctx) resolves when the job has ended (a multistep waits for its steps on it) ;
// ctx = { jobId, extravars, credentialMap, ... }. The approval gate is not a runner's
// business : runners/orchestrator.js passes a job on only once it may run.
import local from "./local.js";
import awx from "./awx.js";

export const RUNNERS = { local, awx };
export const RUNNER_TYPES = Object.keys(RUNNERS);

export function getRunner(type) {
  const runner = RUNNERS[type];
  if (!runner) throw new Error(`Unknown runner type '${type}'`);
  return runner;
}
