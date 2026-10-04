// One credential resolver for every consumer: database queries, playbook and AWX jobs and
// the REST expression helpers. Before 7.x there were three copies with different rules,
// and fnCredentials silently ignored the fallback the docs promise.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// rows by exact name ; the resolver's SQL is WHERE name REGEXP ?, emulated with RegExp
let rows = [];
let lookups = 0;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      if (/WHERE name REGEXP \?/.test(sql)) {
        lookups++;
        const re = new RegExp(Array.isArray(vars) ? vars[0] : vars);
        return rows.filter((r) => re.test(r.name)).map((r) => ({ ...r }));
      }
      if (/^DELETE/i.test(sql)) {
        const id = Array.isArray(vars) ? vars[0] : vars;
        const before = rows.length;
        rows = rows.filter((r) => r.id !== id);
        return { affectedRows: before - rows.length };
      }
      if (/WHERE \?\? = \?/.test(sql)) { // CrudModel.checkExist : [table, key, id]
        return rows.filter((r) => r.id == vars[2]).map(() => ({ 1: 1 }));
      }
      if (/WHERE `?id`?\s*=\s*\?/i.test(sql)) {
        const id = Array.isArray(vars) ? vars[0] : vars;
        return rows.filter((r) => r.id == id).map((r) => ({ managed: 0, ...r }));
      }
      if (/WHERE name\s*=\s*\?|WHERE `?name`?\s*=\s*\?/i.test(sql)) {
        const name = Array.isArray(vars) ? vars[0] : vars;
        return rows.filter((r) => r.name === name).map((r) => ({ ...r }));
      }
      return [];
    },
  },
}));

const vault = { payload: {}, reads: 0 };
vi.mock("../src/lib/vault.js", () => ({
  vaultRead: async () => { vault.reads++; return vault.payload; },
  mapVaultPayloadToCredential: (p) => ({ ...p, user: p.user ?? p.username ?? "", password: p.password ?? "" }),
}));

const appConfig = (await import("./__mocks__/app.config.js")).default;
appConfig.encryptionSecret ||= "0123456789abcdef0123456789abcdef";
const crypto = (await import("../src/lib/crypto.js")).default;
const Credential = (await import("../src/models/credential.model.v2.js")).default;
const Errors = (await import("../src/lib/errors.js")).default;

const dbRow = (over = {}) => ({
  name: "db1", user: "app", password: crypto.encrypt("s3cret"), host: "db.local", port: 3306,
  db_name: "inventory", db_type: "mysql", secure: 1, is_database: 1, vault_path: null, ...over,
});

beforeEach(() => {
  Credential.getCache("credential")?.flushAll();
  rows = [];
  lookups = 0;
  vault.payload = {};
  vault.reads = 0;
});

describe("resolveCredential", () => {
  test("decrypts the password and keeps the database settings of a database credential", async () => {
    rows = [dbRow()];
    const c = await Credential.resolveCredential("db1");
    assert.equal(c.password, "s3cret");
    assert.equal(c.db_name, "inventory");
    assert.equal(c.db_type, "mysql");
    assert.equal(c.multipleStatements, true);
    assert.equal("vault_path" in c, false);
  });

  test("drops the database settings of a plain credential", async () => {
    rows = [dbRow({ name: "api", is_database: 0 })];
    const c = await Credential.resolveCredential("api");
    for (const k of ["secure", "db_name", "db_type", "is_database", "multipleStatements"]) {
      assert.equal(k in c, false, `${k} must not be returned`);
    }
    assert.equal(c.user, "app");
  });

  test("the name is a regex and the fallback is used when it matches nothing", async () => {
    rows = [dbRow({ name: "default_db" })];
    const c = await Credential.resolveCredential("^prod_", "default_db");
    assert.equal(c.name, "default_db");
  });

  test("throws NotFoundError when neither matches", async () => {
    rows = [dbRow()];
    await assert.rejects(Credential.resolveCredential("nope", "neither"), Errors.NotFoundError);
  });

  test("a password that no longer decrypts comes back empty", async () => {
    rows = [dbRow({ password: "not-ciphertext" })];
    const c = await Credential.resolveCredential("db1");
    assert.equal(c.password, "");
  });

  test("returns a fresh object every call, so a caller reshaping it cannot poison the cache", async () => {
    rows = [dbRow()];
    const first = await Credential.resolveCredential("db1");
    delete first.db_type; // mysql.js strips fields like this
    first.password = "changed";
    const second = await Credential.resolveCredential("db1");
    assert.equal(second.db_type, "mysql");
    assert.equal(second.password, "s3cret");
    assert.equal(lookups, 1, "the row itself is cached");
  });

  test("user and password of a vault-backed row are read from vault on every call", async () => {
    rows = [dbRow({ vault_path: "secret/db1", password: null })];
    vault.payload = { username: "vaultuser", password: "vaultpw" };
    const c = await Credential.resolveCredential("db1");
    assert.equal(c.user, "vaultuser");
    assert.equal(c.password, "vaultpw");
    assert.equal(c.host, "db.local", "host stays that of the row");
    vault.payload = { username: "vaultuser", password: "rotated" };
    assert.equal((await Credential.resolveCredential("db1")).password, "rotated");
    assert.equal(vault.reads, 2);
    assert.equal(lookups, 1);
  });

  test("a deleted credential is not resolvable from the cache", async () => {
    rows = [dbRow({ id: 7 })];
    await Credential.resolveCredential("db1");
    assert.equal(await Credential.delete(7), true);
    assert.equal(rows.length, 0);
    await assert.rejects(Credential.resolveCredential("db1"), Errors.NotFoundError);
  });
});

describe("resolveCredentialMap", () => {
  test("resolves each key, honours the fallback and __self__, and skips what does not resolve", async () => {
    rows = [dbRow(), dbRow({ name: "fallback_db", user: "fb" })];
    const creds = await Credential.resolveCredentialMap(
      { a: "db1", b: "^missing$, fallback_db", self: "__self__", gone: "nothing" },
      { host: "af-db", user: "root", port: 3306, password: "pw" },
    );
    assert.equal(creds.a.user, "app");
    assert.equal(creds.b.user, "fb");
    assert.deepEqual(creds.self, { host: "af-db", user: "root", port: 3306, password: "pw" });
    assert.equal("gone" in creds, false, "an unresolvable credential is left out, not thrown");
  });

  test("an empty or missing map gives no credentials", async () => {
    assert.deepEqual(await Credential.resolveCredentialMap(undefined), {});
    assert.deepEqual(await Credential.resolveCredentialMap({}), {});
  });
});

describe("fnCredentials", () => {
  test("uses the fallback when the name matches nothing", async () => {
    rows = [dbRow({ name: "shared_api", is_database: 0 })];
    const { default: fn } = await import("../src/functions/default.js");
    const c = await fn.fnCredentials("team_api", "shared_api");
    assert.equal(c.name, "shared_api");
    assert.equal(c.password, "s3cret");
  });

  test("returns nothing, not an error, when nothing matches", async () => {
    const { default: fn } = await import("../src/functions/default.js");
    assert.equal(await fn.fnCredentials("nothing", "neither"), null, "as before 7.x : no throw, nothing returned");
  });
});
