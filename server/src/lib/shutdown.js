// A clean stop on SIGTERM (docker stop, a kubernetes pod ending) and SIGINT (ctrl-c).
//
// Without a handler node ignores SIGTERM as PID 1, so every stop waited out the grace period and
// ended in SIGKILL : a waiting worker only took over once the database noticed the dead socket,
// and in-flight requests were cut. Each role registers what to close ; they run last-registered
// first (the HTTP server before the database pool it uses), and a stop that hangs is cut short
// before the orchestrator's own SIGKILL.
import logger from "./logger.js";

const STOP_WITHIN_MS = 8000;
const closers = [];
let stopping = false;

export function onShutdown(name, fn) {
  closers.push({ name, fn });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.notice(`${signal} : stopping`);
  setTimeout(() => {
    logger.warning(`Did not stop within ${STOP_WITHIN_MS / 1000} seconds, exiting anyway`);
    process.exit(0);
  }, STOP_WITHIN_MS).unref();
  for (const { name, fn } of [...closers].reverse()) {
    try {
      await fn();
    } catch (e) {
      logger.warning(`Stopping ${name} failed : ${e.message || e}`);
    }
  }
  process.exit(0);
}

export function installShutdown() {
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => shutdown(signal));
}
