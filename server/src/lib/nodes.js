// Every app, worker or combined process writes its row in `nodes` every HEARTBEAT_MS : who it
// is (AF_NODE_ID), what it runs, which version, when it was last alive, and whether it holds
// the worker lock - with the worker's scheduler counts, so any node's Status page can show
// them. The worker ends the jobs followed by a node that stopped answering (Job.abandonDeadNodes).
import logger from "./logger.js";
import mysql from "../models/db.model.js";
import { ROLE, nodeId } from "./role.js";
import { appVersion } from "./version.js";
import { holdsWorkerLock } from "./workerLock.js";

const HEARTBEAT_MS = 10000;
// a node not seen for this long is gone : its jobs are abandoned
export const NODE_DEAD_SECONDS = 120;

const startedAt = new Date();
let workerInfo = () => null;
let timer = null;

// the worker hands over what the Status page shows about the scheduler
export function setWorkerInfo(fn) {
  workerInfo = fn;
}

export async function heartbeat() {
  const isWorker = holdsWorkerLock() ? 1 : 0;
  let info = null;
  if (isWorker) {
    try {
      info = JSON.stringify(workerInfo() || null);
    } catch { info = null; }
  }
  try {
    await mysql.tryDo(
      "INSERT INTO AnsibleForms.`nodes` (id, role, version, started_at, last_seen, is_worker, info) VALUES (?, ?, ?, ?, NOW(), ?, ?) " +
      "ON DUPLICATE KEY UPDATE role=VALUES(role), version=VALUES(version), started_at=VALUES(started_at), last_seen=NOW(), is_worker=VALUES(is_worker), info=VALUES(info)",
      [nodeId, ROLE, appVersion, startedAt, isWorker, info],
    );
    return true;
  } catch (e) {
    // no nodes table yet (an unpatched schema) : the worker's patch adds it
    logger.debug(`Node heartbeat failed : ${e.message || e}`);
    return false;
  }
}

export function startHeartbeat() {
  if (timer) return;
  const tick = () => {
    heartbeat().finally(() => {
      timer = setTimeout(tick, HEARTBEAT_MS);
      timer.unref?.();
    });
  };
  tick();
}

// every node seen in the last day, newest first
export async function listNodes() {
  const rows = await mysql.do(
    "SELECT id, role, version, started_at, last_seen, is_worker, info, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS age FROM AnsibleForms.`nodes` ORDER BY last_seen DESC",
    undefined,
    true,
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    version: r.version,
    startedAt: r.started_at,
    lastSeen: r.last_seen,
    ageSeconds: Number(r.age),
    alive: Number(r.age) < NODE_DEAD_SECONDS,
    isWorker: !!r.is_worker,
    info: (() => { try { return r.info ? JSON.parse(r.info) : null; } catch { return null; } })(),
    self: r.id === nodeId,
  }));
}

// the worker's housekeeping : a node row nobody wrote for a day is a container long gone
export async function forgetOldNodes() {
  const res = await mysql.do("DELETE FROM AnsibleForms.`nodes` WHERE last_seen < (NOW() - INTERVAL 1 DAY)", undefined, true);
  return res?.affectedRows || 0;
}
