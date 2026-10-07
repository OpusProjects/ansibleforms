// Aborting a multistep must also stop the step that is running. A multistep runs each step
// as a job of its own (jobs.parent_id = the multistep), and that step's runner only watches
// the abort flag of its OWN row. Job.abort flagged only the multistep, so the steps that had
// not started were skipped while the running one - a playbook or an AWX job - carried on to
// the end. An abort during the LAST step was never noticed at all : the multistep ended as
// success and kept its flag, which then refused every later abort of it.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// the jobs table, in memory : just the columns the abort path reads and writes
let jobs;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params = []) => {
      const row = (id) => jobs.find((j) => j.id == id);
      if (/SELECT id FROM AnsibleForms.`jobs` WHERE id = \?/.test(sql)) {
        return row(params[0]) ? [{ id: params[0] }] : [];
      }
      if (/SELECT abort_requested/.test(sql)) {
        return [{ abort_requested: row(params[0])?.abort_requested || 0 }];
      }
      if (/set abort_requested=1 WHERE id=\? AND status='running'/.test(sql)) {
        const j = row(params[0]);
        if (j && j.status === "running" && !j.abort_requested) {
          j.abort_requested = 1;
          return { changedRows: 1 };
        }
        return { changedRows: 0 };
      }
      if (/set abort_requested=0 WHERE id=\?/.test(sql)) {
        row(params[0]).abort_requested = 0;
        return { changedRows: 1 };
      }
      if (/SELECT runner FROM AnsibleForms.`jobs`/.test(sql)) {
        return [{ runner: row(params[0])?.runner ?? null }];
      }
      if (/WHERE parent_id=\? AND status='running'/.test(sql)) {
        return jobs.filter((j) => j.parent_id == params[0] && j.status === "running").map((j) => ({ id: j.id }));
      }
      return { changedRows: 0 };
    },
  },
}));

// the runner a job runs on : the abort reaches it as a direct cancel (since the playbooks run
// on runners, there is no process of the app's own to signal)
let cancels;
vi.mock("../src/models/runner.model.js", () => ({
  default: { findByName: async (name) => ({ name, type: "rte" }) },
}));
vi.mock("../src/runners/index.js", () => ({
  getRunner: () => ({ cancel: async ({ jobId }) => { cancels.push(jobId); } }),
}));

const { default: Job, Multistep } = await import("../src/models/job.model.js");
// the cancel is not awaited by the abort : let it land
const settle = () => new Promise((resolve) => setImmediate(resolve));

const admin = { username: "root", type: "local", roles: ["admin"], options: {} };
const flagged = (id) => !!jobs.find((j) => j.id == id).abort_requested;

let kills;
let killSpy;
beforeEach(() => {
  kills = [];
  cancels = [];
  // never signal a real process
  killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    kills.push([pid, signal]);
    return true;
  });
});
afterEach(() => {
  killSpy.mockRestore();
});

describe("aborting a multistep aborts its running step", () => {
  beforeEach(() => {
    jobs = [
      { id: 10, parent_id: null, status: "running", abort_requested: 0 },
      // step one finished, step two is running a playbook on an RTE
      { id: 11, parent_id: 10, status: "success", abort_requested: 0 },
      { id: 12, parent_id: 10, status: "running", abort_requested: 0, runner: "rte-1" },
      // a running job of another multistep is not touched
      { id: 20, parent_id: 19, status: "running", abort_requested: 0, runner: "rte-1" },
    ];
  });

  test("the running step is flagged and its playbook stopped", async () => {
    await Job.abort(admin, 10);
    await settle();
    assert.equal(flagged(10), true, "the multistep is flagged, so later steps are skipped");
    assert.equal(flagged(12), true, "the running step is flagged, so its runner stops it");
    assert.deepEqual(cancels, [12], "the step's runner is told to cancel it right away");
    assert.deepEqual(kills, [], "no process of the app's own is signalled");
  });

  test("finished steps and other jobs are left alone", async () => {
    await Job.abort(admin, 10);
    assert.equal(flagged(11), false);
    assert.equal(flagged(20), false);
  });

  test("a single job still aborts as before", async () => {
    await Job.abort(admin, 20);
    await settle();
    assert.equal(flagged(20), true);
    assert.deepEqual(cancels, [20]);
    assert.equal(flagged(12), false);
  });

  test("a job that is not running is still refused", async () => {
    await assert.rejects(() => Job.abort(admin, 11), (e) => e.name === "ConflictError");
    assert.equal(kills.length, 0);
  });
});

