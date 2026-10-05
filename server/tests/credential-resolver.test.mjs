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

// the store registry : the store's own cache is its business, so every read reaches here
const vault = { payload: {}, reads: 0, last: null };
vi.mock("../src/secrets/providers/index.js", () => ({
  VAULT_STORE_NAME: "vault",
  readSecret: async (store, ref) => { vault.reads++; vault.last = { store, ref }; return vault.payload; },
  mapPayloadToCredential: (p) => ({ ...p, user: p.user ?? p.username ?? "", password: p.password ?? "", ...(p.address ? { host: p.address } : {}) }),
  parseInlineSecret: (n) => {
    if (typeof n !== "string") return null;
    if (n.startsWith("vault:")) return { store: "vault", ref: n.slice(6) };
    if (n.startsWith("secret:")) { const [store, ...ref] = n.slice(7).split(":"); return { store, ref: ref.join(":") }; }
    return null;
  },
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
  vault.last = null;
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
    rows = [dbRow({ secret_store: "vault", secret_ref: "secret/db1", password: null })];
    vault.payload = { username: "vaultuser", password: "vaultpw" };
    const c = await Credential.resolveCredential("db1");
    assert.equal(c.user, "vaultuser");
    assert.equal(c.password, "vaultpw");
    assert.equal(c.host, "db.local", "host stays that of the row");
    vault.payload = { username: "vaultuser", password: "rotated" };
    assert.equal((await Credential.resolveCredential("db1")).password, "rotated");
    assert.equal(vault.reads, 2);
    assert.equal(lookups, 1);
    assert.deepEqual(vault.last, { store: "vault", ref: "secret/db1" });
  });

  test("vault_path is not read any more (8.0) : the 7.1 upgrade moved it to secret_store", async () => {
    rows = [dbRow({ vault_path: "secret/db1" })];
    const c = await Credential.resolveCredential("db1");
    assert.equal(vault.reads, 0, "no store is asked");
    assert.equal(c.password, "s3cret", "the row's own password");
    assert.equal("vault_path" in c, false);
  });

  test("a row naming a secret store reads from it, and empty row fields are filled from the secret", async () => {
    rows = [dbRow({ secret_store: "cyberark", secret_ref: "Safe=db;Object=db1", password: null, host: "", port: null, db_name: "" })];
    vault.payload = { username: "pam", password: "pampw", host: "db.pam", port: 5432, db_name: "sales" };
    const c = await Credential.resolveCredential("db1");
    assert.deepEqual(vault.last, { store: "cyberark", ref: "Safe=db;Object=db1" });
    assert.equal(c.user, "pam");
    assert.equal(c.password, "pampw");
    assert.equal(c.host, "db.pam");
    assert.equal(c.port, 5432);
    assert.equal(c.db_name, "sales");
    for (const k of ["secret_store", "secret_ref", "vault_path"]) assert.equal(k in c, false, `${k} is not handed out`);
  });

  test("a secret never overrides a host the row sets", async () => {
    rows = [dbRow({ secret_store: "cyberark", secret_ref: "x", password: null })];
    vault.payload = { username: "pam", password: "pampw", host: "elsewhere", db_name: "other" };
    const c = await Credential.resolveCredential("db1");
    assert.equal(c.host, "db.local");
    assert.equal(c.db_name, "inventory");
  });

  test("an inline secret with a db_type is a database credential, without a row", async () => {
    vault.payload = { username: "dyn", password: "pw", address: "db.dyn", port: 5432, db_type: "postgres", database: "x" };
    const c = await Credential.resolveCredential("secret:vault:database/creds/ro");
    assert.deepEqual(vault.last, { store: "vault", ref: "database/creds/ro" });
    assert.equal(lookups, 0, "no row is looked up");
    assert.equal(c.user, "dyn");
    assert.equal(c.host, "db.dyn");
    assert.equal(c.db_type, "postgres");
    assert.equal(c.is_database, 1);
    assert.equal(c.multipleStatements, true);
  });

  test("an inline secret without a db_type passes the secret through", async () => {
    vault.payload = { username: "api", token: "t", tenant: "acme" };
    const c = await Credential.resolveCredential("vault:secret/api");
    assert.equal(c.user, "api");
    assert.equal(c.tenant, "acme");
    assert.equal("is_database" in c, false);
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
