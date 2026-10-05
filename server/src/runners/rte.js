// An RTE (runtime environment) : the playbook runs in another container (AF_ROLE=rte),
// which reads the job, resolves its credentials and writes the output and the final status
// to the database itself. This side only hands the job over and waits for it to end.
//
// PREVIEW : one RTE, from RTE_URL and RTE_TOKEN (RTE_IGNORE_CERTS=1 for a self-signed
// certificate). The Runners page replaces these.
import axios from "axios";
import https from "https";
import logger from "../lib/logger.js";
import mysql from "../models/db.model.js";
import { stripTrailingSlashes } from "../lib/url.js";
import Job from "../models/job.model.js";
import { lastOrder } from "./ansible-core.js";

const POLL_MS = 1000;
// how often the RTE itself is asked about the job, in polls
const ASK_RTE_EVERY = 30;

export function rteConfigured() {
  return !!process.env.RTE_URL;
}

function client() {
  const url = stripTrailingSlashes(process.env.RTE_URL || "");
  return {
    url,
    http: axios.create({
      baseURL: `${url}/rte/v1`,
      headers: { Authorization: `Bearer ${process.env.RTE_TOKEN || ""}` },
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: process.env.RTE_IGNORE_CERTS !== "1" }),
    }),
  };
}

// what the job output says when the hand-over fails
function describe(err, url) {
  const status = err?.response?.status;
  if (status === 401) return `the RTE at ${url} refused the token : check RTE_TOKEN on both sides`;
  if (status === 409) return `the RTE at ${url} did not take the job : ${err.response.data?.error || "conflict"}`;
  if (status) return `the RTE at ${url} answered ${status} : ${err.response.data?.error || err.message}`;
  return `the RTE at ${url} is unreachable : ${err.code || err.message}`;
}

async function failJob(jobId, message) {
  await Job.endJobStatus(jobId, (await lastOrder(jobId)) + 1, "stderr", "failed", `[ERROR]: ${message}`);
  return false;
}

async function dbStatus(jobId) {
  const rows = await mysql.do("SELECT status FROM AnsibleForms.`jobs` WHERE id=?", [jobId], true);
  return rows?.[0]?.status;
}

/** waits until the job is no longer running ; true when it ended in success */
async function track(jobId, { http, url }) {
  let polls = 0;
  let unknown = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const status = await dbStatus(jobId).catch(() => "running");
    if (status !== "running") return status === "success";
    if (++polls % ASK_RTE_EVERY) continue;
    try {
      const { data } = await http.get(`/jobs/${jobId}`);
      // the RTE answers but does not run it, and the row still says running : it is lost
      unknown = data?.status === "unknown" ? unknown + 1 : 0;
      if (unknown >= 2) {
        if ((await dbStatus(jobId)) !== "running") continue;
        return failJob(jobId, `the RTE at ${url} lost job ${jobId}`);
      }
    } catch (err) {
      // unreachable for a while : keep waiting, the RTE writes the end itself, and an RTE
      // that restarts abandons its own jobs, which ends this wait too
      logger.debug(`Job ${jobId} : RTE status check failed : ${err.message}`);
    }
  }
}

export default {
  type: "rte",
  capabilities: { playbook: true, template: false },
  async launch(ctx) {
    const { jobId } = ctx;
    const rte = client();
    // written before the hand-over, never after : from then on the RTE writes the output
    await Job.printJobOutput(`ok: [Running on RTE ${rte.url}]`, "stdout", jobId, (await lastOrder(jobId)) + 1);
    try {
      await rte.http.post("/jobs", { jobId });
    } catch (err) {
      return failJob(jobId, describe(err, rte.url));
    }
    return track(jobId, rte);
  },
  // the fast path ; the abort flag in the database reaches the RTE too, within seconds
  async cancel(ctx) {
    const rte = client();
    try {
      await rte.http.post(`/jobs/${ctx.jobId}/cancel`);
    } catch (err) {
      logger.warning(`Job ${ctx.jobId} : the RTE did not take the cancel (${err.message}) ; the abort flag will stop it`);
    }
  },
};
