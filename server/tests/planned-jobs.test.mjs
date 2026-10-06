// "Run later (one-time)" on a form, for a user with allowPlannedJobs.
//
// The button is shown on allowPlannedJobs (on for everyone by default) and it POSTs a
// one-time schedule to /api/v2/schedule - but that whole mount sat behind
// allowScheduledJobs, which is admin-only by default, so every non-admin who pressed it
// got "You do not have permission to manage scheduled jobs".
//
// Opening the mount is not enough on its own : a schedule launches as the 'Schedule
// Service' with the admin role and its extra_vars skip the reserved-key strip, so a
// planner would have been able to run any form, as admin, with any playbook. These tests
// pin the narrow door : a planner may only CREATE, only a one-time run, only of a form
// they may run - and the job runs as them, through the strip a browser launch gets.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

vi.mock("../src/lib/i18n.js", () => ({
  default: { t: (_req, key) => key },
}));

// what Job.launch receives, per test
let launched = null;
vi.mock("../src/models/job.model.js", () => ({
  default: { launch: async (args) => { launched = args; return { id: 42 }; } },
  // the real rule : the stricter of the form's own setting and the instance's (off here)
  launchValidationMode: (formObj) => formObj?.launchValidation || "off",
}));

vi.mock("../src/services/cron.service.js", () => ({
  default: { removeSchedule: () => {}, addSchedule: () => {} },
}));

// the forms each role may run : 'Demo Form' for 'users', 'Admin Form' for admins only
vi.mock("../src/models/form.model.js", () => ({
  default: {
    load: async (roles, name) => {
      const forms = { "Demo Form": ["users"], "Admin Form": ["admin"], "Strict Form": ["users"] };
      if (!forms[name]) return { forms: [] };
      const launchValidation = name === "Strict Form" ? "enforce" : undefined;
      if (roles.includes("admin") || forms[name].some((r) => roles.includes(r))) return { forms: [{ name, launchValidation }] };
      // what the real Form.load does for a named form the roles do not reach
      const err = new Error(`Access denied to form ${name}.`);
      err.name = "AccessDeniedError";
      throw err;
    },
  },
}));

const Middleware = (await import("../src/lib/middleware.js")).default;
const { default: Schedule } = await import("../src/models/schedule.model.js");
const { default: CrudModel } = await import("../src/models/crud.model.js");

const planner = {
  id: 2, username: "bob", type: "local", groups: ["local/users"], roles: ["users", "public"],
  options: { allowPlannedJobs: true, allowScheduledJobs: false, allowVerboseMode: false },
};
const scheduler = { ...planner, options: { allowPlannedJobs: true, allowScheduledJobs: true } };
const nobody = { ...planner, options: { allowPlannedJobs: false, allowScheduledJobs: false } };

const runAt = "2030-01-01 10:00:00";
const planBody = (extra = {}) => ({
  name: "bob later", one_time_run: true, form: "Demo Form", extra_vars: "username: x\n", run_at: runAt, ...extra,
});

// ─── the route guard ───────────────────────────────────────────────

