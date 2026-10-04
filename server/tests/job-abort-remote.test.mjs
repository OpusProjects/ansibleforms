// Abort travels through the database : Job.abort sets jobs.abort_requested, and the process
// running the playbook - this host or another one - notices it and stops the playbook
// itself. Before, the runner ignored the flag that every output write returns, so a job
// running on another host than the one handling the abort request could not be stopped.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

// the playbook : a fake child the test drives
let child;
const spawned = [];
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: vi.fn((file, args, options) => {
      spawned.push({ file, args, options });
      child = new EventEmitter();
      child.pid = 4242;
      child.signalCode = null;
      child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
      child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
      return child;
    }),
  };
});

const { default: Job, Exec } = await import("../src/models/job.model.js");
const { default: mysql } = await import("../src/models/db.model.js");

// the jobs row and its output, in memory
let jobRow;
let outputs;
let abortChecks;
mysql.do = async function (sql, params) {
  if (sql.includes("INSERT INTO AnsibleForms.`job_output`")) {
    outputs.push({ ...params[0] });
    return { insertId: outputs.length };
  }
  if (sql.includes("set abort_requested=0")) {
    jobRow.abort_requested = 0;
    return { changedRows: 1 };
  }
  if (sql.includes("UPDATE AnsibleForms.`jobs` set ?")) {
    Object.assign(jobRow, params[0]);
    return { changedRows: 1 };
  }
  if (sql.includes("SELECT abort_requested")) {
    abortChecks++;
    return [{ abort_requested: jobRow.abort_requested || 0 }];
  }
  if (sql.includes("SELECT id FROM AnsibleForms.`jobs`")) {
    return [{ id: params[0] }];
  }
  return { changedRows: 1 };
};
Job.sendStatusNotification = async () => {};

// never signal a real process : record the kill and let the fake child die of it
let kills;
let killSpy;
let dir;

beforeEach(() => {
  jobRow = { id: 7, status: "running", abort_requested: 0 };
  outputs = [];
  abortChecks = 0;
  kills = [];
  killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    kills.push([pid, signal]);
    child.signalCode = "SIGTERM";
    setImmediate(() => child.emit("exit", null));
    return true;
  });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-abort-"));
});

afterEach(() => {
  killSpy.mockRestore();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function run() {
  return Exec.executeCommand({
    command: "ansible-playbook site.yml",
    directory: dir,
    description: "Running playbook",
    task: "Playbook",
    extravars: "{}",
    hiddenExtravars: "{}",
    extravarsFileName: "extravars_7.json",
    hiddenExtravarsFileName: "he_extravars_7.json",
    keepExtravars: false,
  }, 7, 0);
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("a playbook stops when its abort flag is set", () => {
  test("runs through /bin/sh -c in its own process group", async () => {
    const result = run().then(() => "resolved", () => "rejected");
    const last = spawned[spawned.length - 1];
    assert.equal(last.file, "/bin/sh");
    assert.deepEqual(last.args, ["-c", "ansible-playbook site.yml"]);
    assert.equal(last.options.detached, true, "its own process group, so one signal stops the pipeline");
    assert.equal(last.options.cwd, dir);
    child.emit("exit", 0);
    assert.equal(await result, "resolved");
  });

  test("noticed on the next output, the whole process group is stopped once", async () => {
    const result = run().then(() => "resolved", () => "rejected");
    jobRow.abort_requested = 1;
    child.stdout.emit("data", "TASK [one]\n");
    child.stdout.emit("data", "TASK [two]\n");
    assert.equal(await result, "rejected");
    assert.deepEqual(kills, [[-4242, "SIGTERM"]], "one signal, to the process group");
    assert.equal(jobRow.status, "aborted");
    assert.equal(jobRow.abort_requested, 0, "the flag is reset");
    assert.ok(outputs.some((o) => /aborted by the operator/.test(o.output)));
  });

  test("a quiet playbook is stopped by the poll, within two seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const result = run().then(() => "resolved", () => "rejected");
    jobRow.abort_requested = 1;
    assert.equal(kills.length, 0, "nothing happens before the poll");
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    assert.equal(await result, "rejected");
    assert.deepEqual(kills, [[-4242, "SIGTERM"]]);
    assert.equal(jobRow.status, "aborted");
  });

  test("a playbook that finishes is never killed, and the poll stops", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const result = run().then(() => "resolved", () => "rejected");
    child.stdout.emit("data", "PLAY RECAP\n");
    await flush();
    child.emit("exit", 0);
    assert.equal(await result, "resolved");
    assert.equal(jobRow.status, "success");
    assert.equal(kills.length, 0);
    const checksAtEnd = abortChecks;
    await vi.advanceTimersByTimeAsync(10000);
    assert.equal(abortChecks, checksAtEnd, "no more polling after the playbook ended");
  });

  test("output past PROCESS_MAX_BUFFER still stops it, as exec's maxBuffer did", async () => {
    const appConfig = (await import("./__mocks__/app.config.js")).default;
    const saved = appConfig.processMaxBuffer;
    appConfig.processMaxBuffer = 10;
    try {
      const result = run().then(() => "resolved", () => "rejected");
      child.stdout.emit("data", "0123456789ABC");
      assert.equal(await result, "rejected");
      assert.deepEqual(kills, [[-4242, "SIGTERM"]]);
      assert.equal(jobRow.status, "failed", "not an operator abort");
      assert.ok(outputs.some((o) => /aborted by the main process/.test(o.output)));
    } finally {
      appConfig.processMaxBuffer = saved;
    }
  });

  test("the extravars files are removed when the playbook ends", async () => {
    const result = run().then(() => "resolved", () => "rejected");
    assert.ok(fs.existsSync(path.join(dir, "extravars_7.json")));
    child.emit("exit", 0);
    await result;
    assert.equal(fs.existsSync(path.join(dir, "extravars_7.json")), false);
    assert.equal(fs.existsSync(path.join(dir, "he_extravars_7.json")), false);
  });
});
