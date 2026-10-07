// "Something changed" between the processes on one database, without Redis.
//
// Each process keeps caches (CrudModel's per-model cache, the secret cache, the OIDC
// strategies, the live environment settings, the worker's cron registry). A change made on
// one app node used to reach only that node's caches ; the others served the old row for up
// to an hour. Now a change bumps a counter in `cache_epochs` under a name (a CrudModel model
// name, or 'env', 'seed', 'restore'), every process reads the table every few seconds, and
// for a name whose counter moved it runs what subscribed to it.
//
// Only names and counters are stored - never a value, so no secret passes through here.
import logger from "./logger.js";
import mysql from "../models/db.model.js";

const subscribers = new Map(); // name ('*' = every name) -> [fn]
let seen = null;               // name -> version, null until the first read
let timer = null;

export function onEpoch(name, fn) {
  if (!subscribers.has(name)) subscribers.set(name, []);
  subscribers.get(name).push(fn);
}

// Never throws and is never awaited by a write : a missing table (an install whose schema is
// not patched yet) or a database hiccup costs the other nodes a few seconds of staleness,
// never the write that caused it.
export function bump(name) {
  return Promise.resolve()
    // never backwards, and never back to a value a process saw : a restore of an older dump
    // once set a counter back, and the bump after it landed on the value every node already
    // had - so none of them dropped their caches. The clock in milliseconds is always ahead.
    .then(() => mysql.tryDo(
      "INSERT INTO AnsibleForms.`cache_epochs` (name, version) VALUES (?, ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000)) " +
        "ON DUPLICATE KEY UPDATE version = GREATEST(version + 1, ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000))",
      [name],
    ))
    .catch((e) => logger.debug(`Could not bump the '${name}' epoch : ${e.message || e}`));
}

async function fire(name) {
  for (const fn of [...(subscribers.get(name) || []), ...(subscribers.get("*") || [])]) {
    try {
      await fn(name);
    } catch (e) {
      logger.error(`Reacting to a change of '${name}' failed : ${e.message || e}`);
    }
  }
}

// One read ; the first one only records where every counter stands.
export async function pollEpochs() {
  let rows;
  try {
    rows = await mysql.tryDo("SELECT name, version FROM AnsibleForms.`cache_epochs`");
  } catch (e) {
    logger.debug(`Could not read the cache epochs : ${e.message || e}`);
    return [];
  }
  const now = new Map(rows.map((r) => [r.name, Number(r.version)]));
  if (seen === null) {
    seen = now;
    return [];
  }
  const changed = [...now].filter(([name, version]) => seen.get(name) !== version).map(([name]) => name);
  seen = now;
  for (const name of changed) await fire(name);
  return changed;
}

export function startEpochs(intervalMs = 5000) {
  if (timer) return;
  const tick = () => {
    pollEpochs().finally(() => {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    });
  };
  tick();
}

// tests only
export function resetEpochs() {
  if (timer) clearTimeout(timer);
  timer = null;
  seen = null;
  subscribers.clear();
}
