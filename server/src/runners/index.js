// Where a job runs. A runner is
//   { type, capabilities: { playbook, template }, launch(ctx), cancel(ctx) }
// launch(ctx) resolves when the job has ended (a multistep waits for its steps on it) ;
// ctx = { jobId, extravars, credentialMap, ... }. The approval gate is not a runner's
// business : runners/orchestrator.js passes a job on only once it may run.
import awx from "./awx.js";
import rte from "./rte.js";

export const RUNNERS = { awx, rte };
export const RUNNER_TYPES = Object.keys(RUNNERS);

export function getRunner(type) {
  const runner = RUNNERS[type];
  if (!runner) throw new Error(`Unknown runner type '${type}'`);
  return runner;
}
