// tests for the audit trail. The security property under test is that secret
// material can NEVER reach the table, and the reliability property is that a broken
// audit write can never break the request it was recording.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// capture what would be written instead of writing it
let inserts = [];
let dbThrows = false;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      if (dbThrows) throw new Error("ER_DISK_FULL");
      inserts.push({ sql, vars });
      if (/COUNT\(\*\)/.test(sql)) return [{ total: 0 }];
      return [];
    },
  },
}));

const Audit = (await import("../src/models/audit.model.js")).default;
const { actionFrom, targetFrom, outcomeFor } = await import("../src/lib/auditMiddleware.js");

// column order in the INSERT: actor, actor_type, ip, action, target_type, target, outcome, detail
const COL = { actor: 0, actorType: 1, ip: 2, action: 3, targetType: 4, target: 5, outcome: 6, detail: 7 };
const lastInsert = () => inserts.filter((i) => /INSERT INTO/.test(i.sql)).slice(-1)[0];

beforeEach(() => {
  inserts = [];
  dbThrows = false;
});

describe("secret material never reaches the table", () => {
  const SECRET = "hunter2-should-never-appear";

  test("keys that look like secrets are redacted at any depth", async () => {
    await Audit.log({
      user: { username: "bob", type: "local" },
      action: "credential.update",
      detail: {
        name: "prod-ssh",
        password: SECRET,
        token: SECRET,
        mail_password: SECRET,
        bind_user_pw: SECRET, // the real ldap bind password column name
        client_secret: SECRET,
        refresh_token: SECRET,
        api_key: SECRET,
        private_key: SECRET,
        ca_bundle: SECRET,
        nested: { deeper: { secret: SECRET, harmless: "keep-me" } },
        list: [{ password: SECRET }, { fine: "also-keep" }],
      },
    });
    const detail = lastInsert().vars[COL.detail];
    assert.equal(detail.includes(SECRET), false, "no secret value may survive scrubbing");
    // the harmless fields are still there, otherwise the entry would be useless
    assert.match(detail, /prod-ssh/);
    assert.match(detail, /keep-me/);
    assert.match(detail, /also-keep/);
    assert.match(detail, /\[redacted\]/);
  });

  test("the scrubber is key based, so an innocent value is untouched", () => {
    const out = Audit._scrub({ url: "https://example.com", count: 3, enabled: true });
    assert.deepEqual(out, { url: "https://example.com", count: 3, enabled: true });
  });

  test("a cyclic detail does not lose the entry", async () => {
    const cyclic = { name: "loop" };
    cyclic.self = cyclic;
    await Audit.log({ action: "config.save", detail: cyclic });
    // the depth cap cuts the cycle before JSON.stringify can throw, so the entry is
    // written with a bounded detail rather than being dropped
    assert.ok(lastInsert(), "the entry must still be recorded");
    const detail = lastInsert().vars[COL.detail];
    assert.match(detail, /loop/);
    assert.ok(detail.length < 1000, "the cycle must be cut, not expanded");
  });

  test("camelCase secret keys are redacted without catching innocent words", async () => {
    await Audit.log({
      action: "credential.update",
      detail: { apiKey: SECRET, mailPassword: SECRET, refreshToken: SECRET, monkey: "keep", turkey: "keep" },
    });
    const detail = lastInsert().vars[COL.detail];
    assert.equal(detail.includes(SECRET), false);
    assert.match(detail, /"monkey":"keep"/);
    assert.match(detail, /"turkey":"keep"/);
  });

  test("an oversized detail is truncated rather than stored whole", async () => {
    await Audit.log({ action: "config.save", detail: { blob: "x".repeat(50000) } });
    const detail = lastInsert().vars[COL.detail];
    assert.ok(detail.length < 9000, `expected truncation, got ${detail.length}`);
    assert.match(detail, /truncated/);
  });
});

describe("auditing never breaks the caller", () => {
  test("a failing database write is swallowed, not thrown", async () => {
    dbThrows = true;
    // the assertion IS that this resolves
    await Audit.log({ action: "role.update", user: { username: "bob", type: "local" } });
    assert.ok(true);
  });
});

