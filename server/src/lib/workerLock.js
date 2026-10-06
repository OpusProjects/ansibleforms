// One worker at a time : the background work (schema, seed, schedules, backups, repository
// syncs, cleanups) runs only in the process holding the database lock `ansibleforms_worker`.
//
// GET_LOCK belongs to a connection, so the lock lives on a connection of its own, kept open
// for as long as this process is the worker. A worker that dies drops that connection and
// the database frees the lock at once ; a waiting worker (or an AF_ROLE unset process) takes
// it on its next try, within LOCK_RETRY_MS.
//
// Galera and group replication do not share GET_LOCK between their nodes : point every
// worker at the same database node.
import client from "mysql2/promise";
import dbConfig from "../../config/db.config.js";
import logger from "./logger.js";

export const WORKER_LOCK = "ansibleforms_worker";
const LOCK_RETRY_MS = 10000;

let conn = null;
let held = false;

export function holdsWorkerLock() {
  return held;
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
        enableKeepAlive: true, keepAliveInitialDelay: 10000,
      });
      // a lost connection is noticed by the next check ; this only keeps it from
      // becoming an uncaught error
      conn.on("error", (e) => logger.debug(`The worker lock connection : ${e.message || e}`));
    }
    const [rows] = await conn.query("SELECT GET_LOCK(?, 0) AS got", [WORKER_LOCK]);
    held = rows?.[0]?.got === 1;
    return held;
  } catch (e) {
    logger.debug(`Could not ask for the worker lock : ${e.message || e}`);
    await dropConnection();
    return false;
  }
}

// is the lock held by anyone (this process or another) ?
export async function workerLockInUse(mysql) {
  const rows = await mysql.do("SELECT IS_USED_LOCK(?) AS holder", [WORKER_LOCK], true);
  return rows?.[0]?.holder != null;
}

/**
 * Takes the lock as soon as it is free, then calls onAcquired once. After that it checks the
 * lock connection every LOCK_RETRY_MS. When the connection died (a database restart) it takes
 * the lock again ; when another process got it first, onLost is called - two workers must
 * never both believe they hold it, so the caller stops (the worker exits and its container
 * restarts as the one waiting).
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
          Promise.resolve().then(onAcquired).catch((e) => logger.error(`The worker failed to start : ${e.message || e}`));
        } else if (!warned) {
          warned = true;
          onWaiting?.();
        }
        return;
      }
      try {
        await conn.query("SELECT 1");
      } catch {
        await dropConnection();
      }
      if (held) return;
      if (await tryWorkerLock()) {
        logger.warning("The worker lock connection was lost and has been taken again");
        return;
      }
      if (conn) {
        // reachable, and somebody else has the lock now
        onLost();
      }
      // the database is unreachable : keep trying, nothing else can take the lock either
    } catch (e) {
      logger.error(`Worker lock check failed : ${e.message || e}`);
    } finally {
      setTimeout(tick, LOCK_RETRY_MS).unref?.();
    }
  };
  tick();
}
