// Live events : the browsers learn that something changed, as it changes, without Redis.
//
// An event is a NAME only ('jobs'), never data : a page that hears it re-reads what it shows
// through the normal API, with the user's own permissions - so nothing private passes here,
// and nothing needs filtering per user (the pattern AWX's UI uses, without its Redis).
//
// Where an event comes from and how it travels :
//   - publish(name), called where the thing changes (Job model : a job created, its status,
//     its output, deleted...). In this process it reaches its own streams at once.
//   - The other processes - an app node behind the same load balancer, the worker, an RTE
//     running the playbook - hear of it through `cache_epochs` (lib/epochs.js), under the
//     name 'live:<name>' : publish bumps that counter, and every app process with a browser
//     watching reads the live counters every second.
//   - Bursts are coalesced : a playbook printing a hundred lines a second publishes 'jobs'
//     at most once a second, here and in the database.
//
// The stream (GET /api/v2/events) is server-sent events, kept alive through proxies : a
// comment line every 15 seconds (under the usual 30-60 s idle timeouts), headers that turn
// proxy buffering off, 2 KB of padding first (some proxies hold back the first bytes), and
// no Node request timeout on it. The client reconnects on its own, and re-reads on reconnect.
import logger from "./logger.js";
import mysql from "../models/db.model.js";
import { bump } from "./epochs.js";

const PREFIX = "live:";
const COALESCE_MS = 1000;
const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

const clients = new Set(); // the open streams of this process : { res }
const pending = new Map(); // name -> timer of a coalesced publish
const lastSent = new Map(); // name -> when this process last published it
let seen = null; // 'live:*' name -> version, as last read
let pollTimer = null;

// ─── sending ────────────────────────────────────────────────────────────────

/**
 * Sends one event to every stream of this process.
 *
 * Args:
 *   name (string): what changed.
 */
function broadcast(name) {
  const frame = `event: changed\ndata: ${JSON.stringify({ name })}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch (e) {
      logger.debug(`Live events : a stream could not be written : ${e.message || e}`);
    }
  }
}

/**
 * Says that something changed : at once to this process's streams, and to the other
 * processes through the 'live:<name>' counter. At most once a second per name : the last
 * change of a burst is always sent (a trailing publish).
 *
 * Never throws and is never awaited : a database hiccup costs the browsers a refresh, never
 * the change that caused it.
 *
 * Args:
 *   name (string): what changed - 'jobs'.
 */
export function publish(name) {
  if (pending.has(name)) return;
  const wait = Math.max(0, (lastSent.get(name) || 0) + COALESCE_MS - Date.now());
  const fire = () => {
    pending.delete(name);
    lastSent.set(name, Date.now());
    broadcast(name);
    bump(PREFIX + name);
  };
  if (wait === 0) {
    pending.set(name, true);
    fire();
  } else {
    const timer = setTimeout(fire, wait);
    timer.unref?.();
    pending.set(name, timer);
  }
}

// ─── hearing the other processes ────────────────────────────────────────────

/**
 * Reads the live counters, and sends the names whose counter moved since the last read. The
 * first read only records where they stand. This process's own publishes come back too :
 * the client coalesces the echo with the event it already had.
 */
export async function pollLive() {
  let rows;
  try {
    rows = await mysql.tryDo("SELECT name, version FROM AnsibleForms.`cache_epochs` WHERE name LIKE 'live:%'");
  } catch (e) {
    logger.debug(`Live events : the counters could not be read : ${e.message || e}`);
    return [];
  }
  const now = new Map((rows || []).map((r) => [r.name, Number(r.version)]));
  if (seen === null) {
    seen = now;
    return [];
  }
  const changed = [...now].filter(([n, v]) => seen.get(n) !== v).map(([n]) => n.slice(PREFIX.length));
  seen = now;
  for (const name of changed) broadcast(name);
  return changed;
}

// The poll runs only while a browser watches : an app node nobody looks at, the worker and
// the RTEs never read the counters.
function startPolling() {
  if (pollTimer) return;
  const tick = () => {
    pollLive().finally(() => {
      if (!clients.size) {
        pollTimer = null;
        seen = null;
        return;
      }
      pollTimer = setTimeout(tick, POLL_MS);
      pollTimer.unref?.();
    });
  };
  tick();
}

// ─── the stream ─────────────────────────────────────────────────────────────

/**
 * GET /api/v2/events : the stream of what changes, for as long as the browser keeps it.
 *
 * Args:
 *   req (object): the request (authenticated by the route).
 *   res (object): the response, kept open.
 */
export function stream(req, res) {
  // a stream lasts : no Node request or socket timeout on it
  req.setTimeout?.(0);
  res.setTimeout?.(0);
  req.socket?.setKeepAlive?.(true);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // no cache, and no proxy may re-encode or hold it back
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  // 2 KB of comment first : a proxy that holds back the first bytes lets the stream through,
  // and how long to wait before reconnecting
  res.write(`:${" ".repeat(2048)}\nretry: 3000\n\n`);
  res.write(`event: hello\ndata: {}\n\n`);
  res.flushHeaders?.();

  const client = { res };
  clients.add(client);
  startPolling();
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // the close handler cleans up
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

// tests only
export function resetLiveEvents() {
  for (const t of pending.values()) if (t !== true) clearTimeout(t);
  pending.clear();
  lastSent.clear();
  clients.clear();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  seen = null;
}
export function clientCount() {
  return clients.size;
}