describe("entries carry the right actor and outcome", () => {
  test("a system action has no actor but is marked as system", async () => {
    await Audit.log({ action: "backup.create" });
    assert.equal(lastInsert().vars[COL.actor], null);
    assert.equal(lastInsert().vars[COL.actorType], "system");
  });

  test("a user action records username and provider", async () => {
    await Audit.log({ user: { username: "alice", type: "ldap" }, action: "job.approve", target: 42, outcome: "success" });
    const v = lastInsert().vars;
    assert.equal(v[COL.actor], "alice");
    assert.equal(v[COL.actorType], "ldap");
    assert.equal(v[COL.target], "42", "target is stored as a string");
    assert.equal(v[COL.outcome], "success");
  });

  test("outcome defaults to success and over-long fields are clamped", async () => {
    await Audit.log({ action: "a".repeat(200), targetType: "b".repeat(200), target: "c".repeat(500) });
    const v = lastInsert().vars;
    assert.equal(v[COL.outcome], "success");
    assert.equal(v[COL.action].length, 64);
    assert.equal(v[COL.targetType].length, 64);
    assert.equal(v[COL.target].length, 255);
  });
});

describe("the middleware maps requests to actions", () => {
  test("an id in the path becomes the target, not part of the action", () => {
    assert.equal(actionFrom("/api/v2/user", "/42", "DELETE"), "user.delete");
    assert.equal(targetFrom("/42"), "42");
    // so user 42 and user 43 aggregate under one action
    assert.equal(actionFrom("/api/v2/user", "/43", "DELETE"), "user.delete");
  });

  // A named route parameter used to leak into the action, so every repository produced
  // its own action value. The route PATTERN is what makes them aggregate.
  test("a named route parameter does not become part of the action", () => {
    assert.equal(actionFrom("/api/v2/repository", "/:name/pull/", "POST"), "repository.pull.create");
    assert.equal(actionFrom("/api/v2/backup", "/:folder/restore", "POST"), "backup.restore.create");
    assert.equal(actionFrom("/api/v2/config", "/restore/:backupName", "POST"), "config.restore.create");
    // and the value itself is still recorded, positionally, as the target
    assert.equal(targetFrom("/myrepo/pull/", "/:name/pull/"), "myrepo");
    assert.equal(targetFrom("/config.file.yaml.bak.123/", "/:backupName/"), "config.file.yaml.bak.123");
    // no pattern : fall back to the id-ish tail
    assert.equal(targetFrom("/42"), "42");
    assert.equal(targetFrom("/myrepo/pull/"), null);
  });

  test("nested paths keep their shape", () => {
    assert.equal(actionFrom("/api/v2/settings", "/config", "PUT"), "settings.config.update");
    assert.equal(actionFrom("/api/v2/backup", "/20260101000000/restore", "POST"), "backup.restore.create");
  });

  test("a refusal is 'denied', a server error is 'failure'", () => {
    assert.equal(outcomeFor(401), "denied");
    assert.equal(outcomeFor(403), "denied");
    assert.equal(outcomeFor(500), "failure");
    assert.equal(outcomeFor(400), "failure");
    assert.equal(outcomeFor(200), "success");
    assert.equal(outcomeFor(204), "success");
  });
});

describe("the read side is filterable and paginated", () => {
  test("filters become AND-ed where clauses and the page is clamped", async () => {
    await Audit.find({ actor: "alice", outcome: "denied", limit: 99999, offset: 5 });
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    assert.match(select.sql, /WHERE actor = \? AND outcome = \?/);
    assert.match(select.sql, /ORDER BY created_at DESC/);
    // limit clamped to the 1000 ceiling
    assert.deepEqual(select.vars.slice(-2), [1000, 5]);
  });

  test("no filters means no where clause", async () => {
    await Audit.find({});
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    assert.equal(/WHERE/.test(select.sql), false);
  });

  test("retention refuses a zero or missing window rather than deleting everything", async () => {
    assert.equal(await Audit.removeOlderThan(0), 0);
    assert.equal(await Audit.removeOlderThan(undefined), 0);
    assert.equal(inserts.some((i) => /DELETE/.test(i.sql)), false, "no delete may be issued");
  });

  test("retention deletes in batches with a day interval", async () => {
    await Audit.removeOlderThan(30);
    const del = inserts.find((i) => /DELETE/.test(i.sql));
    assert.match(del.sql, /INTERVAL \? DAY/);
    // batched : an unbounded DELETE on this table blocks every audit write
    assert.match(del.sql, /LIMIT \?/);
    assert.deepEqual(del.vars, [30, 5000]);
  });
});

