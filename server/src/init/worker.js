// The worker half of a process : what runs once the process holds the worker lock
// (lib/workerLock.js). In a worker (AF_ROLE=worker) that is all it does ; with AF_ROLE unset
// the same process also serves the web app.
import logger from "../lib/logger.js";
import init, { sleep } from "./index.js";

const SCHEMA_RETRY_MS = 30000;

// The bootstrap and the background tasks. A database without a usable schema is retried :
// the worker has nobody to ask, so it waits for POST /api/v2/schema (on any app node) or a
// patch that could not apply to be fixed, and finishes the bootstrap then.
//
// Resolves after the first attempt, so a process that also serves the web app starts serving -
// the schema page is how a missing schema gets created.
export async function runWorker() {
  if (await init({ boot: true })) return;
  (async () => {
    let ready = false;
    while (!ready) {
      await sleep(SCHEMA_RETRY_MS);
      try {
        ready = await init({ boot: false });
      } catch (err) {
        logger.error("Worker bootstrap failed, retrying : " + (err.message || err));
      }
    }
  })();
}

// Another process holds the worker lock now : stop, rather than run every background task
// twice. A container restarts, and comes back as the process waiting for the lock.
export async function stopLostWorker() {
  const message = "Another process took the worker lock : stopping, so the background work never runs twice";
  logger.error(message);
  console.error(message);
  await sleep(250);
  process.exit(1);
}
