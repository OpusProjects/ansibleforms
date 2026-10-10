// The RTE's API (server/src/rte/server.js) : who may call it, which jobs it takes, and what it
// answers about them. The jobs table is faked ; the playbook run itself is rte-ansible.test.mjs.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// the jobs table : id -> { status, job_type, host, abort_requested, pid }
let jobs;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params = []) => {
      if (/^SELECT status, job_type FROM/.test(sql)) {
        const j = jobs[params[0]];
        return j ? [{ status: j.status, job_type: j.job_type }] : [];
      }
      if (/^SELECT status FROM/.test(sql)) {
        const j = jobs[params[0]];
        return j ? [{ status: j.status }] : [];
      }
      if (/SET host=\? WHERE id=\? AND status='running' AND job_type='ansible' AND \(host IS NULL OR host=\?\)/.test(sql)) {
        const [me, id] = params;
        const j = jobs[id];
        if (j && j.status === "running" && j.job_type === "ansible" && (j.host == null || j.host === me)) {
          j.host = me;
          return { affectedRows: 1 };
        }
        return { affectedRows: 0 };
      }
      if (/SET abort_requested=1/.test(sql)) {
        if (jobs[params[0]]) jobs[params[0]].abort_requested = 1;
        return { affectedRows: 1 };
      }
      if (/^SELECT pid FROM/.test(sql)) return [{ pid: null }];
      return [];
    },
    tryDo: async () => [],
  },
}));

// the playbook run : started, never finished, unless a test settles it
let runs;
vi.mock("../src/rte/ansible-core.js", () => ({
  runnerIdentity: () => "rte-test-8000",
  runAnsibleJob: ({ jobId, secrets }) => new Promise((resolve) => { runs.push({ jobId, secrets, resolve }); }),
}));

const { acceptJob, jobStatus, cancelJob, activeJobs, bearer } = await import("../src/rte/server.js");
const { RTE_CONTRACT } = await import("../src/rte/contract.js");
const { sealJobSecrets } = await import("../src/lib/sealedSecrets.js");

// what the app sends : the job, its contract and its secrets sealed with this RTE's token
process.env.RTE_TOKEN = "the-rte-token-of-the-test";
const secrets = { credentials: { db: { user: "u", password: "p" } }, ansible: null, vault: null };
const job = (jobId, extra = {}) => ({ jobId, contract: RTE_CONTRACT, sealed: sealJobSecrets(secrets, process.env.RTE_TOKEN, jobId), ...extra });

function call(handler, { body = {}, params = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    const out = handler({ body, params, headers, ip: "test" }, res, () => resolve({ status: "next" }));
    if (out?.catch) out.catch((e) => resolve({ status: 500, data: e.message }));
  });
}

beforeEach(() => {
  jobs = {
    11: { status: "running", job_type: "ansible", host: null },
    12: { status: "running", job_type: "awx", host: null },
    13: { status: "success", job_type: "ansible", host: null },
    14: { status: "running", job_type: "ansible", host: "rte-other-8000" },
  };
  runs = [];
  activeJobs.clear();
});

describe("only the token opens it", () => {
  const guard = bearer("a-token-of-sixteen-chars");
  test("the right token passes", async () => {
    assert.equal((await call(guard, { headers: { authorization: "Bearer a-token-of-sixteen-chars" } })).status, "next");
  });
  test("a wrong token, a shorter one or none is 401", async () => {
    for (const authorization of ["Bearer a-token-of-sixteen-charX", "Bearer short", undefined]) {
      assert.equal((await call(guard, { headers: { authorization } })).status, 401);
    }
  });
});

describe("the jobs it takes", () => {
  test("a running playbook job is claimed and run, once", async () => {
    const first = await call(acceptJob, { body: job(11) });
    assert.equal(first.status, 202);
    assert.equal(jobs[11].host, "rte-test-8000");
    const again = await call(acceptJob, { body: job(11) });
    assert.equal(again.status, 202, "a repeated call is harmless");
    assert.equal(runs.length, 1, "and does not run it twice");
    assert.deepEqual(runs[0].secrets, secrets, "the run gets the secrets the app sealed");
  });

  test("never an AWX job or a multistep : their own tracker drives them", async () => {
    const r = await call(acceptJob, { body: job(12) });
    assert.equal(r.status, 409);
    assert.equal(jobs[12].host, null, "not claimed");
    assert.equal(runs.length, 0);
  });

  test("a job claimed by another RTE, a finished one or an unknown one is refused", async () => {
    assert.equal((await call(acceptJob, { body: job(14) })).status, 409);
    assert.equal((await call(acceptJob, { body: job(13) })).status, 409);
    assert.equal((await call(acceptJob, { body: job(99) })).status, 404);
    assert.equal((await call(acceptJob, { body: {} })).status, 400);
    assert.equal(runs.length, 0);
  });

  test("an app of another contract is refused before anything is claimed", async () => {
    const r = await call(acceptJob, { body: { jobId: 11, contract: RTE_CONTRACT + 1 } });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /contract/);
    assert.equal(jobs[11].host, null);
  });

  test("a job without its sealed secrets, or sealed for another job or token, is refused before anything is claimed", async () => {
    for (const body of [
      { jobId: 11, contract: RTE_CONTRACT },
      job(11, { sealed: sealJobSecrets(secrets, process.env.RTE_TOKEN, 12) }),
      job(11, { sealed: sealJobSecrets(secrets, "another-rte-token-entirely", 11) }),
      job(11, { sealed: { ...sealJobSecrets(secrets, process.env.RTE_TOKEN, 11), data: sealJobSecrets({ other: 1 }, process.env.RTE_TOKEN, 11).data } }),
    ]) {
      const r = await call(acceptJob, { body });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /sealed secrets/);
    }
    assert.equal(jobs[11].host, null);
    assert.equal(runs.length, 0);
  });
});

describe("what it says about a job", () => {
  test("running while it runs it, finished with the status after, unknown otherwise", async () => {
    await call(acceptJob, { body: job(11) });
    assert.equal((await call(jobStatus, { params: { id: "11" } })).data.status, "running");
    activeJobs.delete(11);
    jobs[11].status = "success";
    assert.deepEqual((await call(jobStatus, { params: { id: "11" } })).data, { jobId: 11, status: "finished", jobStatus: "success" });
    assert.equal((await call(jobStatus, { params: { id: "14" } })).data.status, "unknown", "running, but not here");
  });

  test("cancel : only what it runs itself, and the flag is set", async () => {
    assert.equal((await call(cancelJob, { params: { id: "14" } })).status, 409);
    await call(acceptJob, { body: job(11) });
    assert.equal((await call(cancelJob, { params: { id: "11" } })).status, 202);
    assert.equal(jobs[11].abort_requested, 1);
  });
});
