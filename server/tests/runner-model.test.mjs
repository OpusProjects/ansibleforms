// Runners (server/src/models/runner.model.js) : what each type needs, one default per type,
// and secrets the api showed masked are never stored as the mask.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

let rows;
let writes;
vi.mock("../src/models/crud.model.js", () => ({
  default: class {
    static getCache() { return null; }
    static changed() {}
    static assertRequired() {}
    static async checkExist() {}
    static async assertNotManaged() {}
    static async findAll() { return rows; }
    static async findById(modelName, id) { return rows.find((r) => r.id == id); }
    static async findByName(modelName, name) { return rows.find((r) => r.name === name); }
    static async create(modelName, data) { writes.push({ op: "create", data }); const id = rows.length + 1; rows.push({ id, ...data }); return id; }
    static async update(modelName, data, id) { writes.push({ op: "update", data, id }); Object.assign(rows.find((r) => r.id == id), data); return true; }
    static async delete() { return true; }
  },
}));
const cleared = [];
const deletes = [];
let aliveNodes = new Set();
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/SET is_default = 0/.test(sql)) {
        cleared.push({ sql, params });
        for (const r of rows) if (r.id != params[0] && r.type === params[1]) r.is_default = 0;
        return { changedRows: 1 };
      }
      if (/FROM AnsibleForms.`nodes` WHERE id IN/.test(sql)) return params[0].filter((id) => aliveNodes.has(id)).map((id) => ({ id }));
      if (/^DELETE r FROM AnsibleForms.`runners`/.test(sql)) {
        deletes.push({ sql, params });
        return { affectedRows: 2 };
      }
      return [];
    },
  },
}));

const { default: Runner, SECRET_MASK } = await import("../src/models/runner.model.js");

beforeEach(() => {
  rows = [
    { id: 1, name: "rte-1", type: "rte", uri: "http://rte:8000", token: "t", is_default: 1 },
    { id: 2, name: "aap", type: "awx", uri: "https://aap", token: "a", is_default: 1 },
  ];
  writes = [];
  cleared.length = 0;
  deletes.length = 0;
  aliveNodes = new Set();
});

describe("what each type needs", () => {
  test("an rte needs its token", async () => {
    await assert.rejects(Runner.create({ name: "x", type: "rte", uri: "http://x" }), /needs a token/);
    await Runner.create({ name: "x", type: "rte", uri: "http://x//", token: "t" });
    assert.equal(rows.at(-1).uri, "http://x", "trailing slashes go");
  });

  test("an awx needs a token, or a username and password with use credentials", async () => {
    await assert.rejects(Runner.create({ name: "y", type: "awx", uri: "https://y" }), /needs a token, or use credentials/);
    await assert.rejects(Runner.create({ name: "y", type: "awx", uri: "https://y", use_credentials: 1, username: "u" }), /username and a password/);
    await Runner.create({ name: "y", type: "awx", uri: "https://y", use_credentials: 1, username: "u", password: "p" });
  });

  test("an unknown type is refused", async () => {
    await assert.rejects(Runner.create({ name: "z", type: "local", uri: "x" }), /Unknown runner type 'local'/);
  });

  test("an update is checked on the row as it will be stored", async () => {
    await Runner.update({ description: "only this changes" }, 1);
    await assert.rejects(Runner.update({ use_credentials: 1 }, 2), /username and a password/);
  });
});

describe("one default per type", () => {
  test("a new default rte clears only the other rte, the awx default stays", async () => {
    await Runner.create({ name: "rte-2", type: "rte", uri: "http://rte2", token: "t", is_default: 1 });
    assert.equal(rows.find((r) => r.name === "rte-1").is_default, 0);
    assert.equal(rows.find((r) => r.name === "aap").is_default, 1);
    assert.deepEqual(cleared[0].params.slice(1), ["rte"]);
  });

  test("findDefault looks only at its own type", async () => {
    assert.equal((await Runner.findDefault("rte")).name, "rte-1");
    assert.equal((await Runner.findDefault("awx")).name, "aap");
    rows = rows.filter((r) => r.type !== "awx");
    assert.equal(await Runner.findDefault("awx"), null);
  });
});

describe("the first runner of a type is its default", () => {
  test("added without the tick, it becomes the default when its type has none", async () => {
    rows = rows.filter((r) => r.type !== "rte");
    await Runner.create({ name: "rte-new", type: "rte", uri: "http://n", token: "t" });
    assert.equal(rows.find((r) => r.name === "rte-new").is_default, 1);
  });

  test("not when its type already has a default", async () => {
    await Runner.create({ name: "rte-2", type: "rte", uri: "http://n", token: "t" });
    assert.ok(!rows.find((r) => r.name === "rte-2").is_default);
    assert.equal(rows.find((r) => r.name === "rte-1").is_default, 1);
  });

  test("not for the seed, which declares the flag itself", async () => {
    rows = rows.filter((r) => r.type !== "rte");
    await Runner.create({ name: "rte-seed", type: "rte", uri: "http://n", token: "t" }, { fromSeed: true });
    assert.ok(!rows.find((r) => r.name === "rte-seed").is_default);
  });
});

describe("masked secrets", () => {
  test("the mask sent back means unchanged, for the token and the password", async () => {
    rows[1].use_credentials = 1;
    rows[1].username = "u";
    rows[1].password = "real";
    await Runner.update({ token: SECRET_MASK, password: SECRET_MASK, description: "x" }, 2);
    const write = writes.at(-1).data;
    assert.equal("token" in write, false);
    assert.equal("password" in write, false);
    assert.equal(rows[1].password, "real");
  });
});

describe("runners an RTE registered itself", () => {
  test("the api cannot set or change which RTE registered a runner", async () => {
    await Runner.create({ name: "x", type: "rte", uri: "http://x", token: "t", node_id: "rte-x-8000", state: "automatic" });
    assert.equal(rows.at(-1).node_id, undefined);
    assert.equal(rows.at(-1).state, undefined);
    await Runner.update({ node_id: "rte-y-8000" }, 1);
    assert.equal(rows[0].node_id, undefined);
  });

  test("the RTE itself can", async () => {
    await Runner.create({ name: "x", type: "rte", uri: "http://x", token: "t", node_id: "rte-x-8000" }, { fromRte: true });
    assert.equal(rows.at(-1).node_id, "rte-x-8000");
  });

  test("automatic while its RTE heartbeats, unresponsive once it stopped, nothing for the others", async () => {
    aliveNodes = new Set(["rte-a-8000"]);
    const list = await Runner.withState([
      { id: 1, name: "a", node_id: "rte-a-8000" },
      { id: 2, name: "b", node_id: "rte-b-8000" },
      { id: 3, name: "c", node_id: null },
    ]);
    assert.deepEqual(list.map((r) => r.state), ["automatic", "unresponsive", undefined]);
  });

  test("the sweep removes only registered, unmanaged runners whose RTE is long gone", async () => {
    assert.equal(await Runner.removeUnresponsive(), 2);
    const { sql, params } = deletes[0];
    assert.match(sql, /r.node_id IS NOT NULL/);
    assert.match(sql, /COALESCE\(r.managed, 0\) = 0/);
    assert.match(sql, /JOIN AnsibleForms.`nodes` n ON n.id = r.node_id/);
    assert.deepEqual(params, [600]);
  });
});
