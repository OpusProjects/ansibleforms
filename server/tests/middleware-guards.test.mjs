// The route permission guards in src/lib/middleware.js.
//
// These had NO test at all, and they are the site of a documented, shipped bug: all of them
// originally answered 401 for a permission failure. App.vue registers a GLOBAL axios
// interceptor that treats any 401 as a dead session - it clears the token and bounces to the
// login page - so a settings-less user was logged straight out of the designer instead of
// getting an error the page could catch. In a non-English locale, where the message no longer
// matched the interceptor's English test, it fell through to the refresh branch, refreshed
// successfully (the token was always valid), retried, got 401 again, and looped for ever.
//
// The contract, one line: 403 = "I know who you are and you may not do this"; 401 = "I could
// not establish who you are at all". These tests pin it for every guard, so the next one added
// through permissionGuard inherits the coverage.
import { test, describe, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// i18n reaches the locale files; keep it out of the way and make the key visible in the
// response so each guard's own message can be identified.
vi.mock("../src/lib/i18n.js", () => ({
  default: { t: (_req, key) => key },
}));

const Middleware = (await import("../src/lib/middleware.js")).default;

// Minimal express-shaped double. `status()` must be chainable, and recording both parts lets
// a test assert the code AND that a body was actually sent.
function makeRes() {
  const res = { statusCode: null, body: null, sent: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.sent = true; return res; };
  return res;
}

function run(guard, user) {
  const res = makeRes();
  let nexted = false;
  guard({ user: user === undefined ? undefined : { user } }, res, () => { nexted = true; });
  return { res, nexted };
}

// name -> the option (or role) that grants it
const OPTION_GUARDS = [
  ["checkSettingsMiddleware", "showSettings"],
  ["checkDesignerMiddleware", "showDesigner"],
  ["checkLogsMiddleware", "showLogs"],
  ["checkBackupMiddleware", "allowBackupOps"],
  ["checkScheduledJobsMiddleware", "allowScheduledJobs"],
  ["checkStoredJobsMiddleware", "allowStoredJobs"],
];

const withOption = (opt, value) => ({ roles: [], options: { [opt]: value } });

describe("every guard exists and is a middleware", () => {
  const ALL = [...OPTION_GUARDS.map(([n]) => n), "checkAdminMiddleware", "checkSettingsOrScheduledJobsMiddleware"];

  test("all nine are exported as 3-argument middlewares", () => {
    for (const name of ALL) {
      assert.equal(typeof Middleware[name], "function", `${name} is not a function`);
      assert.equal(Middleware[name].length, 3, `${name} is not (req,res,next)`);
    }
  });
});

describe("a permission failure is 403, never 401", () => {
  for (const [name, option] of OPTION_GUARDS) {
    test(`${name} answers 403 when ${option} is false`, () => {
      const { res, nexted } = run(Middleware[name], withOption(option, false));
      assert.equal(res.statusCode, 403, "401 here logs the user out via App.vue's interceptor");
      assert.equal(nexted, false, "a refused request must not continue to the handler");
      assert.ok(res.sent, "the client needs a body to show an error");
    });

    test(`${name} answers 403 when ${option} is absent entirely`, () => {
      // absent is not the same shape as false, and both must be refused
      const { res, nexted } = run(Middleware[name], { roles: [], options: {} });
      assert.equal(res.statusCode, 403);
      assert.equal(nexted, false);
    });

    test(`${name} calls next() when ${option} is true`, () => {
      const { res, nexted } = run(Middleware[name], withOption(option, true));
      assert.equal(nexted, true);
      assert.equal(res.statusCode, null, "a permitted request must not get a response here");
    });
  }

  test("checkAdminMiddleware answers 403 for a non-admin and passes an admin", () => {
    let r = run(Middleware.checkAdminMiddleware, { roles: ["public"], options: {} });
    assert.equal(r.res.statusCode, 403);
    assert.equal(r.nexted, false);
    r = run(Middleware.checkAdminMiddleware, { roles: ["admin"], options: {} });
    assert.equal(r.nexted, true);
  });

  // Either right is enough : the schedules page is gated on allowScheduledJobs, but its form
  // dropdown reads a list that is deliberately not role-filtered, so it stays behind a
  // permission and both administrative rights open it.
  test("checkSettingsOrScheduledJobsMiddleware accepts either option and refuses neither", () => {
    assert.equal(run(Middleware.checkSettingsOrScheduledJobsMiddleware, withOption("showSettings", true)).nexted, true);
    assert.equal(run(Middleware.checkSettingsOrScheduledJobsMiddleware, withOption("allowScheduledJobs", true)).nexted, true);
    const denied = run(Middleware.checkSettingsOrScheduledJobsMiddleware, { roles: [], options: {} });
    assert.equal(denied.res.statusCode, 403);
    assert.equal(denied.nexted, false);
  });

  test("the refusal names the specific permission, not just 'no access'", () => {
    // the detail key differs per guard, which is what makes the error actionable
    const keys = new Set();
    for (const [name] of OPTION_GUARDS) {
      const { res } = run(Middleware[name], { roles: [], options: {} });
      keys.add(JSON.stringify(res.body));
    }
    assert.equal(keys.size, OPTION_GUARDS.length, "every guard should report its own reason");
  });
});

describe("401 is reserved for 'who are you'", () => {
  // The defensive path. authobj should already have rejected these, so reaching a guard with
  // no user means the token layer failed - which IS a session problem, and the one case where
  // sending the client to the login page is correct.
  for (const shape of [undefined, null, {}, { roles: [] }]) {
    test(`a malformed user (${JSON.stringify(shape)}) is 401, not 403`, () => {
      const res = makeRes();
      let nexted = false;
      // `{}` and `{roles:[]}` have no options, so hasPermission throws inside the guard
      Middleware.checkSettingsMiddleware({ user: shape === undefined ? undefined : { user: shape } }, res, () => { nexted = true; });
      assert.equal(res.statusCode, 401, "a request we cannot attribute is an auth problem");
      assert.equal(nexted, false);
    });
  }

  test("an authenticated user without the option is NOT 401", () => {
    // the whole point: these two cases must not collapse into one status
    const { res } = run(Middleware.checkSettingsMiddleware, { roles: [], options: { showSettings: false } });
    assert.notEqual(res.statusCode, 401);
    assert.equal(res.statusCode, 403);
  });
});

// ─── a job you may not see must be refused, not answered ──────
//
// Job.findById throws AccessDeniedError when the row does not match the caller, but the
// function's own catch turned that into `return []` - so the controller's 403 branch
// could never run. GET /api/v2/job/<someone else's id> answered 200 with an empty body,
// the download route produced an empty attachment, and approve/reject read job.approval
// off [] as undefined, skipping the block that checks the caller against the job's
// approval roles.
describe("Job.findById reports a refusal instead of an empty job", () => {
  const src = readFileSync(path.join(here, "../src/models/job.model.js"), "utf8");
  const fn = src.slice(src.indexOf("Job.findById = async function"), src.indexOf("Job.getRawFormData ="));

  test("the slice really is the function, so these assertions are not vacuous", () => {
    assert.match(fn, /AccessDeniedError/);
  });

  test("its catch rethrows rather than answering []", () => {
    const tail = fn.slice(fn.lastIndexOf("} catch (err) {"));
    assert.match(tail, /throw err;/);
    // comments stripped : the comment explaining the fix quotes the old `return []`
    assert.doesNotMatch(tail.replace(/\/\/[^\n]*/g, ""), /return \[\]/);
  });
});

describe("approve and reject answer the right status", () => {
  const src = readFileSync(path.join(here, "../src/controllers/v2/job.controller.js"), "utf8");

  // Bounded by the NEXT declaration, not by a character count: a fixed window spilled
  // into the following function, so reverting approveJob alone still found rejectJob's
  // mapping and the test passed against the bug.
  test.each([
    ["approveJob", "const approveJob", "const rejectJob"],
    ["rejectJob", "const rejectJob", "export default {"],
  ])("%s maps AccessDeniedError to 403 and ConflictError to 409", (name, marker, next) => {
    const start = src.indexOf(marker);
    const end = src.indexOf(next, start + 1);
    assert.ok(start > -1 && end > start, `${name} not found`);
    const fn = src.slice(start, end);
    assert.ok(fn.includes(`jobs.failed`), "the slice must be the handler");
    // a bare 500 tells the caller the server broke, AND auditMiddleware files only
    // 401/403 as outcome='denied' - so a refused approval was recorded as a 'failure'
    // and disappeared from the denied filter
    assert.match(fn, /err\.name === 'AccessDeniedError'/, `${name} still answers 500 for a refusal`);
    assert.match(fn, /res\.status\(403\)/);
    assert.match(fn, /err\.name === 'ConflictError'/);
    assert.match(fn, /res\.status\(409\)/);
  });
});

// The chat assistant and the MCP server each have their own role option, both on unless a
// role turns them off (`!== false`) : turning the chat off no longer closes the MCP server.
describe("the chat and MCP guards follow their own option", () => {
  for (const [guard, opt, other] of [
    ["checkChatMiddleware", "allowChat", "allowMcp"],
    ["checkMcpMiddleware", "allowMcp", "allowChat"],
  ]) {
    test(`${guard} lets through ${opt} true or unset, and refuses ${opt} false with 403`, () => {
      assert.equal(run(Middleware[guard], withOption(opt, true)).nexted, true);
      assert.equal(run(Middleware[guard], { roles: [], options: {} }).nexted, true);
      const { res, nexted } = run(Middleware[guard], withOption(opt, false));
      assert.equal(nexted, false);
      assert.equal(res.statusCode, 403);
    });
    test(`${guard} ignores ${other}`, () => {
      assert.equal(run(Middleware[guard], { roles: [], options: { [opt]: true, [other]: false } }).nexted, true);
    });
  }
});
