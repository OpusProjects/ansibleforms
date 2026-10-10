// Failed logins : an account locks after LOGIN_MAX_FAILURES in a row, an address is held back
// after LOGIN_MAX_FAILURES_PER_IP (lib/loginThrottle.js), and the login refuses a locked attempt
// before any password is checked.
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let rows = [];
let lockedRows = 0;
const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      queries.push({ sql, params });
      if (/^SELECT `key`, failures/.test(sql)) return rows;
      if (/SET locked_until = NOW/.test(sql)) return { affectedRows: lockedRows };
      return { affectedRows: 1 };
    },
  },
}));

const appConfig = (await import("./__mocks__/app.config.js")).default;
const { keysFor, loginBlocked, loginFailed, loginSucceeded } = await import("../src/lib/loginThrottle.js");

beforeEach(() => {
  rows = [];
  lockedRows = 0;
  queries.length = 0;
  appConfig.loginMaxFailures = 5;
  appConfig.loginMaxFailuresPerIp = 30;
  appConfig.loginLockoutMinutes = 15;
});

describe("the keys", () => {
  test("an account is counted in lower case, an address as it is", () => {
    expect(keysFor("Bob", "10.0.0.1")).toEqual({ user: "user:bob", ip: "ip:10.0.0.1" });
    expect(keysFor("", null)).toEqual({ user: null, ip: null });
  });
});

describe("blocked", () => {
  test("a locked account, for the minutes left", async () => {
    rows = [{ key: "user:bob", failures: 5, left_s: 125, age_s: 60 }];
    expect(await loginBlocked("BOB", "10.0.0.1")).toEqual({ blocked: true, minutes: 3 });
  });

  test("a lock that ran out, or a count below the limit, is not", async () => {
    rows = [{ key: "user:bob", failures: 5, left_s: -10, age_s: 2000 }, { key: "ip:10.0.0.1", failures: 3, left_s: null, age_s: 10 }];
    expect(await loginBlocked("bob", "10.0.0.1")).toEqual({ blocked: false });
  });

  test("an address that failed too often within the window", async () => {
    rows = [{ key: "ip:10.0.0.1", failures: 30, left_s: null, age_s: 300 }];
    expect(await loginBlocked("anyone", "10.0.0.1")).toEqual({ blocked: true, minutes: 10 });
  });

  test("0 turns it all off, and nothing is read", async () => {
    appConfig.loginLockoutMinutes = 0;
    rows = [{ key: "user:bob", failures: 99, left_s: 999, age_s: 1 }];
    expect(await loginBlocked("bob", "10.0.0.1")).toEqual({ blocked: false });
    expect(queries.length).toBe(0);
  });
});

describe("counting", () => {
  test("a failure counts for the account and the address, and says when it locked", async () => {
    lockedRows = 1;
    expect(await loginFailed("bob", "10.0.0.1")).toBe(true);
    const inserts = queries.filter((q) => /^INSERT INTO AnsibleForms.`login_failures`/.test(q.sql)).map((q) => q.params[0]);
    expect(inserts).toEqual(["user:bob", "ip:10.0.0.1"]);
    const lock = queries.find((q) => /SET locked_until/.test(q.sql));
    expect(lock.params).toEqual([15, "user:bob", 5]);
  });

  test("a success clears the account", async () => {
    await loginSucceeded("Bob");
    expect(queries[0].sql).toMatch(/^DELETE FROM AnsibleForms.`login_failures`/);
    expect(queries[0].params).toEqual(["user:bob"]);
  });
});
