// Mail servers : the smtp credential a server logs in with, the one active server, and the
// configuration the mail sender is handed.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

// what the queries were ; nothing reaches a database
const queries = [];
vi.mock("../src/models/db.model.js", () => ({ default: { do: async (sql, args) => { queries.push({ sql, args }); return []; } } }));

// the rows by name, and the servers ; create hands back an id
let rows = {};
let servers = [];
vi.mock("../src/models/crud.model.js", () => ({
  default: class {
    static changed() {}
    static async findByName(modelName, name) { return rows[name] ? { ...rows[name] } : undefined; }
    static async findAll() { return servers; }
    static async create() { return 7; }
    static async update(modelName, data) { return data; }
  },
}));

// a credential resolved for use : user and password
let resolved = {};
vi.mock("../src/models/credential.model.v2.js", () => ({
  default: { resolveCredential: async (regex) => resolved[regex] || null },
}));

const MailServer = (await import("../src/models/mailServer.model.js")).default;

beforeEach(() => {
  rows = {};
  servers = [];
  resolved = {};
  queries.length = 0;
});

describe("a mail server's credential", () => {
  test("must exist and be an smtp one ; empty is none", async () => {
    await assert.rejects(MailServer.update({ credential: "gone" }, 1), /No credential named 'gone'/);
    rows.api = { name: "api", credential_type: "api" };
    await assert.rejects(MailServer.update({ credential: "api" }, 1), /needs an smtp credential/);
    rows.smtp = { name: "smtp", credential_type: "smtp" };
    assert.equal((await MailServer.update({ credential: "smtp" }, 1)).credential, "smtp");
    assert.equal((await MailServer.update({ credential: "" }, 1)).credential, null);
  });
});

describe("the active server", () => {
  test("the first one created is active, and the others stop being it", async () => {
    const data = { name: "a", server: "smtp.example.com" };
    await MailServer.create(data);
    assert.equal(data.is_active, 1);
    assert.ok(queries.some((q) => /SET is_active = 0 WHERE id <> \?/.test(q.sql) && q.args[0] === 7));
  });

  test("one created next to an active one is not active", async () => {
    servers = [{ id: 1, is_active: 1 }];
    const data = { name: "b", server: "smtp.example.com" };
    await MailServer.create(data);
    assert.equal(data.is_active, undefined);
  });

  test("made active, the others stop being it", async () => {
    await MailServer.update({ is_active: 1 }, 3);
    assert.ok(queries.some((q) => /SET is_active = 0/.test(q.sql) && q.args[0] === 3));
  });
});

describe("the configuration the sender is handed", () => {
  test("its address, and its credential's user and password", async () => {
    resolved["^smtp-login$"] = { user: "mailer", password: "secret" };
    const config = await MailServer.toMailConfig({ name: "m", server: "smtp.example.com", port: 587, secure: 1, from_address: "af@example.com", credential: "smtp-login" });
    assert.deepEqual(config, { mail_server: "smtp.example.com", mail_port: 587, mail_secure: 1, mail_username: "mailer", mail_password: "secret", mail_from: "af@example.com" });
  });

  test("no credential : no login (a relay)", async () => {
    const config = await MailServer.toMailConfig({ name: "m", server: "relay", port: 25, secure: 0, from_address: "af@example.com" });
    assert.equal(config.mail_username, "");
  });

  test("a credential that is gone says so", async () => {
    await assert.rejects(MailServer.toMailConfig({ name: "m", server: "s", credential: "gone" }), /'gone', which is not found/);
  });
});
