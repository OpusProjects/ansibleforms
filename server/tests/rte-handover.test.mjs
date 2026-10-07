// The app's side of an RTE job (server/src/runners/rte.js) : the hand-over, and what the job
// says when it does not go as planned. The RTE's answers and the jobs row are faked.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// what the RTE answers a POST /jobs
let postAnswer;
const posted = [];
vi.mock("axios", () => ({
  default: {
    create: () => ({
      post: async (url, body) => { posted.push({ url, body }); return postAnswer(); },
      get: async () => ({ data: { status: "running" } }),
    }),
  },
}));

// the jobs row : what the RTE claimed and how it ended
let row;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql) => {
      if (/^SELECT host FROM/.test(sql)) return [{ host: row.host }];
      if (/^SELECT status FROM/.test(sql)) return [{ status: row.status }];
      return [];
    },
    tryDo: async () => [],
  },
}));

const ended = [];
let abortResets;
vi.mock("../src/models/job.model.js", () => ({
  default: {
    lastOrder: async () => 0,
    printJobOutput: async () => {},
    endJobStatus: async (id, order, type, status, line) => { ended.push({ status, line }); row.status = status; },
    resetAbortRequested: async () => { abortResets++; },
  },
}));

const { default: rte } = await import("../src/runners/rte.js");
const { RTE_CONTRACT } = await import("../src/rte/contract.js");
const runner = { name: "rte-1", type: "rte", uri: "http://rte:8000", token: "t" };
const refused = (status, error) => () => Promise.reject(Object.assign(new Error("refused"), { response: { status, data: { error } } }));
const noAnswer = () => Promise.reject(Object.assign(new Error("timeout of 10000ms exceeded"), { code: "ECONNABORTED" }));

beforeEach(() => {
  row = { status: "running", host: null };
  ended.length = 0;
  posted.length = 0;
  abortResets = 0;
});

describe("the hand-over", () => {
  test("the job id and the app's contract go to the RTE", async () => {
    postAnswer = async () => { row.host = "rte-1-8000"; setTimeout(() => { row.status = "success"; }, 50); return { status: 202 }; };
    const ok = await rte.launch({ jobId: 7, runner });
    assert.deepEqual(posted[0], { url: "/jobs", body: { jobId: 7, contract: RTE_CONTRACT } });
    assert.equal(ok, true, "followed until the RTE wrote success");
    assert.equal(ended.length, 0, "the RTE ends the job, not the app");
  });

  test("refused by the RTE (409) : the job fails with the RTE's reason, and an abort flag is cleared", async () => {
    postAnswer = refused(409, "job 7 is claimed by another runner");
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, false);
    assert.equal(ended.length, 1);
    assert.match(ended[0].line, /did not take the job : job 7 is claimed by another runner/);
    assert.equal(abortResets, 1);
  });

  test("a wrong token (401) says to check the token", async () => {
    postAnswer = refused(401);
    await rte.launch({ jobId: 7, runner });
    assert.match(ended[0].line, /refused the token/);
  });

  test("no answer, and the RTE did not claim it : the job fails as unreachable", async () => {
    postAnswer = noAnswer;
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, false);
    assert.match(ended[0].line, /unreachable : ECONNABORTED/);
  });

  test("no answer, but the RTE claimed it : the app follows the job, it never fails a running one", async () => {
    postAnswer = async () => { row.host = "rte-1-8000"; setTimeout(() => { row.status = "success"; }, 50); return noAnswer(); };
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, true);
    assert.equal(ended.length, 0, "no 'failed' end, no second mail");
  });
});
