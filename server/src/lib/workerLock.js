// One worker at a time : the background work (schema, seed, schedules, backups, repository
// syncs, cleanups) runs only in the process holding the database lock `ansibleforms_worker`.
//
// GET_LOCK belongs to a connection, so the lock lives on a connection of its own, kept open
// for as long as this process is the worker. A worker that stops drops that connection and the
// database frees the lock at once ; a waiting worker (or an AF_ROLE unset process) takes it on
// its next try, within LOCK_RETRY_MS.
//
// A worker whose HOST dies (power, a crashed kubernetes node, a network partition) sends no
// goodbye : the database keeps its session - and the lock - until wait_timeout, 8 hours by
// default. So a waiting process also watches the holder : when the same connection has held the
// lock for longer than NODE_DEAD_SECONDS while no worker writes a heartbeat (lib/nodes.js), that
// connection is killed and the lock taken over.
//
// Galera and group replication do not share GET_LOCK between their nodes : point every
// worker at the same database node.
import client from "mysql2/promise";
import dbConfig from "../../config/db.config.js";
import logger from "./logger.js";
import { NODE_DEAD_SECONDS } from "./role.js";
import { die } from "./die.js";

export const WORKER_LOCK = "ansibleforms_worker";
const LOCK_RETRY_MS = 10000;
// every query on the lock connection : a socket that went silent must fail, not hang the check
const QUERY_TIMEOUT_MS = 5000;

let conn = null;
let held = false;
// why the last attempt did not get the lock : 'busy' (another process has it) or 'unreachable'
let lastMiss = null;
// the connection seen holding the lock, and since when : a holder that never goes away while no
// worker heartbeats is a dead host's session
let suspect = { id: null, since: 0 };
let lastTakeoverWarning = 0;

export function holdsWorkerLock() {
  return held;
}

export function workerLockMiss() {
  return lastMiss;
}

function query(sql, values) {
  return conn.query({ sql, values, timeout: QUERY_TIMEOUT_MS });
}

async function dropConnection() {
  const c = conn;
  conn = null;
  held = false;
  if (c) {
    try {
      c.destroy();
    } catch { /* gone already */ }
  }
}

// one attempt, never waits for the lock
export async function tryWorkerLock() {
  if (held) return true;
  try {
    if (!conn) {
      conn = await client.createConnection({
        host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password,
        connectTimeout: QUERY_TIMEOUT_MS, enableKeepAlive: true, keepAliveInitialDelay: 10000,
      });
      // a lost connection is noticed by the next check ; this only keeps it from
      // becoming an uncaught error
      conn.on("error", (e) => logger.debug(`The worker lock connection : ${e.message || e}`));
    }
    const [rows] = await query("SELECT GET_LOCK(?, 0) AS got", [WORKER_LOCK]);
    held = rows?.[0]?.got === 1;
    lastMiss = held ? null : "busy";
    return held;
  } catch (e) {
    logger.warning(`Could not ask the database for the worker lock : ${e.message || e}`);
    lastMiss = "unreachable";
    await dropConnection();
    return false;
  }
}

// Is the lock still ours ? Asked of the database, on the lock connection : a proxy (ProxySQL,
// MaxScale) can keep this connection alive across a failover while the lock went with the old
// backend, and `SELECT 1` would answer for the connection, not for the lock.
async function stillMine() {
  // the connection was dropped already (the database went away) : not ours until taken again
  if (!conn) {
    held = false;
    return false;
  }
  try {
    const [rows] = await query("SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS mine", [WORKER_LOCK]);
    if (rows?.[0]?.mine === 1) return true;
  } catch (e) {
    logger.warning(`The worker lock connection does not answer : ${e.message || e}`);
  }
  await dropConnection();
  return false;
}

