// Secret stores : the provider registry, its per-store cache and the HashiCorp Vault
// provider, against a fake Vault on a local port.
import { test, describe, beforeAll, afterAll, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import http from "http";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// nothing here may reach a database
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

// the store rows by name ; create/update hand back what they were given
let storeRows = {};
vi.mock("../src/models/crud.model.js", () => ({
  default: class {
    static getCache() { return null; }
    static async findByName(modelName, name) { return storeRows[name] ? { ...storeRows[name] } : undefined; }
    static async findAll() { return Object.values(storeRows); }
    static async findById() { return undefined; }
    static async create(modelName, data) { return data; }
    static async update(modelName, data) { return data; }
    static async delete() { return true; }
  },
}));

// the fake Vault : answers what `secrets` holds, records every request
const requests = [];
let secrets = {};
let lookupStatus = 200;
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, token: req.headers["x-vault-token"], namespace: req.headers["x-vault-namespace"] });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/auth/token/lookup-self") {
    res.statusCode = lookupStatus;
    return res.end(JSON.stringify(lookupStatus === 200 ? { data: { ttl: 3600, renewable: true, policies: ["default"], id: "hvs.never" } } : { errors: ["permission denied"] }));
  }
  const path = req.url.replace(/^\/v1\//, "");
  if (!(path in secrets)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ errors: [] }));
  }
  return res.end(JSON.stringify(secrets[path]));
});

