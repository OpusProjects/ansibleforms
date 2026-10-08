// The worker : AnsibleForms started with AF_ROLE=worker. It runs the background work and
// nothing else - the database bootstrap (schema, admin account, seed), the schedules, the
// nightly backup, the repository syncs and the cleanups - with no web interface or API.
//
// Several may run : one holds the worker lock and works, the others wait and take over when
// it stops (lib/workerLock.js). It needs what the app needs for that work : the database
// (DB_*), ENCRYPTION_SECRET, and the same persistent volume and ~/.ssh as the app nodes
// (forms, repositories, backups).
//
// It listens on PORT for the container healthcheck only :
//   GET <BASE_URL>/api/v2/version   the version, like an app node answers it
//   GET /health                     this node, and whether it holds the worker lock
import express from "express";
import http from "http";
import https from "https";
import logger from "../lib/logger.js";
import httpsConfig from "../../config/https.config.js";
import appConfig from "../../config/app.config.js";
import { nodeId } from "../lib/role.js";
import { appVersion } from "../lib/version.js";
import { holdsWorkerLock, keepWorkerLock, releaseWorkerLock } from "../lib/workerLock.js";
import { onShutdown } from "../lib/shutdown.js";
import cronService from "../services/cron.service.js";
import mysql from "../models/db.model.js";
import { reloadConfigSeed } from "../lib/seed.js";
import { waitForDatabase } from "../init/index.js";
import { startCluster } from "../init/cluster.js";
import { runWorker, stopLostWorker } from "../init/worker.js";
import { die } from "../lib/die.js";
import Job from "../models/job.model.js";

function startHealthServer() {
  const app = express();
  app.disable("x-powered-by");
  app.get(`${appConfig.baseUrl}/api/v2/version`, (req, res) => res.json({ version: appVersion }));
  app.get("/health", (req, res) => res.json({ id: nodeId, role: "worker", version: appVersion, worker: holdsWorkerLock() }));
  const port = appConfig.port;
  const server = httpsConfig.https
    ? https.createServer({ key: httpsConfig.httpsKey, cert: httpsConfig.httpsCert }, app)
    : http.createServer(app);
  // a port that is taken is fatal : a worker that works but answers no healthcheck is restarted
  // over and over, and loses the lock each time
  server.on("error", (err) => die(`Worker : cannot listen on port ${port} : ${err.message}`));
  onShutdown("health server", () => new Promise((resolve) => server.close(() => resolve())));
  server.listen(port, () => logger.notice(`Worker '${nodeId}' ${appVersion} listening on ${httpsConfig.https ? "https" : "http"} port ${port}`));
}

export async function startWorker() {
  process.on("unhandledRejection", (reason) => logger.error("Unhandled promise rejection: ", reason));
  process.on("uncaughtException", (err) => logger.error("Uncaught exception: ", err));

  if (appConfig.encryptionSecretIsDefault) {
    logger.warning('[SECURITY] ENCRYPTION_SECRET is not set. The worker stores and reads credentials (the config seed) with the default key, which is public in the source code : set the same ENCRYPTION_SECRET as the app nodes.');
  }
  await waitForDatabase();
  onShutdown("database", () => mysql.end());
  startHealthServer();
  await startCluster();
  // the jobs this worker followed before it restarted (schedule launches it tracked) : ended now,
  // also when it comes back as the worker waiting for the lock
  Job.abandonOwn(nodeId)
    .then((changed) => { if (changed) logger.warning(`Abandoned ${changed} jobs this worker followed before it restarted`); })
    .catch((err) => logger.error("Failed to abandon jobs : " + (err.message || err)));
  keepWorkerLock({
    onAcquired: runWorker,
    onWaiting: () => logger.notice("Another process holds the worker lock : waiting to take over when it stops"),
    onLost: stopLostWorker,
  });
  onShutdown("worker lock", () => releaseWorkerLock());
  onShutdown("scheduler", () => cronService.stopAll());

  // SIGHUP re-applies the config seed (see app-start.js) - when this is the worker at work
  process.on("SIGHUP", () => {
    if (!holdsWorkerLock()) {
      logger.notice("SIGHUP : this worker is waiting for the lock, the one at work applies the seed");
      return;
    }
    reloadConfigSeed({ force: true, trigger: "SIGHUP" })
      .catch((err) => logger.error("SIGHUP config seed reload failed : " + (err.message || err)));
  });
}
