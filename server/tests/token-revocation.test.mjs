// Revoked tokens (lib/tokenRevocation.js) : a logout ends its session, a password change every
// session of the user issued before it.
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let table = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/^SELECT `key`, revoked_before/.test(sql)) return table;
      return { affectedRows: 1 };
    },
    tryDo: async () => [],
  },
}));

const { isRevoked, revokeSession, revokeUser, newSessionId, resetRevocationsForTests } = await import("../src/lib/tokenRevocation.js");

const now = () => Math.floor(Date.now() / 1000);
const token = (extra = {}) => ({ user: { username: "bob", type: "local" }, sid: "s1", iat: now() - 10, ...extra });

beforeEach(() => {
  table = [];
  resetRevocationsForTests();
});

describe("a token", () => {
  test("nothing revoked : valid", async () => {
    expect(await isRevoked(token())).toBe(false);
  });

  test("its session logged out : revoked, another session is not", async () => {
    await revokeSession("s1", Date.now() + 3600 * 1000);
    expect(await isRevoked(token())).toBe(true);
    expect(await isRevoked(token({ sid: "s2" }))).toBe(false);
  });

  test("its user changed the password after it was issued, or in the same second : revoked ; a token issued after is not", async () => {
    await revokeUser("bob", "local", 86400);
    expect(await isRevoked(token())).toBe(true);
    expect(await isRevoked(token({ iat: now() }))).toBe(true);
    expect(await isRevoked(token({ iat: now() + 1 }))).toBe(false);
    // another user, or the same name of another type, is untouched
    expect(await isRevoked(token({ user: { username: "bob", type: "ldap" } }))).toBe(false);
  });

  test("revocations made on another node are read from the table", async () => {
    table = [
      { key: "sid:s9", revoked_before: null, exp: now() + 3600 },
      { key: "user:local/carol", revoked_before: now(), exp: now() + 3600 },
    ];
    expect(await isRevoked(token({ sid: "s9" }))).toBe(true);
    expect(await isRevoked(token({ user: { username: "carol", type: "local" } }))).toBe(true);
  });

  test("session ids are unique", () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSessionId()).not.toBe(newSessionId());
  });
});