let url;
beforeAll(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const Registry = await import("../src/secrets/providers/index.js");
const { buildApiPath, isDynamicPath } = await import("../src/secrets/providers/vault.js");
const SecretStore = (await import("../src/models/secretStore.model.js")).default;

const vaultRow = (over = {}) => ({ id: 1, name: "vault", type: "vault", url, token: "hvs.test", namespace: null, kv_version: 2, default_mount: "secret", cache_ttl_seconds: 60, ...over });

beforeEach(() => {
  storeRows = {};
  secrets = {};
  requests.length = 0;
  lookupStatus = 200;
  Registry.clearSecretCache();
  for (const k of ["VAULT_ADDR", "VAULT_TOKEN"]) delete process.env[k];
});

describe("vault paths", () => {
  test("KV v2 gets /data/ after the mount, unless it is already there", () => {
    assert.equal(buildApiPath("secret/app/db", 2), "secret/data/app/db");
    assert.equal(buildApiPath("secret/data/app/db", 2), "secret/data/app/db");
    assert.equal(buildApiPath("/secret/app", 2), "secret/data/app");
  });

  test("KV v1 is used as written", () => {
    assert.equal(buildApiPath("kv/app/db", 1), "kv/app/db");
  });

  test("a bare name goes under the default mount", () => {
    assert.equal(buildApiPath("db", 2, "team"), "team/data/db");
    assert.equal(buildApiPath("db", 1), "secret/db");
  });
});

describe("reading a secret", () => {
  test("KV v2 unwraps data.data and sends token and namespace", async () => {
    storeRows.vault = vaultRow({ namespace: "ops" });
    secrets["secret/data/app"] = { data: { data: { username: "u", password: "p" } } };
    assert.deepEqual(await Registry.readSecret("vault", "secret/app"), { username: "u", password: "p" });
    assert.equal(requests[0].token, "hvs.test");
    assert.equal(requests[0].namespace, "ops");
  });

  test("KV v1 reads data directly", async () => {
    storeRows.v1 = vaultRow({ name: "v1", kv_version: 1 });
    secrets["kv/app"] = { data: { user: "u1", password: "p1" } };
    assert.deepEqual(await Registry.readSecret("v1", "kv/app"), { user: "u1", password: "p1" });
  });

  test("a read is cached for the store's ttl", async () => {
    storeRows.vault = vaultRow();
    secrets["secret/data/app"] = { data: { data: { password: "one" } } };
    await Registry.readSecret("vault", "secret/app");
    secrets["secret/data/app"] = { data: { data: { password: "two" } } };
    assert.equal((await Registry.readSecret("vault", "secret/app")).password, "one");
    assert.equal(requests.length, 1);
  });

  test("a ttl of 0 reads on every use", async () => {
    storeRows.vault = vaultRow({ cache_ttl_seconds: 0 });
    secrets["secret/data/app"] = { data: { data: { password: "one" } } };
    await Registry.readSecret("vault", "secret/app");
    secrets["secret/data/app"] = { data: { data: { password: "two" } } };
    assert.equal((await Registry.readSecret("vault", "secret/app")).password, "two");
    assert.equal(requests.length, 2);
  });

  test("a missing secret is an error naming the path", async () => {
    storeRows.vault = vaultRow();
    await assert.rejects(Registry.readSecret("vault", "secret/nope"), /secret\/data\/nope \(HTTP 404\)/);
  });

  test("an unknown store is a not found", async () => {
    await assert.rejects(Registry.readSecret("nope", "x"), /No secret store named 'nope'/);
  });

  test("an unknown type is refused", async () => {
    storeRows.odd = vaultRow({ name: "odd", type: "keepass" });
    await assert.rejects(Registry.readSecret("odd", "x"), /unknown type 'keepass'/);
  });
});

describe("vault dynamic credentials", () => {
  test("<mount>/creds/<role> is a dynamic path, KV paths are not", () => {
    assert.equal(isDynamicPath("database/creds/readonly"), true);
    assert.equal(isDynamicPath("/db-prod/creds/app"), true);
    assert.equal(isDynamicPath("secret/creds"), false);
    assert.equal(isDynamicPath("secret/app/creds/x"), false);
  });

  test("read as written, kept for its lease, the lease never reaching the caller", async () => {
    storeRows.vault = vaultRow({ cache_ttl_seconds: 60 });
    secrets["database/creds/ro"] = { lease_duration: 3600, data: { username: "v-ro-1", password: "p1" } };
    const first = await Registry.readSecret("vault", "database/creds/ro");
    assert.deepEqual(first, { username: "v-ro-1", password: "p1" });
    assert.equal(Object.getOwnPropertySymbols(first).length, 0);
    assert.equal(requests[0].url, "/v1/database/creds/ro", "no /data/ inserted");
    secrets["database/creds/ro"] = { lease_duration: 3600, data: { username: "v-ro-2", password: "p2" } };
    assert.equal((await Registry.readSecret("vault", "database/creds/ro")).username, "v-ro-1", "no second account");
    assert.equal(requests.length, 1);
  });

  test("a store set to 0 still reads every time", async () => {
    storeRows.vault = vaultRow({ cache_ttl_seconds: 0 });
    secrets["database/creds/ro"] = { lease_duration: 3600, data: { username: "a", password: "p" } };
    await Registry.readSecret("vault", "database/creds/ro");
    await Registry.readSecret("vault", "database/creds/ro");
    assert.equal(requests.length, 2);
  });

  test("the lease is used at 80%, at least one second", async () => {
    const { leaseCacheSeconds } = await import("../src/secrets/lease.js");
    assert.equal(leaseCacheSeconds(3600), 2880);
    assert.equal(leaseCacheSeconds(1), 1);
  });
});

describe("inline secrets", () => {
  test("secret:<store>:<ref> and vault:<path>", () => {
    assert.deepEqual(Registry.parseInlineSecret("secret:pam:Safe=a;Object=b"), { store: "pam", ref: "Safe=a;Object=b" });
    assert.deepEqual(Registry.parseInlineSecret("vault:database/creds/ro"), { store: "vault", ref: "database/creds/ro" });
    assert.equal(Registry.parseInlineSecret("plain-name"), null);
    assert.equal(Registry.parseInlineSecret(undefined), null);
    assert.throws(() => Registry.parseInlineSecret("secret:nostore"), /secret:<store>:<ref>/);
  });

  test("host and database are read under their common names", () => {
    const c = Registry.mapPayloadToCredential({ username: "u", password: "p", address: "h", database: "d" });
    assert.equal(c.host, "h");
    assert.equal(c.db_name, "d");
    assert.equal("host" in Registry.mapPayloadToCredential({ password: "p" }), false);
  });
});

describe("checking a store", () => {
  test("reports the token, never the token itself", async () => {
    const info = await Registry.checkStore(vaultRow());
    assert.equal(info.ttl, 3600);
    assert.equal(JSON.stringify(info).includes("hvs."), false);
  });

  test("a refused token says so", async () => {
    lookupStatus = 403;
    await assert.rejects(Registry.checkStore(vaultRow()), /refused the token/);
  });
});

describe("payload to credential", () => {
  test("common key names map to user and password, the rest passes through", () => {
    assert.deepEqual(Registry.mapPayloadToCredential({ username: "u", token: "t", host: "h" }), { username: "u", token: "t", host: "h", user: "u", password: "t" });
    assert.deepEqual(Registry.mapPayloadToCredential(null), {});
  });
});

describe("saving a store", () => {
  test("the mask the api shows is not saved as the token", async () => {
    const saved = await SecretStore.update({ token: "********", client_key: "********", url: "https://v/" }, 1);
    assert.equal("token" in saved, false);
    assert.equal("client_key" in saved, false);
    assert.equal(saved.url, "https://v", "a trailing slash is dropped");
  });

  test("an unknown type is a bad request", async () => {
    await assert.rejects(SecretStore.create({ name: "x", type: "keepass", url: "u" }), /Unknown secret store type/);
  });

  test("extra must be a JSON object", async () => {
    await assert.rejects(SecretStore.create({ name: "x", type: "vault", url: "u", extra: "[1]" }), /JSON object/);
    await assert.rejects(SecretStore.create({ name: "x", type: "vault", url: "u", extra: "{nope" }), /not valid JSON/);
    assert.equal((await SecretStore.create({ name: "x", type: "vault", url: "u", extra: { a: 1 } })).extra, '{"a":1}');
  });

  test("a saved store flushes what was cached", async () => {
    storeRows.vault = vaultRow();
    secrets["secret/data/app"] = { data: { data: { password: "one" } } };
    await Registry.readSecret("vault", "secret/app");
    await SecretStore.update({ description: "x" }, 1);
    secrets["secret/data/app"] = { data: { data: { password: "two" } } };
    assert.equal((await Registry.readSecret("vault", "secret/app")).password, "two");
  });
});
