// The RTE (runtime environment) : this server started with AF_ROLE=rte. It runs playbooks
// for an AnsibleForms app and nothing else - no web interface, no scheduler, no seed.
//
// It shares the app's database and ENCRYPTION_SECRET, so it reads the job, resolves the
// credentials and writes the output and the final status itself, with the same code the
// only code that runs a playbook (ansible-core.js). The app only says "run job N".
//
//   GET  /rte/v1/health             version, contract, ansible, id, running job ids
//   POST /rte/v1/jobs {jobId}       202 : accepted, runs in the background
//   GET  /rte/v1/jobs/:id           running | finished | unknown
//   POST /rte/v1/jobs/:id/cancel    stops it now (the abort flag in the database works too)
//
// Every call needs `Authorization: Bearer <RTE_TOKEN>`.
import express from "express";
import http from "http";
import https from "https";
import { timingSafeEqual } from "crypto";
import { execFile } from "child_process";
import logger from "../lib/logger.js";
import mysql from "../models/db.model.js";
import httpsConfig from "../../config/https.config.js";
import appConfig from "../../config/app.config.js";
import { runAnsibleJob, runnerIdentity } from "./ansible-core.js";
import { RTE_CONTRACT } from "./contract.js";
import { appVersion as version } from "../lib/version.js";


// the jobs this process is running ; a job is only ever run by the RTE that claimed it
const activeJobs = new Set();

function ansibleVersion() {
  return new Promise((resolve) => {
    execFile("ansible-playbook", ["--version"], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const first = String(stdout).split(/\r?\n/)[0];
      resolve((/\[core\s+([^\]]+)\]/.exec(first) || [])[1] || first.trim());
    });
  });
}

function bearer(token) {
  const expected = Buffer.from(token);
  return (req, res, next) => {
    const given = Buffer.from(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    logger.warning(`RTE : refused a call without the right token from ${req.ip}`);
    return res.status(401).json({ error: "invalid token" });
  };
}

async function waitForDatabase() {
  for (;;) {
    try {
      await mysql.do("SELECT 1");
      return;
    } catch {
      logger.warning("RTE : database not ready yet");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// a job this RTE was running when it stopped cannot finish any more ; only its own jobs
async function abandonOwnJobs() {
  const res = await mysql.do(
    "UPDATE AnsibleForms.`jobs` SET status='abandoned', abort_requested=0 WHERE status='running' AND host=?",
    [runnerIdentity()]
  );
  if (res?.changedRows) logger.warning(`RTE : abandoned ${res.changedRows} job(s) left running by a previous start`);
}

async function acceptJob(req, res) {
  const jobId = parseInt(req.body?.jobId, 10);
  if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ error: "jobId is required" });
  const rows = await mysql.do("SELECT status FROM AnsibleForms.`jobs` WHERE id=?", [jobId]);
  if (!rows.length) return res.status(404).json({ error: `job ${jobId} does not exist` });
  if (rows[0].status !== "running") return res.status(409).json({ error: `job ${jobId} is ${rows[0].status}, not running` });
  // the claim : one runner per job, and a repeated call is harmless
  const me = runnerIdentity();
  const claim = await mysql.do(
    "UPDATE AnsibleForms.`jobs` SET host=? WHERE id=? AND status='running' AND (host IS NULL OR host=?)",
    [me, jobId, me]
  );
  if (!claim.affectedRows) return res.status(409).json({ error: `job ${jobId} is claimed by another runner` });
  if (activeJobs.has(jobId)) return res.status(202).json({ jobId, status: "running" });

  activeJobs.add(jobId);
  logger.notice(`RTE : running job ${jobId}`);
  runAnsibleJob({ jobId })
    .catch((err) => logger.error(`RTE : job ${jobId} failed : ${err.message || err}`))
    .finally(() => activeJobs.delete(jobId));
  return res.status(202).json({ jobId, status: "running" });
}

async function jobStatus(req, res) {
  const jobId = parseInt(req.params.id, 10);
  if (activeJobs.has(jobId)) return res.json({ jobId, status: "running" });
  const rows = await mysql.do("SELECT status FROM AnsibleForms.`jobs` WHERE id=?", [jobId]);
  if (!rows.length || rows[0].status === "running") return res.json({ jobId, status: "unknown" });
  return res.json({ jobId, status: "finished", jobStatus: rows[0].status });
}

async function cancelJob(req, res) {
  const jobId = parseInt(req.params.id, 10);
  if (!activeJobs.has(jobId)) return res.status(409).json({ error: `job ${jobId} is not running here` });
  // the flag first : the runner reports 'aborted' (not 'failed') when it sees it
  await mysql.do("UPDATE AnsibleForms.`jobs` SET abort_requested=1 WHERE id=? AND status='running'", [jobId]);
  const rows = await mysql.do("SELECT pid FROM AnsibleForms.`jobs` WHERE id=?", [jobId]);
  const pid = parseInt(rows[0]?.pid, 10);
  if (pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch (e) {
      logger.debug(`RTE : could not signal job ${jobId} : ${e.message}`);
    }
  }
  return res.status(202).json({ jobId, status: "cancelling" });
}

export async function startRte() {
  const token = process.env.RTE_TOKEN || "";
  if (token.length < 16) {
    console.error("RTE : set RTE_TOKEN (at least 16 characters) ; refusing to start");
    process.exit(1);
  }
  process.on("unhandledRejection", (reason) => logger.error(`RTE : unhandled rejection : ${reason?.stack || reason}`));
  process.on("uncaughtException", (err) => logger.error(`RTE : uncaught exception : ${err?.stack || err}`));

  await waitForDatabase();
  await abandonOwnJobs();
  // the same check, hourly : nothing of ours should still say 'running' after a day
  setInterval(() => {
    mysql.do(
      "UPDATE AnsibleForms.`jobs` SET status='abandoned', abort_requested=0 WHERE status='running' AND host=? AND start < (NOW() - INTERVAL 1 DAY)",
      [runnerIdentity()]
    ).catch((e) => logger.error(`RTE : hourly cleanup failed : ${e.message}`));
  }, 3600 * 1000).unref();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  const api = express.Router();
  api.use(bearer(token));
  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    logger.error(`RTE : ${req.method} ${req.path} : ${err.message || err}`);
    res.status(500).json({ error: err.message || String(err) });
  });
  api.get("/health", wrap(async (req, res) => res.json({
    id: runnerIdentity(),
    version,
    contract: RTE_CONTRACT,
    ansible: await ansibleVersion(),
    running: [...activeJobs],
  })));
  api.post("/jobs", wrap(acceptJob));
  api.get("/jobs/:id", wrap(jobStatus));
  api.post("/jobs/:id/cancel", wrap(cancelJob));
  app.use("/rte/v1", api);

  const port = appConfig.port;
  const server = httpsConfig.https
    ? https.createServer({ key: httpsConfig.httpsKey, cert: httpsConfig.httpsCert }, app)
    : http.createServer(app);
  server.listen(port, () => {
    logger.notice(`RTE '${runnerIdentity()}' ${version} listening on ${httpsConfig.https ? "https" : "http"} port ${port}`);
  });
}
