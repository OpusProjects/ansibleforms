// An RTE (runtime environment) : the playbook runs in another container (AF_ROLE=rte),
// which reads the job, resolves its credentials and writes the output and the final status
// to the database itself. This side only hands the job over and waits for it to end.
// The RTE's address and token come from its row in the runners table.
import { RTE_CONTRACT } from "../rte/contract.js";
import axios from "axios";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../lib/logger.js";
import mysql from "../models/db.model.js";
import Errors from "../lib/errors.js";
import { stripTrailingSlashes } from "../lib/url.js";
import Job from "../models/job.model.js";

const POLL_MS = 1000;
// how often the RTE itself is asked about the job, in polls
const ASK_RTE_EVERY = 30;

// this app's version : shown next to the RTE's, which may be older (see rte/contract.js)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appVersion = (() => {
  for (const file of ["../../build-info.json", "../../package.json"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), "utf8")).version;
      if (v) return v;
    } catch { /* next */ }
  }
  return "unknown";
})();
// is version a older than b (x.y.z, a prerelease suffix ignored) ?
const older = (a, b) => {
  const parts = (v) => String(v || "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

function client(runner) {
  const url = stripTrailingSlashes(runner.uri || "");
  return {
    url,
    http: axios.create({
      baseURL: `${url}/rte/v1`,
      headers: { Authorization: `Bearer ${runner.token || ""}` },
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: !runner.ignore_certs, ca: runner.ca_bundle || undefined }),
    }),
  };
}

// what the job output (or the connection test) says when the RTE does not take the call
function describe(err, url) {
  const status = err?.response?.status;
  if (status === 401) return `the RTE at ${url} refused the token : check its RTE_TOKEN and the token stored here`;
  if (status === 409) return `the RTE at ${url} did not take the job : ${err.response.data?.error || "conflict"}`;
  if (status) return `the RTE at ${url} answered ${status} : ${err.response.data?.error || err.message}`;
  return `the RTE at ${url} is unreachable : ${err.code || err.message}`;
}

async function failJob(jobId, message) {
  await Job.endJobStatus(jobId, (await Job.lastOrder(jobId)) + 1, "stderr", "failed", `[ERROR]: ${message}`);
  return false;
}

async function dbStatus(jobId) {
  const rows = await mysql.do("SELECT status FROM AnsibleForms.`jobs` WHERE id=?", [jobId], true);
  return rows?.[0]?.status;
}

/** waits until the job is no longer running ; true when it ended in success */
async function track(jobId, rte) {
  let polls = 0;
  let unknown = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const status = await dbStatus(jobId).catch(() => "running");
    if (status !== "running") return status === "success";
    if (++polls % ASK_RTE_EVERY) continue;
    try {
      const { data } = await rte.http.get(`/jobs/${jobId}`);
      // the RTE answers but does not run it, and the row still says running : it is lost
      unknown = data?.status === "unknown" ? unknown + 1 : 0;
      if (unknown >= 2) {
        if ((await dbStatus(jobId)) !== "running") continue;
        return failJob(jobId, `the RTE '${rte.name}' lost job ${jobId}`);
      }
    } catch (err) {
      // unreachable for a while : keep waiting, the RTE writes the end itself, and an RTE
      // that restarts abandons its own jobs, which ends this wait too
      logger.debug(`Job ${jobId} : RTE status check failed : ${err.message}`);
    }
  }
}

/**
 * The RTE's health, with its contract checked against ours. Its release may differ from the
 * app's : an RTE is updated when the contract changes, not with every app release.
 */
async function check(runner) {
  const rte = client(runner);
  let data;
  try {
    ({ data } = await rte.http.get("/health"));
  } catch (err) {
    throw new Errors.BadRequestError(describe(err, rte.url));
  }
  const details = {
    id: data?.id, version: data?.version, contract: data?.contract, ansible: data?.ansible,
    running: data?.running?.length || 0, appVersion,
    // compatible, and older than this app : nothing to do, worth knowing
    olderRelease: older(data?.version, appVersion),
  };
  if (data?.contract !== RTE_CONTRACT) {
    const theirs = data?.contract === undefined ? "no contract (a 7.3 preview build)" : `contract ${data.contract}`;
    const what = (data?.contract || 0) < RTE_CONTRACT ? "update the RTE" : "update this app";
    throw new Errors.BadRequestError(`the RTE at ${rte.url} (${data?.version}) speaks ${theirs}, this app (${appVersion}) needs contract ${RTE_CONTRACT} : ${what}`);
  }
  return details;
}

export default {
  type: "rte",
  capabilities: { playbook: true, template: false },
  check,
  async launch(ctx) {
    const { jobId, runner } = ctx;
    const rte = { ...client(runner), name: runner.name };
    // written before the hand-over, never after : from then on the RTE writes the output
    await Job.printJobOutput(`ok: [Running on RTE ${runner.name} (${rte.url})]`, "stdout", jobId, (await Job.lastOrder(jobId)) + 1);
    try {
      await rte.http.post("/jobs", { jobId });
    } catch (err) {
      return failJob(jobId, describe(err, rte.url));
    }
    return track(jobId, rte);
  },
  // the fast path ; the abort flag in the database reaches the RTE too, within seconds
  async cancel(ctx) {
    const rte = client(ctx.runner);
    try {
      await rte.http.post(`/jobs/${ctx.jobId}/cancel`);
    } catch (err) {
      logger.warning(`Job ${ctx.jobId} : the RTE did not take the cancel (${err.message}) ; the abort flag will stop it`);
    }
  },
};
