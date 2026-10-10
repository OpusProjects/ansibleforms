// The app's side of an RTE job (server/src/runners/rte.js) : the hand-over, and what the job
// says when it does not go as planned. The RTE's answers and the jobs row are faked.
import { test, describe, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// what the RTE answers a POST /jobs, and a GET /jobs/:id
let postAnswer;
let getStatus = "running";
// whether the RTE that claimed the job (jobs.host) heartbeats
let claimerAlive = false;
const posted = [];
vi.mock("axios", () => ({
  default: {
    create: () => ({
      post: async (url, body) => { posted.push({ url, body }); return postAnswer(); },
      get: async () => ({ data: { status: getStatus } }),
    }),
  },
}));

// the jobs row : what the RTE claimed and how it ended
let row;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql) => {
      if (/^SELECT host FROM/.test(sql)) return [{ host: row.host }];
      if (/JOIN AnsibleForms.`nodes` n ON n.id = j.host/.test(sql)) return claimerAlive ? [{ alive: 1 }] : [];
      if (/^SELECT extravars, credentials FROM/.test(sql)) return [{ extravars: JSON.stringify(row.extravars || {}), credentials: JSON.stringify(row.credentials || {}) }];
      if (/^SELECT status FROM/.test(sql)) return [{ status: row.status }];
      return [];
    },
    tryDo: async () => [],
  },
}));

// the credentials table, resolved by the app : by name
let credentialError = null;
vi.mock("../src/models/credential.model.v2.js", () => ({
  default: {
    resolveCredentialMap: async (map) => {
      if (credentialError) throw credentialError;
      return Object.fromEntries(Object.entries(map || {}).map(([k, name]) => [k, { user: `${name}-user`, password: `${name}-pw` }]));
    },
    resolveCredential: async (name) => ({ user: `${name}-user`, password: `${name}-pw` }),
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
const { openJobSecrets } = await import("../src/lib/sealedSecrets.js");
const runner = { name: "rte-1", type: "rte", uri: "http://rte:8000", token: "t" };
const refused = (status, error) => () => Promise.reject(Object.assign(new Error("refused"), { response: { status, data: { error } } }));
const noAnswer = () => Promise.reject(Object.assign(new Error("timeout of 10000ms exceeded"), { code: "ECONNABORTED" }));

beforeEach(() => {
  row = { status: "running", host: null };
  credentialError = null;
  getStatus = "running";
  claimerAlive = false;
  ended.length = 0;
  posted.length = 0;
  abortResets = 0;
});

describe("the hand-over", () => {
  test("the job id, the app's contract and the job's secrets sealed for that RTE go to the RTE", async () => {
    row.extravars = { __credentials__: { db: "cmdb" }, __ansibleCredentials__: "ssh", __vaultCredentials__: "vault" };
    postAnswer = async () => { row.host = "rte-1-8000"; setTimeout(() => { row.status = "success"; }, 50); return { status: 202 }; };
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(posted[0].url, "/jobs");
    assert.equal(posted[0].body.jobId, 7);
    assert.equal(posted[0].body.contract, RTE_CONTRACT);
    assert.equal(JSON.stringify(posted[0].body).includes("cmdb-pw"), false, "no secret in clear");
    assert.deepEqual(openJobSecrets(posted[0].body.sealed, runner.token, 7), {
      credentials: { db: { user: "cmdb-user", password: "cmdb-pw" } },
      ansible: { user: "ssh-user", password: "ssh-pw" },
      vault: { password: "vault-pw" },
    });
    assert.throws(() => openJobSecrets(posted[0].body.sealed, runner.token, 8), /do not open/, "for that job only");
    assert.equal(ok, true, "followed until the RTE wrote success");
    assert.equal(ended.length, 0, "the RTE ends the job, not the app");
  });

  test("secrets that cannot be resolved fail the job before anything is handed over", async () => {
    credentialError = new Error("secret store unreachable");
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, false);
    assert.equal(posted.length, 0);
    assert.match(ended[0].line, /could not prepare the job's credentials for the RTE : secret store unreachable/);
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

  test("no answer, and the RTE already ran and ended it : its success stands, no second end", async () => {
    // a short playbook : claimed, run, ended - and the RTE clears jobs.host at the end
    postAnswer = async () => { row.status = "success"; row.host = null; return noAnswer(); };
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, true);
    assert.equal(row.status, "success", "a lost answer must not turn a success into failed");
    assert.equal(ended.length, 0, "no second end line, no second mail");
  });

  test("no answer, but the RTE claimed it : the app follows the job, it never fails a running one", async () => {
    postAnswer = async () => { row.host = "rte-1-8000"; setTimeout(() => { row.status = "success"; }, 50); return noAnswer(); };
    const ok = await rte.launch({ jobId: 7, runner });
    assert.equal(ok, true);
    assert.equal(ended.length, 0, "no 'failed' end, no second mail");
  });
});

describe("replicas behind one address", () => {
  // the app asks the RTE every 30 polls of a second ; two `unknown` answers in a row used to fail
  // the job, though another replica behind the same address was running it fine
  test("a replica that does not run it says unknown, the one that claimed it is alive : followed on", async () => {
    getStatus = "unknown";
    claimerAlive = true;
    vi.useFakeTimers();
    try {
      postAnswer = async () => { row.host = "rte-2-8000"; return { status: 202 }; };
      const done = rte.launch({ jobId: 7, runner });
      await vi.advanceTimersByTimeAsync(95000);
      expect(ended).toEqual([]);
      row.status = "success";
      await vi.advanceTimersByTimeAsync(2000);
      expect(await done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("nobody alive holds it : it is lost, and failed once", async () => {
    getStatus = "unknown";
    claimerAlive = false;
    vi.useFakeTimers();
    try {
      postAnswer = async () => { row.host = "rte-2-8000"; return { status: 202 }; };
      const done = rte.launch({ jobId: 7, runner });
      await vi.advanceTimersByTimeAsync(95000);
      expect(await done).toBe(false);
      expect(ended.length).toBe(1);
      expect(ended[0].line).toMatch(/lost job 7/);
    } finally {
      vi.useRealTimers();
    }
  });
});
