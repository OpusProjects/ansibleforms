// CyberArk Central Credential Provider, against a fake CCP that answers like the documented
// AIMWebService API : the account on 200, { ErrorCode, ErrorMsg } otherwise.
import { test, describe, beforeAll, afterAll, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import http from "http";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

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

// accounts by "Safe|Object" ; the AppID "forms" is the only one the fake knows
const accounts = {
  "Linux|root-srv01": { Content: "S3cr3t!", UserName: "root", Address: "srv01.example.com", Safe: "Linux", Folder: "Root", Name: "root-srv01", PolicyID: "UnixSSH" },
  "DB|forms-db": { Content: "dbpw", UserName: "forms", Address: "db01.example.com", Port: "5432", Database: "cmdb", Safe: "DB", Name: "forms-db" },
};
const requests = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const q = Object.fromEntries(u.searchParams);
  requests.push({ path: u.pathname, q });
  res.setHeader("Content-Type", "application/json");
  const fail = (status, code, msg) => { res.statusCode = status; res.end(JSON.stringify({ ErrorCode: code, ErrorMsg: msg })); };
  if (u.pathname !== "/AIMWebService/api/Accounts") return fail(404, "", "not found");
  if (q.AppID !== "forms") return fail(403, "APPAP227E", `Too many connections or AppID [${q.AppID}] is not authorized`);
  let safe = q.Safe;
  let object = q.Object;
  if (q.Query) {
    const pairs = Object.fromEntries(q.Query.split(";").map((p) => p.split("=")));
    safe = pairs.Safe;
    object = pairs.Object;
  }
  if (!safe && !object) return fail(400, "APPAP282E", "Invalid request. The required parameter 'Query' is missing");
  const account = accounts[`${safe}|${object}`];
  if (!account) return fail(404, "APPAP004E", `Password object matching query [Safe=${safe};Object=${object}] was not found`);
  return res.end(JSON.stringify(account));
});

let url;
beforeAll(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const Registry = await import("../src/secrets/providers/index.js");
const { buildQuery } = await import("../src/secrets/providers/cyberark_ccp.js");

const ccpRow = (over = {}) => ({ id: 2, name: "pam", type: "cyberark_ccp", url, app_id: "forms", cache_ttl_seconds: 0, extra: null, ...over });

beforeEach(() => {
  storeRows = {};
  requests.length = 0;
  Registry.clearSecretCache();
});

describe("the reference", () => {
  test("pairs become query parameters, in their canonical case", () => {
    assert.deepEqual(buildQuery(ccpRow(), "safe=Linux; object=root-srv01"), { AppID: "forms", Safe: "Linux", Object: "root-srv01" });
  });

  test("Query= passes the rest as CCP's own query, exact by default", () => {
    assert.deepEqual(buildQuery(ccpRow(), "Query=Safe=Linux;Object=root-srv01"), { AppID: "forms", Query: "Safe=Linux;Object=root-srv01", QueryFormat: "Exact" });
  });

  test("an AppID in the reference is ignored : the store's identity cannot be borrowed", () => {
    assert.equal(buildQuery(ccpRow(), "AppID=other;Safe=a;Object=b").AppID, "forms");
  });

  test("an unknown key is refused", () => {
    assert.throws(() => buildQuery(ccpRow(), "Safe=a;Password=x"), /'Password' is not supported/);
    assert.throws(() => buildQuery(ccpRow(), "Safe"), /not key=value/);
    assert.throws(() => buildQuery(ccpRow(), ""), /empty/);
  });

  test("the store's reason is added unless the reference has one", () => {
    const store = ccpRow({ extra: '{"reason":"AnsibleForms job"}' });
    assert.equal(buildQuery(store, "Safe=a;Object=b").Reason, "AnsibleForms job");
    assert.equal(buildQuery(store, "Safe=a;Object=b;Reason=mine").Reason, "mine");
  });

  test("a store without AppID is refused", () => {
    assert.throws(() => buildQuery(ccpRow({ app_id: "" }), "Safe=a;Object=b"), /no AppID/);
  });
});

describe("reading an account", () => {
  test("Content is the password, UserName and Address map onto the credential", async () => {
    storeRows.pam = ccpRow();
    const payload = await Registry.readSecret("pam", "Safe=Linux;Object=root-srv01");
    assert.equal(payload.password, "S3cr3t!");
    assert.equal(payload.username, "root");
    assert.equal(payload.address, "srv01.example.com");
    assert.equal("Content" in payload, false);
    const c = Registry.mapPayloadToCredential(payload);
    assert.equal(c.user, "root");
    assert.equal(c.host, "srv01.example.com");
  });

  test("a database account carries port and database", async () => {
    storeRows.pam = ccpRow();
    const c = Registry.mapPayloadToCredential(await Registry.readSecret("pam", "Query=Safe=DB;Object=forms-db"));
    assert.equal(c.port, "5432");
    assert.equal(c.db_name, "cmdb");
    assert.equal(requests[0].q.QueryFormat, "Exact");
  });

  test("special characters are encoded", async () => {
    storeRows.pam = ccpRow();
    await assert.rejects(Registry.readSecret("pam", "Safe=A&B;Object=x y"), /APPAP004E/);
    assert.equal(requests[0].q.Safe, "A&B");
    assert.equal(requests[0].q.Object, "x y");
  });

  test("a missing account surfaces CCP's error code, not the password", async () => {
    storeRows.pam = ccpRow();
    await assert.rejects(Registry.readSecret("pam", "Safe=Linux;Object=nope"), /HTTP 404.*APPAP004E/);
  });

  test("a refused AppID surfaces as such", async () => {
    storeRows.pam = ccpRow({ app_id: "other" });
    await assert.rejects(Registry.readSecret("pam", "Safe=Linux;Object=root-srv01"), /HTTP 403.*APPAP227E/);
  });

  test("an inline secret reads through the store", async () => {
    storeRows.pam = ccpRow();
    const { store, ref } = Registry.parseInlineSecret("secret:pam:Safe=Linux;Object=root-srv01");
    assert.equal((await Registry.readSecret(store, ref)).password, "S3cr3t!");
  });
});

describe("checking the store", () => {
  test("without check_ref : an APPAP answer proves CCP is there and knows the AppID", async () => {
    const info = await Registry.checkStore(ccpRow());
    assert.match(info.note, /AppID accepted.*APPAP282E/);
    assert.equal(requests[0].q.AppID, "forms");
  });

  test("a refused AppID fails the check", async () => {
    await assert.rejects(Registry.checkStore(ccpRow({ app_id: "other" })), /refused AppID 'other'/);
  });

  test("with check_ref : a real read, reporting who and where but never the password", async () => {
    const info = await Registry.checkStore(ccpRow({ extra: '{"check_ref":"Safe=Linux;Object=root-srv01"}' }));
    assert.equal(info.userName, "root");
    assert.equal(info.address, "srv01.example.com");
    assert.equal(JSON.stringify(info).includes("S3cr3t!"), false);
  });

  test("an unreachable CCP says so", async () => {
    await assert.rejects(Registry.checkStore(ccpRow({ url: "http://127.0.0.1:1" })), /Could not reach CyberArk CCP/);
  });
});