function guard(user, method, path) {
  const res = { statusCode: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = () => res;
  let nexted = false;
  Middleware.checkScheduleOrPlannedJobsMiddleware({ user: user && { user }, method, path }, res, () => { nexted = true; });
  return { status: res.statusCode, nexted };
}

describe("the /api/v2/schedule guard", () => {
  test("allowPlannedJobs alone may create", () => {
    assert.equal(guard(planner, "POST", "/").nexted, true,
      "'Run later' is offered on allowPlannedJobs, so creating must not answer 403");
  });

  test.each([
    ["GET", "/"], ["GET", "/1"], ["PUT", "/1"], ["DELETE", "/1"], ["POST", "/1/launch/"],
  ])("allowPlannedJobs alone may not %s %s", (method, path) => {
    const r = guard(planner, method, path);
    assert.equal(r.nexted, false, "a planner must not see or touch other schedules");
    assert.equal(r.status, 403);
  });

  test("allowScheduledJobs still reaches everything", () => {
    for (const [m, p] of [["GET", "/"], ["PUT", "/1"], ["DELETE", "/1"], ["POST", "/"]]) {
      assert.equal(guard(scheduler, m, p).nexted, true);
    }
  });

  test("neither option is 403, and no user is 401", () => {
    assert.equal(guard(nobody, "POST", "/").status, 403);
    assert.equal(guard(undefined, "POST", "/").status, 401);
  });
});

// ─── planning ──────────────────────────────────────────────────────

let created = null;
beforeEach(() => {
  created = null;
  launched = null;
  CrudModel.create = async (_model, data) => { created = { ...data }; return 7; };
});

describe("Schedule.plan", () => {
  test("a one-time run of a form the user may run is created, owned by the user", async () => {
    const id = await Schedule.plan(planner, planBody());
    assert.equal(id, 7);
    assert.equal(created.form, "Demo Form");
    assert.equal(created.one_time_run, true);
    assert.equal(created.run_at, runAt);
    const owner = JSON.parse(created.owner);
    assert.equal(owner.username, "bob");
    assert.deepEqual(owner.roles, ["users", "public"]);
  });

  test("a form the user may not run is refused", async () => {
    const hidden = await Schedule.plan(planner, planBody({ form: "Admin Form" })).catch((e) => e);
    const unknown = await Schedule.plan(planner, planBody({ form: "No Such Form" })).catch((e) => e);
    assert.equal(hidden.name, "AccessDeniedError");
    assert.equal(unknown.name, "AccessDeniedError");
    // the same words for both, so planning is no way to probe which forms exist
    assert.equal(hidden.message.replace("Admin Form", "X"), unknown.message.replace("No Such Form", "X"));
    assert.equal(created, null);
  });

  test("a recurring schedule is refused", async () => {
    await assert.rejects(Schedule.plan(planner, planBody({ one_time_run: false, cron: "* * * * *" })), { name: "AccessDeniedError" });
    await assert.rejects(Schedule.plan(planner, planBody({ cron: "* * * * *" })), { name: "AccessDeniedError" });
    assert.equal(created, null);
  });

  test("the request cannot choose the owner or the internal fields", async () => {
    const forged = JSON.stringify({ username: "admin", roles: ["admin"] });
    await Schedule.plan(planner, planBody({ owner: forged, state: "queued", queue_id: 1, status: "success" }));
    assert.equal(JSON.parse(created.owner).username, "bob");
    for (const key of ["state", "queue_id", "status", "output", "cron"]) {
      assert.equal(created[key], undefined, `${key} must not come from the request`);
    }
  });

  test("verbose needs allowVerboseMode, as on a direct launch", async () => {
    await assert.rejects(Schedule.plan(planner, planBody({ extra_vars: "__verbose__: true\n" })), { name: "AccessDeniedError" });
  });

  test("extra_vars must be a dictionary, and a run_at is required", async () => {
    await assert.rejects(Schedule.plan(planner, planBody({ extra_vars: "- a\n- b\n" })), { name: "BadRequestError" });
    await assert.rejects(Schedule.plan(planner, planBody({ run_at: null })), { name: "BadRequestError" });
  });

  test("the owner is the whole token user, so ansibleforms_user matches a browser launch", async () => {
    await Schedule.plan({ ...planner, type: "ldap", displayName: "Bob Builder" }, planBody());
    const owner = JSON.parse(created.owner);
    assert.equal(owner.displayName, "Bob Builder", "a field the token carries must not be dropped");
    assert.equal(owner.type, "ldap");
  });

  test("a form with launch validation 'enforce' is refused when planned, not when it fires", async () => {
    await assert.rejects(Schedule.plan(planner, planBody({ form: "Strict Form" })), { name: "BadRequestError" });
    assert.equal(created, null);
  });

  test("without allowPlannedJobs nothing is planned", async () => {
    await assert.rejects(Schedule.plan(nobody, planBody()), { name: "AccessDeniedError" });
  });

  test("an admin-level create cannot set an owner either", async () => {
    await Schedule.create({ name: "x", owner: "{}" });
    assert.equal(created.owner, undefined);
  });
});

// ─── running ───────────────────────────────────────────────────────

describe("Schedule.launch", () => {
  let row;
  beforeEach(() => {
    row = { id: 1, name: "n", form: "Demo Form", extra_vars: "a: 1", one_time_run: 1 };
    CrudModel.findById = async () => ({ ...row });
    CrudModel.update = async (_m, data) => { Object.assign(row, data); return { changedRows: 1 }; };
    CrudModel.delete = async () => ({ affectedRows: 1 });
  });

  test("a planned job runs as its owner, with the client-side reserved-key strip", async () => {
    row.owner = JSON.stringify({ username: "bob", type: "local", roles: ["users"], groups: [], options: {} });
    await Schedule.launch(1);
    assert.equal(launched.user.username, "bob");
    assert.deepEqual(launched.user.roles, ["users"], "it must not run with the admin role");
    assert.equal(launched.fromClient, true, "its extra_vars came from a request body");
    assert.equal(launched.extravars.schedule.owner, undefined);
  });

  test("an admin-level schedule still runs as the Schedule Service", async () => {
    await Schedule.launch(1);
    assert.equal(launched.user.username, "Schedule Service");
    assert.deepEqual(launched.user.roles, ["admin"]);
    assert.equal(launched.fromClient, false);
  });

  test("an unreadable owner fails the run instead of falling back to admin", async () => {
    row.owner = "not json";
    await Schedule.launch(1);
    assert.equal(launched, null, "nothing may run");
    assert.equal(row.status, "failed");
  });
});