// Waiting, and the lock is busy : is its holder a dead host's session ? Killed only when the same
// connection held it for longer than NODE_DEAD_SECONDS and no worker heartbeats meanwhile - a
// live worker writes is_worker=1 every 10 s.
async function takeFromDeadHolder() {
  try {
    const [used] = await query("SELECT IS_USED_LOCK(?) AS holder", [WORKER_LOCK]);
    const holder = used?.[0]?.holder;
    if (holder == null) return;
    if (holder !== suspect.id) {
      suspect = { id: holder, since: Date.now() };
      return;
    }
    if (Date.now() - suspect.since < NODE_DEAD_SECONDS * 1000) return;
    const [alive] = await query(
      "SELECT COUNT(*) AS n FROM AnsibleForms.`nodes` WHERE is_worker=1 AND last_seen > (NOW() - INTERVAL ? SECOND)",
      [NODE_DEAD_SECONDS]);
    if (Number(alive?.[0]?.n) > 0) return;
    logger.warning(`The worker lock is held by database connection ${holder}, and no worker has answered for ${NODE_DEAD_SECONDS} seconds : ending that connection to take over`);
    await query(`KILL ${Number(holder)}`);
    suspect = { id: null, since: 0 };
  } catch (e) {
    // no nodes table yet, or KILL refused (another database user) : keep waiting - and say so
    // once the holder has been suspect for long enough, or nobody ever learns why no worker
    // takes over
    const overdue = suspect.id != null && Date.now() - suspect.since >= NODE_DEAD_SECONDS * 1000;
    if (overdue && Date.now() - lastTakeoverWarning > 10 * 60 * 1000) {
      lastTakeoverWarning = Date.now();
      logger.warning(`The worker lock holder (connection ${suspect.id}) may be dead, but it cannot be taken over : ${e.message || e}`);
    } else {
      logger.debug(`Could not check the worker lock holder : ${e.message || e}`);
    }
  }
}

// a clean stop : the lock goes now, so a waiting worker takes over at once
export async function releaseWorkerLock() {
  const c = conn;
  conn = null;
  held = false;
  if (!c) return;
  try {
    await c.query({ sql: "SELECT RELEASE_LOCK(?)", values: [WORKER_LOCK], timeout: QUERY_TIMEOUT_MS });
    await c.end();
  } catch {
    try { c.destroy(); } catch { /* gone already */ }
  }
}

/**
 * Takes the lock as soon as it is free, then calls onAcquired once. After that it checks every
 * LOCK_RETRY_MS that the lock is still ours. When the connection died (a database restart) it
 * takes the lock again ; when another process got it first, onLost is called - two workers must
 * never both believe they hold it, so the caller stops (the worker exits and its container
 * restarts as the one waiting).
 *
 * A worker whose start fails after taking the lock stops the process : holding the lock while
 * doing nothing would keep every other worker from taking over.
 */
export function keepWorkerLock({ onAcquired, onWaiting, onLost }) {
  // a caller that took the lock itself (tryWorkerLock) and already started its work
  let acquired = held;
  let warned = false;
  const tick = async () => {
    try {
      if (!acquired) {
        if (await tryWorkerLock()) {
          acquired = true;
          logger.notice("This process holds the worker lock : it runs the schedules, backups, syncs and cleanups");
          // not awaited : a worker waiting for a schema keeps checking its lock meanwhile
          Promise.resolve().then(onAcquired).catch((e) => die(`The worker failed to start, stopping so another can take over : ${e.message || e}`));
          return;
        }
        if (lastMiss === "busy") {
          if (!warned) {
            warned = true;
            onWaiting?.();
          }
          await takeFromDeadHolder();
        }
        return;
      }
      if (await stillMine()) return;
      if (await tryWorkerLock()) {
        logger.warning("The worker lock was lost and has been taken again");
        return;
      }
      // reachable, and somebody else has the lock now ; unreachable : keep trying, nothing
      // else can take the lock either
      if (lastMiss === "busy") onLost();
    } catch (e) {
      logger.error(`Worker lock check failed : ${e.message || e}`);
    } finally {
      setTimeout(tick, LOCK_RETRY_MS).unref?.();
    }
  };
  tick();
}