describe("the multistep ends as aborted when its last step is aborted", () => {
  const saved = {};
  let outputs;
  let ended;
  let beforeLaunch; // runs inside Job.launch, before the step's row exists
  beforeEach(() => {
    jobs = [{ id: 30, parent_id: null, status: "running", abort_requested: 0 }];
    outputs = [];
    ended = null;
    for (const k of ["launch", "findById", "printJobOutput", "update", "endJobStatus"]) saved[k] = Job[k];
    Job.update = async () => {};
    Job.printJobOutput = async (data, type, jobid) => {
      outputs.push(data);
      return flagged(jobid);
    };
    Job.endJobStatus = async (jobid, counter, stream, status, message) => {
      ended = { status, message };
    };
    // each step is a job of its own ; it runs until the test ends it or it is aborted
    beforeLaunch = null;
    Job.launch = async ({ parentId }) => {
      if (beforeLaunch) await beforeLaunch();
      const id = jobs.length + 30;
      const step = { id, parent_id: parentId, status: "running", abort_requested: 0 };
      jobs.push(step);
      const completionPromise = new Promise((resolve) => {
        step.finish = (status) => { step.status = status; resolve(); };
      });
      return { id, completionPromise };
    };
    Job.findById = async (user, id) => ({ status: jobs.find((j) => j.id == id).status });
  });
  afterEach(() => Object.assign(Job, saved));

  // the step's runner : stops when its own flag is set, as Exec.executeCommand does
  const runStep = async (id, abortedWhileRunning) => {
    const step = () => jobs.find((j) => j.id == id);
    while (!step()) await new Promise((r) => setImmediate(r));
    if (abortedWhileRunning) await Job.abort(admin, 30);
    step().finish(step().abort_requested ? "aborted" : "success");
  };

  test("an abort during the last step stops it and marks the multistep aborted", async () => {
    const run = Multistep.launch({
      form: "two steps",
      steps: [{ name: "one", type: "ansible" }, { name: "two", type: "ansible" }],
      user: admin,
      jobid: 30,
    });
    await runStep(31, false);
    await runStep(32, true);
    await run;
    assert.equal(jobs.find((j) => j.id == 32).status, "aborted", "the last step was stopped");
    assert.equal(ended?.status, "aborted", "not success, not failed");
    assert.equal(flagged(30), false, "the flag is reset, so the job can be aborted again later");
  });

  test("an abort during the first step stops it and skips the next", async () => {
    const run = Multistep.launch({
      form: "two steps",
      steps: [{ name: "one", type: "ansible" }, { name: "two", type: "ansible" }],
      user: admin,
      jobid: 30,
    });
    await runStep(31, true);
    await run;
    assert.equal(jobs.find((j) => j.id == 31).status, "aborted", "the running step was stopped");
    assert.equal(jobs.length, 2, "step two never started");
    assert.ok(outputs.includes("skipping: [Abort is requested]"));
    assert.equal(ended?.status, "aborted");
  });

  const twoSteps = (extra = {}) => [
    { name: "one", type: "ansible" },
    { name: "two", type: "ansible", ...extra },
  ];

  test("an abort before the step's row exists still stops that step", async () => {
    // after the STEP header check, before Job.launch inserted the row : Job.abort finds
    // no running step, so only the multistep is flagged - the runner passes it on
    beforeLaunch = async () => {
      if (jobs.length === 2) await Job.abort(admin, 30);
    };
    const run = Multistep.launch({ form: "two steps", steps: twoSteps(), user: admin, jobid: 30 });
    await runStep(31, false);
    await runStep(32, false);
    await run;
    assert.equal(jobs.find((j) => j.id == 32).status, "aborted", "the step got the abort");
    assert.equal(ended?.status, "aborted");
    assert.equal(flagged(30), false);
  });

  test("an abort after every step finished leaves a success, with the flag cleared", async () => {
    const run = Multistep.launch({ form: "two steps", steps: twoSteps(), user: admin, jobid: 30 });
    await runStep(31, false);
    await runStep(32, false);
    // the last step is done, the recap is not written yet
    jobs.find((j) => j.id == 30).abort_requested = 1;
    await run;
    assert.equal(ended?.status, "success");
    assert.equal(flagged(30), false, "a later abort of this job is not refused");
  });

  test("an aborted last step with continue ends the multistep as aborted, not warning", async () => {
    const run = Multistep.launch({
      form: "two steps", steps: twoSteps({ continue: true }), user: admin, jobid: 30,
    });
    await runStep(31, false);
    await runStep(32, true);
    await run;
    assert.equal(ended?.status, "aborted");
    assert.ok(!outputs.includes("CONTINUE on failure"));
    assert.equal(flagged(30), false);
  });

  test("a failed step with continue still continues when nobody aborted", async () => {
    const run = Multistep.launch({
      form: "two steps", steps: twoSteps({ continue: true }), user: admin, jobid: 30,
    });
    await runStep(31, false);
    const step = () => jobs.find((j) => j.id == 32);
    while (!step()) await new Promise((r) => setImmediate(r));
    step().finish("failed");
    await run;
    assert.equal(ended?.status, "warning");
  });
});
