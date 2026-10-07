// Changes between processes on one database (src/lib/epochs.js) : a write bumps a counter
// under a name, every process reads the counters and runs what subscribed to a name whose
// counter moved. The table is faked here ; the SQL is the whole of it.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let table;
let failReads = false;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    tryDo: async (sql, params) => {
      if (/^INSERT INTO AnsibleForms.`cache_epochs`/.test(sql)) {
        table.set(params[0], (table.get(params[0]) || 0) + 1);
        return { affectedRows: 1 };
      }
      if (failReads) throw new Error("ER_NO_SUCH_TABLE");
      return [...table].map(([name, version]) => ({ name, version }));
    },
  },
}));

const { bump, onEpoch, pollEpochs, resetEpochs } = await import("../src/lib/epochs.js");

beforeEach(() => {
  table = new Map();
  failReads = false;
  resetEpochs();
});

describe("a change reaches the other processes", () => {
  test("the first read only records where the counters stand", async () => {
    table.set("credential", 4);
    const fired = [];
    onEpoch("credential", (n) => fired.push(n));
    assert.deepEqual(await pollEpochs(), []);
    assert.deepEqual(fired, [], "a process that just started has nothing stale to drop");
  });

  test("a bump fires the subscribers of that name once, and '*' with the name", async () => {
    await pollEpochs();
    const named = [];
    const all = [];
    onEpoch("schedule", () => named.push(1));
    onEpoch("*", (n) => all.push(n));
    await bump("schedule");
    await bump("runner");
    assert.deepEqual((await pollEpochs()).sort(), ["runner", "schedule"]);
    assert.equal(named.length, 1);
    assert.deepEqual(all.sort(), ["runner", "schedule"]);
    assert.deepEqual(await pollEpochs(), [], "nothing moved since");
  });

  test("a name never seen before counts as changed", async () => {
    await pollEpochs();
    await bump("oauth2");
    assert.deepEqual(await pollEpochs(), ["oauth2"]);
  });

  test("a failing subscriber does not stop the others", async () => {
    await pollEpochs();
    const ran = [];
    onEpoch("env", () => { throw new Error("boom"); });
    onEpoch("env", () => ran.push("second"));
    await bump("env");
    await pollEpochs();
    assert.deepEqual(ran, ["second"]);
  });
});

describe("it never costs the write that caused it", () => {
  test("an unreadable table is no change, not an error", async () => {
    failReads = true;
    assert.deepEqual(await pollEpochs(), []);
  });

  test("bump never throws, even with no database helper at all", async () => {
    const { default: mysql } = await import("../src/models/db.model.js");
    const saved = mysql.tryDo;
    mysql.tryDo = undefined;
    try {
      await bump("credential");
    } finally {
      mysql.tryDo = saved;
    }
  });
});
