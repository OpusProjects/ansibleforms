//- MYSQL Module — shared connection pool
//
// All queries go through a single shared mysql2 connection pool (no more
// per-request createConnection/end cycles). Public API:
//   mysql.do(query, vars)  - run a query on a pool connection
//   mysql.end()            - close the pool (graceful shutdown)
//
// NOTE: multipleStatements is left enabled because schema bootstrap may run
// multi-statement DDL via mysql.do at startup. All runtime queries use
// parameterized `?` placeholders, so this does not introduce SQL injection
// risk in normal operation. Be careful when adding any code that concatenates
// user input into a query string.
import logger from '../lib/logger.js';
import dbConfig from '../../config/db.config.js';
import client from 'mysql2/promise';
import appConfig from '../../config/app.config.js';

const poolConfig = { ...dbConfig };
delete poolConfig.name;           // unsupported property
delete poolConfig.is_database;    // unsupported property
poolConfig.multipleStatements = true;
poolConfig.connectionLimit = parseInt(process.env.DB_POOL_SIZE || '20', 10);
poolConfig.waitForConnections = true;
poolConfig.queueLimit = 0;        // queue indefinitely (surfaces as latency, not errors)
poolConfig.enableKeepAlive = true;
poolConfig.keepAliveInitialDelay = 10000;

// `let`, so DB_POOL_SIZE can be changed without a restart. mysql2 fixes connectionLimit when
// the pool is created, so a new size means a new pool.
//
// This is safe here for one specific reason: MySql.transaction takes a CONNECTION out of the
// pool and holds that, not the pool reference - so a swap mid-transaction cannot split it
// across two pools. Single queries through MySql.do are atomic. Only new acquisitions see the
// new pool, and the old one is drained rather than killed: mysql2's end() waits for its
// connections to be released.
let pool;

function attachPoolLogging(p) {
  p.on('connection', (conn) => {
    logger.debug(`[ansibleforms] new pool connection (threadId ${conn.threadId})`);
  });
  return p;
}

pool = attachPoolLogging(client.createPool(poolConfig));

const MySql = {};

/**
 * Applies a new DB_POOL_SIZE without a restart. The replacement pool takes new work; the old
 * one is asked to end, which mysql2 does only once its connections are released - so an
 * in-flight query or transaction finishes on the pool it started on.
 */
MySql.resizePool = function (connectionLimit) {
  const size = parseInt(connectionLimit, 10);
  if (!size || size < 1) return false;
  if (size === poolConfig.connectionLimit) return true;
  const previous = pool;
  let next;
  try {
    // Built from a COPY, and poolConfig is only updated once the pool exists. Assigning
    // the new size first left the config and the live pool disagreeing whenever
    // createPool threw - and the early return above then read the config, so the very
    // next attempt at the same size answered `true` without creating anything. The
    // settings page reported DB_POOL_SIZE as applied while the old pool was still in use.
    next = attachPoolLogging(client.createPool({ ...poolConfig, connectionLimit: size }));
  } catch (e) {
    logger.error(`[ansibleforms] could not resize the pool, keeping the current one : ${e.message}`);
    return false;
  }
  poolConfig.connectionLimit = size;
  pool = next;
  // not awaited : draining waits on whatever is still running, and the caller must not
  logger.notice(`[ansibleforms] connection pool resized to ${size}, draining the previous one`);
  Promise.resolve(previous.end()).catch((e) => {
    logger.warning(`[ansibleforms] the previous pool did not close cleanly : ${e.message}`);
  });
  return true;
};

/**
 * Run a query using a pool connection. Connection is auto-released.
 */
MySql.do = async function (query, vars, silent = false) {
  if (!silent && appConfig.enableDbQueryLogging) {
    logger.info('[ansibleforms] running query : ' + query);
  }
  try {
    const [result] = await pool.query(query, vars);
    if (!silent && appConfig.enableDbQueryLogging) {
      logger.debug('[ansibleforms] query result : ' + JSON.stringify(result));
    }
    return result;
  } catch (err) {
    logger.error('[ansibleforms] Query error : ' + err);
    throw err;
  }
};

/**
 * MySql.do without the error log, for the queries that run every few seconds in every process
 * (the node heartbeat, the cache epochs) : before the schema has their tables, each would log
 * an error per tick. The caller handles the rejection.
 */
MySql.tryDo = async function (query, vars) {
  const [result] = await pool.query(query, vars);
  return result;
};

/**
 * Run fn while holding the named database lock (GET_LOCK), so two processes on the same
 * database never run it at the same time - two workers creating the schema on an empty
 * database, for one. GET_LOCK belongs to a connection, so the lock is taken and released on
 * one held connection ; the work itself goes through the pool. Waits up to timeoutSeconds for
 * the lock, then throws.
 */
MySql.withLock = async function (name, timeoutSeconds, fn) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [name, timeoutSeconds]);
    if (rows?.[0]?.got !== 1) throw new Error(`Timed out waiting for the database lock '${name}'`);
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => {});
    }
  } finally {
    conn.release();
  }
};

/**
 * Run several statements on ONE pooled connection, inside a transaction. The
 * callback is handed a `do(query, vars)` bound to that connection ; throwing from
 * it rolls everything back, returning commits. MySql.do takes a fresh connection
 * per call, so it can not carry a transaction - use this whenever two writes must
 * not be able to apply by halves.
 *
 * Caveat, on mysql : DDL (ALTER/CREATE/DROP) implicitly commits the transaction
 * before it runs and can not be rolled back afterwards, so a statement that has
 * to be undoable must come BEFORE any DDL in the callback.
 */
MySql.transaction = async function (fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(async (query, vars) => {
      if (appConfig.enableDbQueryLogging) {
        logger.info('[ansibleforms] running query (tx) : ' + query);
      }
      const [res] = await conn.query(query, vars);
      return res;
    });
    await conn.commit();
    return result;
  } catch (err) {
    logger.error('[ansibleforms] Transaction error, rolling back : ' + err);
    try {
      await conn.rollback();
    } catch (e) {
      // a lost connection can not be rolled back ; the server drops the
      // transaction on disconnect anyway
    }
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Run a query on a DEDICATED connection that is always DESTROYED afterwards, never
 * returned to the pool.
 *
 * For the multi-statement schema script, which changes SESSION state: it opens with
 * `SET FOREIGN_KEY_CHECKS=0` and `USE AnsibleForms` and only restores the flag in its
 * last statement. Through MySql.do (pool.query) a failure part way through handed a
 * connection back to the pool with foreign keys still DISABLED - so one of the 20
 * connections silently stopped honouring `ON DELETE CASCADE`, and a job deletion that
 * happened to land on it orphaned its job_output rows for good.
 *
 * The connection is discarded on SUCCESS too, because `USE AnsibleForms` also persists:
 * a connection carrying a default schema makes unqualified table names work on that one
 * connection and fail with "No database selected" on every other, which is worse than
 * failing consistently. One connection is nothing - this runs once per install.
 */
MySql.runIsolated = async function (query, vars) {
  const conn = await pool.getConnection();
  try {
    const [res] = await conn.query(query, vars);
    return res;
  } finally {
    // destroy, not release : the session state this ran cannot be trusted either way
    try {
      conn.destroy();
    } catch (e) {
      logger.warning('[ansibleforms] Could not destroy the isolated connection : ' + e.message);
    }
  }
};

/**
 * Close the pool (graceful shutdown).
 */
MySql.end = async function () {
  try {
    await pool.end();
  } catch (err) {
    logger.error('[ansibleforms] Pool end error : ' + err);
  }
};

MySql.pool = pool;

export default MySql;
