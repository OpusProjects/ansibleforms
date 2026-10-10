/******************************************************************/
/*                                                                */
/*  Live events : the server's stream of what changes (GET        */
/*  /api/v2/events, server/src/lib/liveEvents.js). An event is a  */
/*  name ('jobs') : who listens re-reads what it shows through    */
/*  the api.                                                      */
/*                                                                */
/*  One stream per browser, not per tab : the tabs elect one      */
/*  (navigator.locks) that holds the stream and passes the events */
/*  on to the others (BroadcastChannel). A browser allows six     */
/*  connections to a site over HTTP/1.1 : a stream per tab would  */
/*  have blocked the seventh tab from loading anything. When that */
/*  tab closes, the lock passes to another, which opens it again. */
/*                                                                */
/*  The stream reconnects by itself (2 s, then up to 30 s) ; a    */
/*  new or renewed stream tells every listener to re-read         */
/*  ('resync'), so what changed while it was down is not missed.  */
/*  Each listener hears a name at most once a second.             */
/*                                                                */
/******************************************************************/
import TokenStorage from '@/lib/TokenStorage';

const LOCK = 'af-live-events';
const CHANNEL = 'af-live-events';
const RESYNC = 'resync';

const listeners = new Map(); // name -> Set of listener
let channel = null; // the tabs' channel
let releaseLock = null; // the leader's lock, released to step down
let controller = null; // the leader's stream, aborted to stop it
let started = false;

// ─── delivering ─────────────────────────────────────────────────────────────

/**
 * Hands a name to its listeners ; 'resync' reaches every listener.
 *
 * Args:
 *   name (string): what changed, or 'resync'.
 */
function deliver(name) {
  const targets =
    name === RESYNC ? [...listeners.values()].flatMap((set) => [...set]) : [...(listeners.get(name) || [])];
  for (const listener of targets) listener.hear();
}

/**
 * A listener that hears its name at most once a second : the first at once, the last of a
 * burst a second later (the page re-reads once for a hundred output lines).
 *
 * Args:
 *   fn (function): what to do when it changed.
 *
 * Returns:
 *   object: { hear, stop }.
 */
function throttled(fn) {
  let last = 0;
  let timer = null;
  const run = () => {
    last = Date.now();
    timer = null;
    Promise.resolve()
      .then(fn)
      .catch(() => {});
  };
  return {
    hear() {
      if (timer) return;
      const wait = last + 1000 - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

// ─── the stream (the leader tab) ────────────────────────────────────────────

/**
 * Reads the stream until it ends, handing on each event : to this tab, and to the others.
 *
 * Args:
 *   body (ReadableStream): the response's body.
 */
async function read(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!frame.split('\n').some((line) => line === 'event: changed') || !data) continue;
      try {
        const { name } = JSON.parse(data);
        if (!name) continue;
        deliver(name);
        channel?.postMessage(name);
      } catch {
        // a frame that is not ours : skipped
      }
    }
  }
}

/**
 * Holds the stream for as long as this tab leads : opens it (with the session's token, which
 * EventSource could not send), re-reads everything once it is open, and opens it again when
 * it drops - after 2 s, doubling up to 30 s while it keeps failing.
 */
async function lead() {
  let delay = 2000;
  while (releaseLock) {
    controller = new AbortController();
    try {
      let res = await fetch('/api/v2/events', { ...TokenStorage.getAuthentication(), signal: controller.signal });
      if (res.status === 401 && (await TokenStorage.getNewToken())) {
        res = await fetch('/api/v2/events', { ...TokenStorage.getAuthentication(), signal: controller.signal });
      }
      if (res.ok && res.body) {
        delay = 2000;
        // open : what changed while it was not is re-read
        deliver(RESYNC);
        channel?.postMessage(RESYNC);
        await read(res.body);
      }
    } catch {
      // dropped or refused : tried again below
    }
    if (!releaseLock) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 30000);
  }
}

// ─── starting and stopping ──────────────────────────────────────────────────

/**
 * Joins the tabs : listens to the leader's channel, and asks to lead - the lock is granted
 * when no other tab holds it, at once or when the leader closes.
 */
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => deliver(e.data);
  }
  const becomeLeader = () =>
    new Promise((release) => {
      releaseLock = release;
      lead();
    });
  if (navigator.locks?.request) {
    navigator.locks.request(LOCK, becomeLeader).catch(() => {});
  } else {
    // no locks (an old browser) : this tab holds a stream of its own
    becomeLeader();
  }
}

/**
 * Leaves : the stream closed and the lock released (another tab may lead), the channel closed.
 */
function stop() {
  if (!started) return;
  started = false;
  const release = releaseLock;
  releaseLock = null;
  controller?.abort();
  release?.();
  channel?.close();
  channel = null;
}

// ─── listening ──────────────────────────────────────────────────────────────

/**
 * Listens to a name : `fn` runs when it changed, and when the stream (re)opens. The stream
 * runs while anything listens.
 *
 * Args:
 *   name (string): what to hear - 'jobs'.
 *   fn (function): what to do, at most once a second.
 *
 * Returns:
 *   function: stops listening.
 */
export function listen(name, fn) {
  const listener = throttled(fn);
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
  start();
  return () => {
    listener.stop();
    listeners.get(name)?.delete(listener);
    if (![...listeners.values()].some((set) => set.size)) stop();
  };
}

export default { listen };
