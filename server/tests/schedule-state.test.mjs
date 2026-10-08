// The schedule queue has a concurrency guard that was dead.
//
// (Since 7 the claim is a conditional update : two processes reading the same queued row
// launch it once.)
//
// init/index.js refuses to dequeue while any schedule is state='running', and the cron
// trigger refuses to queue one that is 'running' or 'queued'. But NOTHING ever wrote
// 'running': queue() wrote 'queued' and launch() wrote 'idle' when it was done. So the
// row stayed 'queued' for the whole run and the processor's next pass, 10 seconds later,
// found the same queued schedule and launched it again.
//
// Worse, launch() parsed extra_vars BEFORE its try block, so a schedule whose extra_vars
// were not a dictionary threw out of launch() with the row still 'queued' - and the
// processor picked it straight back up, for ever.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// what Job.launch does, per test
let launched = null;
let launchImpl = async () => ({ id: 42 });
vi.mock("../src/models/job.model.js", () => ({
  default: { launch: async (args) => { launched = args; return launchImpl(args); } },
}));

// the claim is one conditional statement : it takes the row only while it is still 'queued'
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql) => {
      if (/SET state='running',.* WHERE id=\? AND state='queued'/.test(sql)) {
        if (row.state !== "queued") return { affectedRows: 0 };
        row.state = "running";
        writes.push("running");
        return { affectedRows: 1 };
      }
      return [];
    },
    tryDo: async () => [],
  },
}));

// the cron service is only touched for one-time schedules
vi.mock("../src/services/cron.service.js", () => ({
  default: { removeScheduleJob: () => {}, addScheduleJob: () => {} },
}));

const { default: Schedule } = await import("../src/models/schedule.model.js");
const { default: CrudModel } = await import("../src/models/crud.model.js");

// record every state write, in order
let row = {};
let writes = [];
beforeEach(() => {
  launched = null;
  launchImpl = async () => ({ id: 42 });
  row = { id: 1, name: "nightly", form: "myform", extra_vars: "a: 1", one_time_run: 0, state: "queued" };
  writes = [];
  CrudModel.findById = async () => ({ ...row });
  CrudModel.findAll = async () => [{ ...row }];
  CrudModel.update = async (model, data) => {
    if ("state" in data) writes.push(data.state);
    Object.assign(row, data);
    return { changedRows: 1 };
  };
  CrudModel.delete = async () => ({ affectedRows: 1 });
});

describe("a launch claims the schedule", () => {
  test("state goes running BEFORE the work, then back to idle", async () => {
    await Schedule.launch(1);
    assert.deepEqual(writes, ["running", "idle"],
      "without the 'running' write the row stays 'queued' and gets dequeued again");
    assert.ok(launched, "the job must still be launched");
  });

  test("the claim happens before Job.launch is called", async () => {
    let stateWhenLaunched = null;
    launchImpl = async () => { stateWhenLaunched = row.state; return { id: 7 }; };
    await Schedule.launch(1);
    assert.equal(stateWhenLaunched, "running",
      "claiming after the launch would leave the whole run dequeueable");
  });

  test("it ends idle even when the job fails to launch", async () => {
    launchImpl = async () => { throw new Error("boom"); };
    await Schedule.launch(1);
    assert.equal(writes[writes.length - 1], "idle",
      "a stuck 'running' would block every later schedule");
    assert.equal(row.status, "failed");
  });
});

describe("two processes, one launch", () => {
  test("a schedule another process claimed first is not launched again", async () => {
    await Schedule.launch(1);
    launched = null;
    row.state = "running"; // the other process holds it
    await Schedule.launch(1);
    assert.equal(launched, null, "the second launch must find the row no longer queued and stop");
  });
});

describe("a schedule that cannot even be parsed fails once", () => {
  test("bad extra_vars is recorded as failed, not thrown", async () => {
    row.extra_vars = "- just\n- a list";
    // it must NOT reject : a throw left the row 'queued' and the processor retried it
    // every 10 seconds for ever
    await Schedule.launch(1);
    assert.equal(row.status, "failed");
    assert.match(row.output, /not a valid dictionary/);
    assert.equal(writes[writes.length - 1], "idle", "and it must not stay claimed");
    assert.equal(launched, null, "nothing should have been launched");
  });

  test("extra_vars that parse to null are refused with the same message", async () => {
    // typeof null === 'object', so this used to pass the check and die on the spread
    row.extra_vars = "null";
    await Schedule.launch(1);
    assert.equal(row.status, "failed");
    assert.match(row.output, /not a valid dictionary/);
  });

  test("an ordinary dictionary still runs", async () => {
    row.extra_vars = "host: server1";
    await Schedule.launch(1);
    assert.equal(row.status, "success");
    assert.equal(launched.extravars.host, "server1");
  });
});
