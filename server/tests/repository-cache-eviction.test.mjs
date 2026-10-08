// The repositories model is cached (crud.config.js sets allowCache, entries live an
// hour) and CrudModel.findByName serves from that cache, while CrudModel.findAll never
// touches it. Every git operation in the model writes status/output/head with its own
// SQL rather than through CrudModel.update, so nothing evicted the cached record.
//
// The effect, measured against a live 6.2.1 instance: after a pull moved a repository
// to a new commit, GET /api/v2/repository/<name> kept answering with the PREVIOUS head
// while GET /api/v2/repository and the database both showed the new one. A CI job
// polling the single record to learn whether its commit had landed waited on a value
// that could not change until the entry expired, and reported a failed deploy over a
// pull that had already succeeded.
//
// delete() already evicted by hand for the same reason. These pin it for the rest.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const sql = [];
vi.mock("../src/models/db.model.js", () => ({
  default: { do: async (statement) => { sql.push(statement); return { affectedRows: 1 }; } },
}));

vi.mock("../src/models/repo.model.js", () => ({
  default: {
    pull: async () => "Already up to date.",
    clone: async () => "Cloning into 'x'...",
    delete: async () => {},
    info: async () => "new1234",
    maskGitToken: (s) => s,
  },
}));

// A cache that records what was evicted, standing in for the shared NodeCache.
const evicted = [];
let flushed = 0;
vi.mock("../src/models/crud.model.js", () => {
  class CrudModel {
    static getCache() {
      return {
        del: (key) => evicted.push(key),
        flushAll: () => { flushed += 1; },
        get: () => undefined,
        set: () => {},
      };
    }
    static async findByName(modelName, name) {
      return { id: 7, name, uri: "https://example.invalid/x.git", use_for_forms: 0 };
    }
    static async findAll() { return []; }
    static async assertNotManaged() {}
    static async update() {}
  }
  return { default: CrudModel };
});

const { default: Repository } = await import("../src/models/repository.model.js");

describe("the cached repository record is evicted when state is written", () => {
  beforeEach(() => { sql.length = 0; evicted.length = 0; flushed = 0; });

  test("a pull evicts the record it just moved", async () => {
    await Repository.pull("myrepo");
    assert.ok(sql.some((s) => s.includes("set head = ?")), "the head was never written");
    assert.ok(
      evicted.includes("name:myrepo"),
      `the pull left name:myrepo cached, so findByName keeps the old head (evicted: ${evicted.join(", ") || "nothing"})`,
    );
  });

  test("writeState evicts by name", async () => {
    await Repository.writeState("update AnsibleForms.`repositories` set status = ? where name = ?", ["success", "myrepo"], { name: "myrepo" });
    assert.deepEqual(evicted, ["name:myrepo"]);
  });

  test("writeState evicts by id as well when given one", async () => {
    await Repository.writeState("update AnsibleForms.`repositories` set status = ? where id = ?", ["success", 7], { name: "myrepo", id: 7 });
    assert.deepEqual(evicted, ["name:myrepo", "id:7"]);
  });

  test("a statement with no key drops the whole model cache", async () => {
    // releaseStaleClaims updates every stale running row; this caller cannot name them.
    await Repository.writeState("update AnsibleForms.`repositories` set status = 'failed' where status = 'running'");
    assert.equal(flushed, 1, "an unscoped write must not leave stale entries behind");
    assert.deepEqual(evicted, []);
  });
});
