// What this process runs (AF_ROLE), and the name it goes by among the other processes on
// the same database (AF_NODE_ID).
//
//   all (unset) : the web app and the worker in one process, the way AnsibleForms always ran
//   app         : the web app and the API only - run as many as you like behind a load balancer
//   worker      : the background work only - schema, seed, schedules, backups, repository
//                 syncs, cleanups. One holds the worker lock (lib/workerLock.js), others wait.
//   rte         : a runtime environment that runs playbooks (src/rte/server.js)
import os from "os";

export const ROLES = ["all", "app", "worker", "rte"];

export function currentRole(env = process.env) {
  return String(env.AF_ROLE || "").trim().toLowerCase() || "all";
}

const role = currentRole();

export const ROLE = role;
// serves the web interface and the API
export const runsWeb = role === "all" || role === "app";
// may run the background work, once it holds the worker lock
export const runsWorker = role === "all" || role === "worker";

// The name on this process's row in `nodes` and on the jobs it follows (jobs.tracker). A
// restarted container keeps its hostname, so it finds its own jobs again ; a new pod gets a
// new name, and the worker ends the jobs of a node that stopped answering.
export const nodeId = String(process.env.AF_NODE_ID || "").trim()
  || `${role === "all" ? "af" : role}-${os.hostname()}`;