describe("hostile query input cannot 500 the read side", () => {
  test("a repeated query param arrives as an array and is reduced to one value", async () => {
    // ?actor=a&actor=b => ['a','b'] => mysql2 renders "actor = 'a', 'b'" => parse error
    await Audit.find({ actor: ["a", "b"] });
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    assert.match(select.sql, /WHERE actor = \?/);
    assert.equal(select.vars[0], "a");
  });

  test("an unparsable date is ignored rather than raising ER_WRONG_VALUE", async () => {
    await Audit.find({ from: "not-a-date" });
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    assert.equal(/WHERE/.test(select.sql), false, "the bad filter is dropped");
  });

  test("a valid date is normalised to a zone-less UTC datetime", async () => {
    await Audit.find({ from: "2026-07-26T14:00:00.000Z" });
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    // created_at is DATETIME with no zone : sending the 'Z' form makes mysql drop the
    // zone and read it as server-local, shifting the filter silently
    assert.equal(select.vars[0], "2026-07-26 14:00:00");
  });

  test("an absurd offset is clamped instead of rendering as 1e20", async () => {
    await Audit.find({ offset: "99999999999999999999" });
    const select = inserts.find((i) => /SELECT id, created_at/.test(i.sql));
    const offset = select.vars[select.vars.length - 1];
    assert.ok(Number.isInteger(offset) && offset <= 1000000, `got ${offset}`);
  });
});

describe("no single field can suppress its own audit row", () => {
  test("every column is clamped to its schema width", async () => {
    // STRICT_TRANS_TABLES makes one over-long value fail the whole INSERT, so a
    // 300-character username would have erased the record of its own login attempt
    await Audit.log({
      user: { username: "u".repeat(400), type: "t".repeat(50) },
      ip: "9".repeat(200),
      action: "a".repeat(200),
      targetType: "b".repeat(200),
      target: "c".repeat(500),
      outcome: "o".repeat(50),
    });
    const v = lastInsert().vars;
    assert.equal(v[COL.actor].length, 255);
    assert.equal(v[COL.actorType].length, 20);
    assert.equal(v[COL.ip].length, 45);
    assert.equal(v[COL.action].length, 64);
    assert.equal(v[COL.targetType].length, 64);
    assert.equal(v[COL.target].length, 255);
    assert.equal(v[COL.outcome].length, 16);
  });

  test("an IPv4-mapped address is recorded as plain IPv4, other addresses unchanged", async () => {
    // node reports a direct IPv4 client as ::ffff:a.b.c.d, X-Forwarded-For as a.b.c.d
    const cases = [
      ["::ffff:203.0.113.7", "203.0.113.7"],
      ["::FFFF:10.0.0.1", "10.0.0.1"],
      ["203.0.113.7", "203.0.113.7"],
      ["2001:db8::1", "2001:db8::1"],
      ["::ffff:abcd", "::ffff:abcd"],
      [undefined, null],
    ];
    for (const [ip, expected] of cases) {
      await Audit.log({ ip, action: "auth.login" });
      assert.equal(lastInsert().vars[COL.ip], expected, String(ip));
    }
  });

  test("a detail whose action throws on toString does not become an unhandled rejection", async () => {
    const hostile = { toString() { throw new Error("evil"); } };
    // the assertion is that this resolves rather than rejecting
    await Audit.log({ action: hostile });
    assert.ok(true);
  });
});

describe("the scrubber covers auth, session and extravars shapes", () => {
  test("hyphenated headers, suffixed camelCase and extravars are all redacted", async () => {
    const SEC = "must-not-appear";
    await Audit.log({
      action: "probe",
      detail: {
        Authorization: SEC, authorization: SEC, cookie: SEC, "set-cookie": SEC,
        "x-api-key": SEC, "api-key": SEC, "ssh-key": SEC, bearer: SEC,
        session: SEC, sessionId: SEC, sid: SEC, csrf: SEC, xsrf: SEC,
        salt: SEC, hash: SEC, signature: SEC, sig: SEC, jwt: SEC, nonce: SEC,
        otp: SEC, mfa: SEC, pin: SEC, connectionString: SEC, dsn: SEC,
        apiKeyValue: SEC, keyMaterial: SEC, tokenHeader: SEC,
        extravars: SEC, extra_vars: SEC,
        // and these must SURVIVE
        monkey: "keep", turkey: "keep", url: "keep", status: "keep", name: "keep",
      },
    });
    const detail = lastInsert().vars[COL.detail];
    assert.equal(detail.includes(SEC), false, `a secret survived: ${detail.slice(0, 300)}`);
    for (const k of ["monkey", "turkey", "url", "status", "name"]) {
      assert.match(detail, new RegExp(`"${k}":"keep"`), `${k} should not be redacted`);
    }
  });
});
