// Several processes on one database : which jobs a starting process may end, the designer
// lock in the database, and what AF_ROLE means.
import { test, describe, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: Job } = await import("../src/models/job.model.js");
const { default: Lock } = await import("../src/models/lock.model.js");
const { default: mysql } = await import("../src/models/db.model.js");
const { currentRole } = await import("../src/lib/role.js");
const appConfig = (await import("./__mocks__/app.config.js")).default;

let calls;
let lockRow;
beforeEach(() => {
  calls = [];
  lockRow = null;
  mysql.do = async (sql, params) => {
    calls.push({ sql, params });
    if (/^DELETE FROM AnsibleForms.`designer_lock`/.test(sql)) { const had = !!lockRow; lockRow = null; return { affectedRows: had ? 1 : 0 }; }
    if (/^INSERT INTO AnsibleForms.`designer_lock`/.test(sql)) { lockRow = { data: params[1] }; return { affectedRows: 1 }; }
    if (/^SELECT data FROM AnsibleForms.`designer_lock`/.test(sql)) return lockRow ? [lockRow] : [];
    return { changedRows: 0, affectedRows: 0 };
  };
});

describe("a starting process ends only the jobs it may", () => {
  test("an app node : only the jobs it followed itself", async () => {
    await Job.abandonOwn("app-a");
    const { sql, params } = calls[0];
    assert.match(sql, /host IS NULL and \(tracker=\?\)/);
    assert.deepEqual(params, ["app-a"]);
    assert.doesNotMatch(sql, /tracker IS NULL/, "jobs nobody follows are the worker's to end, once");
  });

  test("the worker : its own, and the jobs from before 7.3 that nobody follows", async () => {
    await Job.abandonOwn("worker-a", { untracked: true });
    assert.match(calls[0].sql, /\(tracker=\? or tracker IS NULL\)/);
  });

  test("a starting app node never ends a job an RTE runs (host set) : it carries on", async () => {
    await Job.abandonOwn("app-a");
    assert.match(calls[0].sql, /host IS NULL/);
  });

  test("the dead-node sweep : the RTE running a job owns it, else the node following it", async () => {
    await Job.abandonDeadNodes("worker-a");
    const { sql, params } = calls[0];
    const owner = "COALESCE\\(j\\.host, j\\.tracker\\)";
    assert.match(sql, new RegExp(`${owner}<>\\?`), "never the worker's own jobs");
    assert.match(sql, new RegExp(`NOT EXISTS \\(SELECT 1 FROM AnsibleForms.\`nodes\` n WHERE n\\.id=${owner} AND n\\.last_seen > \\(NOW\\(\\) - INTERVAL \\? SECOND\\)\\)`));
    assert.equal(params[0], "worker-a");
    assert.ok(params[1] >= 60, "a node is given at least a minute of missed heartbeats");
  });

  test("a new job names the node that follows it", async () => {
    let inserted;
    mysql.do = async (sql, record) => { inserted = record; return { insertId: 7 }; };
    await Job.create({ form: "f", status: "running" });
    assert.ok(inserted.tracker, "jobs.tracker must be set");
  });
});

describe("the designer lock lives in the database", () => {
  const user = { username: "alice", type: "local", options: { showDesigner: true } };
  const bob = { username: "bob", type: "local", options: { showDesigner: true } };

  test("free, taken, seen by another user, released", async () => {
    appConfig.showDesigner = true;
    assert.equal(await Lock.isHeld(), false);
    assert.deepEqual(await Lock.status(user), { free: true });
    await Lock.set(user);
    assert.equal(await Lock.isHeld(), true);
    const seen = await Lock.status(bob);
    assert.equal(seen.free, false);
    assert.equal(seen.match, false);
    assert.equal(seen.lock.username, "alice");
    assert.ok(seen.lock.created, "the age shown on the Status page comes from here");
    assert.equal((await Lock.status(user)).match, true);
    await Lock.delete(user);
    assert.equal(await Lock.isHeld(), false);
    assert.equal((await Lock.delete(user)).deleted, false, "deleting a free lock is idempotent");
  });

  test("an unreadable lock is still held, by somebody unknown", async () => {
    lockRow = { data: "not json" };
    assert.equal(await Lock.isHeld(), true);
  });
});

describe("AF_ROLE", () => {
  test("every process names itself <role>-<hostname>-<port> : nothing to set", async () => {
    const { nodeId } = await import("../src/lib/role.js");
    const os = await import("os");
    assert.equal(nodeId, `af-${os.hostname()}-${process.env.PORT || 8000}`);
  });

  test("unset means all, as AnsibleForms always ran ; case and spaces do not matter", () => {
    assert.equal(currentRole({}), "all");
    assert.equal(currentRole({ AF_ROLE: "" }), "all");
    assert.equal(currentRole({ AF_ROLE: " Worker " }), "worker");
  });

  test("an unknown role refuses to start, before anything connects", () => {
    const r = spawnSync(process.execPath, ["index.js"], {
      cwd: path.join(here, ".."),
      env: { ...process.env, AF_ROLE: "workr", NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AF_ROLE='workr' is not one of all, app, worker, rte/);
  });
});
