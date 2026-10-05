// 8.0 : AWX connections move from the awx table into runners (type awx), then the awx
// table goes. The copy runs on every start (patches re-run), so it must be idempotent, and
// it must never drop the table while a connection could not move.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

// a tiny in-memory database : the awx table (or none) and the runners table
let awx;
let runners;
let dropped;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql) => {
      if (/^SHOW TABLES/.test(sql)) return awx ? [{ t: "awx" }] : [];
      if (/^INSERT INTO AnsibleForms\.`runners`/.test(sql)) {
        const moving = awx.filter((a) => a.name && !runners.some((r) => r.name === a.name));
        for (const a of moving) runners.push({ name: a.name, type: "awx", token: a.token || null, password: a.password || null });
        return { affectedRows: moving.length };
      }
      if (/LEFT JOIN AnsibleForms\.`runners`/.test(sql)) {
        return awx.filter((a) => !runners.some((r) => r.name === a.name && r.type === "awx")).map((a) => ({ name: a.name }));
      }
      if (/^DROP TABLE/.test(sql)) {
        awx = null;
        dropped++;
        return { affectedRows: 0 };
      }
      return [];
    },
  },
}));

const { copyAwxToRunners } = await import("../src/models/schema.model.js");

beforeEach(() => {
  awx = [
    { name: "aap-prod", token: "enc-token" },
    { name: "aap-test", password: "enc-pw" },
  ];
  runners = [{ name: "rte-dev", type: "rte" }];
  dropped = 0;
});

describe("the awx table becomes runners of type awx", () => {
  test("every connection is copied with its encrypted secrets as they are, then the table goes", async () => {
    assert.match(await copyAwxToRunners(), /Moved 2 AWX connection\(s\)/);
    assert.deepEqual(runners.filter((r) => r.type === "awx").map((r) => r.name), ["aap-prod", "aap-test"]);
    assert.equal(runners.find((r) => r.name === "aap-prod").token, "enc-token");
    assert.equal(runners.find((r) => r.name === "aap-test").password, "enc-pw");
    assert.equal(dropped, 1);
    assert.equal(awx, null);
  });

  test("the next start finds nothing to do", async () => {
    await copyAwxToRunners();
    assert.equal(await copyAwxToRunners(), "No awx table left to copy");
    assert.equal(runners.length, 3, "nothing copied twice");
  });

  test("a name an rte already has keeps the awx table : nothing is lost", async () => {
    runners.push({ name: "aap-test", type: "rte" });
    assert.match(await copyAwxToRunners(), /aap-test could not move to runners/);
    assert.equal(dropped, 0);
    assert.ok(awx, "the awx table is kept until the name is changed");
    // once renamed, the next start finishes the job
    runners = runners.filter((r) => !(r.name === "aap-test" && r.type === "rte"));
    assert.match(await copyAwxToRunners(), /Moved 1 AWX connection/);
    assert.equal(dropped, 1);
  });

  test("a connection already copied (by name) is not copied again, the table still goes", async () => {
    runners.push({ name: "aap-prod", type: "awx" }, { name: "aap-test", type: "awx" });
    assert.match(await copyAwxToRunners(), /already runners/);
    assert.equal(dropped, 1);
  });
});
