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
const Import = await import("../src/secrets/importVaultEnv.js");

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

describe("the first start with VAULT_* imports them once", () => {
  const env = () => ({ VAULT_ADDR: url, VAULT_TOKEN: "hvs.env", VAULT_NAMESPACE: "ops", VAULT_KV_VERSION: "1", VAULT_DEFAULT_MOUNT: "kv", VAULT_SKIP_VERIFY: "true", VAULT_CACHE_TTL_MS: "300" });
  // the marker in settings, in memory
  const fakeMarker = (at = null) => ({ at, read: async function () { return this.at; }, write: async function () { this.at = new Date(); } });

  test("the variables become the store named vault, and the import is recorded", async () => {
    const created = [];
    const spy = vi.spyOn(SecretStore, "create").mockImplementation(async (d) => { created.push(d); return d; });
    const marker = fakeMarker();
    try {
      assert.equal(await Import.importVaultFromEnvOnce({ env: env(), marker }), "imported");
      assert.ok(marker.at, "recorded");
      assert.equal(created.length, 1);
      const s = created[0];
      assert.equal(s.name, "vault");
      assert.equal(s.type, "vault");
      assert.equal(s.url, url);
      assert.equal(s.token, "hvs.env");
      assert.equal(s.namespace, "ops");
      assert.equal(s.kv_version, 1);
      assert.equal(s.default_mount, "kv");
      assert.equal(s.ignore_certs, true);
      assert.equal(s.cache_ttl_seconds, 1, "300ms clamps to one second, not to 'no cache'");
    } finally {
      spy.mockRestore();
    }
  });

  test("imported before : nothing is created, even when the store was deleted since", async () => {
    const spy = vi.spyOn(SecretStore, "create");
    try {
      assert.equal(await Import.importVaultFromEnvOnce({ env: env(), marker: fakeMarker(new Date()) }), "ignored");
      assert.equal(spy.mock.calls.length, 0);
    } finally {
      spy.mockRestore();
    }
  });

  test("a store already named vault is kept, and the decision is recorded", async () => {
    storeRows.vault = vaultRow({ token: "hvs.row" });
    const spy = vi.spyOn(SecretStore, "create");
    const marker = fakeMarker();
    try {
      assert.equal(await Import.importVaultFromEnvOnce({ env: env(), marker }), "kept");
      assert.equal(spy.mock.calls.length, 0);
      assert.ok(marker.at);
    } finally {
      spy.mockRestore();
    }
  });

  test("nothing to do without address and token, and nothing recorded", async () => {
    const marker = fakeMarker();
    assert.equal(await Import.importVaultFromEnvOnce({ env: { VAULT_ADDR: url }, marker }), "none");
    assert.equal(marker.at, null);
  });

  test("the variables are not read at runtime : no store row, no secret", async () => {
    process.env.VAULT_ADDR = url;
    process.env.VAULT_TOKEN = "hvs.env";
    await assert.rejects(Registry.readSecret("vault", "secret/app"), /No secret store named 'vault'/);
  });

  test("cache ttl conversion", () => {
    assert.equal(Import.resolveCacheTtlSeconds("60000"), 60);
    assert.equal(Import.resolveCacheTtlSeconds("0"), 0);
    assert.equal(Import.resolveCacheTtlSeconds("abc"), 60, "unparseable falls back to the default");
    assert.equal(Import.resolveCacheTtlSeconds(undefined), 60);
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

describe("a store's token from a credential", () => {
  test("a read logs in with the credential's password, not the store's own token", async () => {
    storeRows.vault = vaultRow({ token: null, credential: "vault-token" });
    storeRows["vault-token"] = { name: "vault-token", password: "hvs.from-credential", secret_store: null };
    secrets["secret/data/app"] = { data: { data: { password: "p" } } };
    await Registry.readSecret("vault", "secret/app");
    assert.equal(requests[0].token, "hvs.from-credential");
  });

  test("Test connection logs in with the credential's password too", async () => {
    storeRows["vault-token"] = { name: "vault-token", password: "hvs.from-credential", secret_store: null };
    await Registry.checkStore(vaultRow({ token: null, credential: "vault-token" }));
    assert.equal(requests[0].token, "hvs.from-credential");
  });

  test("a credential that is gone says so", async () => {
    await assert.rejects(Registry.checkStore(vaultRow({ credential: "gone" })), /'gone', which is not found/);
  });

  test("saving : the credential must exist and keep its own password", async () => {
    await assert.rejects(SecretStore.update({ credential: "gone" }, 1), /No credential named 'gone'/);
    storeRows["from-store"] = { name: "from-store", password: "", secret_store: "vault" };
    await assert.rejects(SecretStore.update({ credential: "from-store" }, 1), /reads its password from a secret store/);
    storeRows["vault-token"] = { name: "vault-token", password: "t", secret_store: null };
    assert.equal((await SecretStore.update({ credential: "vault-token" }, 1)).credential, "vault-token");
  });

  test("a CyberArk logs in with a cyberark credential's AppID and client certificate and key", async () => {
    storeRows.ccp = { name: "ccp", type: "cyberark_ccp", credential: "ccp-login" };
    storeRows["ccp-login"] = { name: "ccp-login", credential_type: "cyberark", user: "AnsibleForms", client_cert: "CERT", client_key: "KEY", secret_store: null };
    const store = await SecretStore.withCredential(storeRows.ccp);
    assert.equal(store.app_id, "AnsibleForms");
    assert.equal(store.client_cert, "CERT");
    assert.equal(store.client_key, "KEY");
  });

  test("saving : a store's credential must match its type", async () => {
    storeRows["ccp-login"] = { name: "ccp-login", credential_type: "cyberark", secret_store: null };
    storeRows["vault-token"] = { name: "vault-token", credential_type: "api", secret_store: null };
    await assert.rejects(SecretStore.create({ name: "c", type: "cyberark_ccp", url: "u", credential: "vault-token" }), /needs a cyberark credential/);
    await assert.rejects(SecretStore.create({ name: "v", type: "vault", url: "u", credential: "ccp-login" }), /cannot give a token/);
    assert.equal((await SecretStore.create({ name: "c", type: "cyberark_ccp", url: "u", credential: "ccp-login" })).credential, "ccp-login");
  });

  test("saving : an empty credential is none, and the config seed is not checked", async () => {
    assert.equal((await SecretStore.update({ credential: "" }, 1)).credential, null);
    assert.equal((await SecretStore.create({ name: "s", type: "vault", url: "u", credential: "later" }, { fromSeed: true })).credential, "later");
  });
});
