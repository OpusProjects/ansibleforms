// What of the launching user reaches the playbook as `ansibleforms_user`.
//
// The whole user object has always been injected, unconditionally. With a directory login
// that is the user's complete group membership - a hundred entries is ordinary for AD -
// plus every resolved role option, so a form with ten useful variables ships a hundred
// lines of extravars nothing reads, and that membership is then persisted in the AWX job
// and in jobs.extravars for anyone with read access to the job.
//
// Two properties are being pinned here, and the first is the important one:
//
//   * the DEFAULT does not change. https://ansibleforms.com/faq recommends asserting on
//     ansibleforms_user.groups inside a playbook as a defence in depth check, so trimming
//     by default would silently weaken a check somebody wrote deliberately.
//   * under `none` the key must be REMOVED, not merely left unassigned. A client controls
//     req.body.extravars, the launch controllers overwrite ansibleforms_user with the real
//     user - and under `none` there is nothing to overwrite it with, so skipping the
//     assignment would let a forged object stand in for the one the setting took away.
import { test, describe, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "fs";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const Helpers = (await import("../src/lib/common.js")).default;
// the STUB - vitest aliases '../../config/app.config.js', the specifier common.js uses, to
// tests/__mocks__/app.config.js, so this is the object the helper actually reads
const appConfig = (await import("./__mocks__/app.config.js")).default;

const before = { ...appConfig };
beforeEach(() => { appConfig.extravarsUserFields = ""; });
afterAll(() => { Object.assign(appConfig, before); });

const USER = {
  username: "jane.doe",
  email: "jane.doe@example.com",
  type: "ldap",
  groups: ["ldap/AF_Admins", "ldap/AZ_Everyone", "ldap/IT Services Community Hub"],
  roles: ["admin", "public"],
  options: { showDebugButtons: true, allowVerboseMode: true },
};

describe("the default is the behaviour every release before this one had", () => {
  test("unset sends the whole object", () => {
    expect(Helpers.userForExtravars(USER)).toBe(USER);
  });

  test("and so does an empty string, which is what an unset env var parses to", () => {
    appConfig.extravarsUserFields = "";
    expect(Helpers.userForExtravars(USER)).toBe(USER);
  });

  test("a list of nothing but separators is not a list", () => {
    // " , , " would otherwise produce {} - every key gone, from a field somebody fumbled
    appConfig.extravarsUserFields = " , , ";
    expect(Helpers.userForExtravars(USER)).toBe(USER);
  });
});

describe("the global setting", () => {
  test("keeps only the named keys", () => {
    appConfig.extravarsUserFields = "username,email,type";
    expect(Helpers.userForExtravars(USER)).toEqual({
      username: "jane.doe", email: "jane.doe@example.com", type: "ldap",
    });
  });

  test("drops the groups and the options, which is the point", () => {
    appConfig.extravarsUserFields = "username";
    const out = Helpers.userForExtravars(USER);
    expect(out).not.toHaveProperty("groups");
    expect(out).not.toHaveProperty("options");
    expect(out).not.toHaveProperty("roles");
  });

  test("tolerates the spacing a human types", () => {
    appConfig.extravarsUserFields = " username , ,email ";
    expect(Helpers.userForExtravars(USER)).toEqual({
      username: "jane.doe", email: "jane.doe@example.com",
    });
  });

  test("a key the user does not have is absent, not present and undefined", () => {
    // a playbook asking `ansibleforms_user.email is defined` must not see an empty key
    appConfig.extravarsUserFields = "username,nosuchkey";
    const out = Helpers.userForExtravars(USER);
    expect(Object.keys(out)).toEqual(["username"]);
  });

  test("none means no object at all", () => {
    appConfig.extravarsUserFields = "none";
    expect(Helpers.userForExtravars(USER)).toBeUndefined();
  });

  test("all means the whole object, said out loud", () => {
    appConfig.extravarsUserFields = "all";
    expect(Helpers.userForExtravars(USER)).toBe(USER);
  });

  test("none and all are not case sensitive", () => {
    appConfig.extravarsUserFields = "NONE";
    expect(Helpers.userForExtravars(USER)).toBeUndefined();
    appConfig.extravarsUserFields = "All";
    expect(Helpers.userForExtravars(USER)).toBe(USER);
  });

  test("the synthetic schedule user is filtered like any other", () => {
    appConfig.extravarsUserFields = "username,type";
    const service = { id: 0, username: "Schedule Service", type: "schedule", groups: [], roles: ["admin"] };
    expect(Helpers.userForExtravars(service)).toEqual({ username: "Schedule Service", type: "schedule" });
  });
});

describe("a form overrides the global setting", () => {
  test("it can trim further than the instance does", () => {
    appConfig.extravarsUserFields = "";
    expect(Helpers.userForExtravars(USER, "username")).toEqual({ username: "jane.doe" });
  });

  test("it can ask for the whole object back", () => {
    // the form that actually uses ansibleforms_user.groups for playbook side authorization,
    // on an instance that trims everything else
    appConfig.extravarsUserFields = "username,email";
    expect(Helpers.userForExtravars(USER, "all")).toBe(USER);
  });

  test("it can opt out entirely", () => {
    appConfig.extravarsUserFields = "all";
    expect(Helpers.userForExtravars(USER, "none")).toBeUndefined();
  });

  test("absent means inherit, it does not mean 'all'", () => {
    appConfig.extravarsUserFields = "username";
    expect(Helpers.userForExtravars(USER, undefined)).toEqual({ username: "jane.doe" });
    expect(Helpers.userForExtravars(USER, "")).toEqual({ username: "jane.doe" });
  });
});

// ── the injection point ──────────────────────────────────────────────────────────────
//
// setUserExtravars is what Job.launch calls, and it is where the two behaviours that are
// not the helper's business live: the delete, and where the user object comes from.
const { setUserExtravars } = await import("../src/models/job.model.js");

describe("setUserExtravars", () => {
  test("puts the user in, trimmed to the form's own setting", () => {
    appConfig.extravarsUserFields = "";
    const ev = { target_hosts: "web01" };
    setUserExtravars(ev, USER, { userExtravars: "username,type" });
    expect(ev).toEqual({ target_hosts: "web01", ansibleforms_user: { username: "jane.doe", type: "ldap" } });
  });

  test("the form's setting beats the instance's", () => {
    appConfig.extravarsUserFields = "username";
    const ev = {};
    setUserExtravars(ev, USER, { userExtravars: "all" });
    expect(ev.ansibleforms_user).toBe(USER);
  });

  test("a form with no opinion follows the instance", () => {
    appConfig.extravarsUserFields = "username";
    const ev = {};
    setUserExtravars(ev, USER, { name: "some form" });
    expect(ev.ansibleforms_user).toEqual({ username: "jane.doe" });
  });

  test("under none the key is REMOVED, not left at undefined", () => {
    appConfig.extravarsUserFields = "none";
    const ev = { ansibleforms_user: { username: "jane.doe" } };
    setUserExtravars(ev, USER, {});
    expect("ansibleforms_user" in ev, "the key itself must be gone").toBe(false);
  });

  test("a client cannot forge the user object it is being denied", () => {
    // the exploit the delete exists for : under `none` there is no real user to overwrite
    // a submitted one with, so skipping the assignment would ship the forged object
    appConfig.extravarsUserFields = "none";
    const ev = { ansibleforms_user: { username: "root", roles: ["admin"] } };
    setUserExtravars(ev, USER, {});
    expect(ev.ansibleforms_user).toBeUndefined();
  });

  test("a client cannot forge the user object at all", () => {
    // `extravars` is req.body here. Anything the caller put in ansibleforms_user is a claim
    // about who they are, and the FAQ tells playbook authors to assert on exactly that -
    // so the authenticated user is the ONLY acceptable source for anything but a replay.
    appConfig.extravarsUserFields = "";
    const forged = { username: "root", type: "local", groups: ["ldap/Domain Admins"], roles: ["admin"] };
    const ev = { target_hosts: "web01", ansibleforms_user: forged };
    setUserExtravars(ev, USER, {});
    expect(ev.ansibleforms_user).toBe(USER);
    expect(ev.ansibleforms_user.groups).not.toContain("ldap/Domain Admins");
  });

  test("and cannot smuggle one past a trimming setting either", () => {
    appConfig.extravarsUserFields = "username";
    const ev = { ansibleforms_user: { username: "root", roles: ["admin"] } };
    setUserExtravars(ev, USER, {});
    expect(ev.ansibleforms_user).toEqual({ username: "jane.doe" });
  });

  test("a relaunch keeps the ORIGINAL submitter, not whoever pressed relaunch", () => {
    // Job.relaunch replays a stored job's extravars, which already carry the user who
    // submitted it. Rewriting that would make the audit trail say the wrong thing.
    appConfig.extravarsUserFields = "";
    const original = { username: "john.smith", type: "ldap" };
    const ev = { ansibleforms_user: original };
    setUserExtravars(ev, USER, {}, true);
    expect(ev.ansibleforms_user).toBe(original);
  });

  test("a relaunch of a job stored without a user does not make the relauncher the submitter", () => {
    // the original ran under `none`, so there is nobody stored to keep
    appConfig.extravarsUserFields = "";
    const ev = { target_hosts: "web01" };
    setUserExtravars(ev, USER, {}, true);
    expect("ansibleforms_user" in ev).toBe(false);
  });

  test("a schedule gets its own synthetic user", () => {
    appConfig.extravarsUserFields = "";
    const service = { id: 0, username: "Schedule Service", type: "schedule", groups: [], roles: ["admin"] };
    const ev = { schedule: { id: 3 } };
    setUserExtravars(ev, service, {});
    expect(ev.ansibleforms_user).toBe(service);
  });

  test("a schedule's extra_vars cannot forge the user either", () => {
    // whoever edits the schedule writes its extra_vars YAML, so an ansibleforms_user in
    // there is a claim, not a stored fact, and the service user must replace it
    appConfig.extravarsUserFields = "";
    const service = { id: 0, username: "Schedule Service", type: "schedule", groups: [], roles: ["admin"] };
    const ev = { schedule: { id: 3 }, ansibleforms_user: { username: "root", groups: ["ldap/Domain Admins"] } };
    setUserExtravars(ev, service, {});
    expect(ev.ansibleforms_user).toBe(service);
  });

  test("the whole object is still the default here too", () => {
    appConfig.extravarsUserFields = "";
    const ev = {};
    setUserExtravars(ev, USER, {});
    expect(ev.ansibleforms_user).toBe(USER);
  });
});

// ── where the flag comes from ────────────────────────────────────────────────────────
//
// setUserExtravars trusts a stored user only when asked to, so what matters is that only
// the relaunch asks, and that a multistep step's slice drops one the client put there.
describe("the callers", () => {
  const src = readFileSync(new URL("../src/models/job.model.js", import.meta.url), "utf8");

  test("only the relaunch replay launches with replay", () => {
    const hits = src.match(/replay: true/g) || [];
    expect(hits.length).toBe(1);
    // Job.relaunch hands a replay to replayJob (the stored extravars, launched again)
    const replay = src.slice(src.indexOf("async function replayJob("));
    expect(replay.slice(0, replay.indexOf("\n}\n")).includes("replay: true")).toBe(true);
  });

  test("a step slice under none has its own ansibleforms_user removed", () => {
    expect(src).toMatch(/ev\.ansibleforms_user = extravars\.ansibleforms_user;\s*\}\s*else\s*\{[^}]*delete ev\.ansibleforms_user;/);
  });
});
