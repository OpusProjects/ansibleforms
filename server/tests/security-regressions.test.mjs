// Regression tests for security defects found in a full-project review.
//
// Each one is a real, pre-existing hole with a concrete exploit path, and each test is
// written so that reverting the fix makes it fail. They are grouped here rather than by
// module because what they have in common is the failure mode: input the code trusted
// without checking who supplied it.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "fs";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let dbHandler = async () => [];
const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => { queries.push({ sql, vars }); return dbHandler(sql, vars); },
  },
}));

const { stripReservedExtravars, pushForminfoToExtravars } = await import("../src/models/job.model.js");
const Job = (await import("../src/models/job.model.js")).default;
const Helpers = (await import("../src/lib/common.js")).default;

beforeEach(() => { queries.length = 0; dbHandler = async () => []; });

describe("the client cannot choose what a job actually runs", () => {
  // pushForminfoToExtravars only fills a `__x__` key when it is NOT already present, and
  // the launch controller passed req.body.extravars straight through - so pre-setting one
  // beat the form definition. __playbook__ ran a playbook the form role filter existed to
  // keep the caller away from; combined with the upload endpoint it was arbitrary code.
  const RESERVED = ["__playbook__", "__playbookSubPath__", "__inventory__", "__tags__",
                    "__limit__", "__credentials__", "__ansibleCredentials__",
                    "__vaultCredentials__", "__keepExtravars__", "__awxCredentials__",
                    // where the job runs : a caller must not pick another runner (8.0)
                    "__runner__", "__awx__"];

  for (const key of RESERVED) {
    test(`${key} supplied by the client is removed`, () => {
      const out = stripReservedExtravars({ hostname: "web01", [key]: "attacker-value" });
      assert.equal(key in out, false, `${key} must not survive`);
      assert.equal(out.hostname, "web01", "ordinary fields must be untouched");
    });
  }

  // the one reserved key that IS a legitimate client choice - the controller checks
  // allowVerboseMode before this runs
  test("__verbose__ is kept, because it is a real client choice", () => {
    assert.equal(stripReservedExtravars({ __verbose__: true }).__verbose__, true);
  });

  test("a field that merely looks similar is not stripped", () => {
    const out = stripReservedExtravars({ __playbook: 1, playbook__: 2, my__var__name: 3 });
    assert.deepEqual(out, { __playbook: 1, playbook__: 2, my__var__name: 3 });
  });

  // ...but a form that DECLARES the field is a different case entirely.
  //
  // "You can also dynamically set the template by using a field called `__template__`" is a
  // documented feature (help.yaml), and the same is written for __playbook__, __inventory__
  // and __tags__. Such a field lives in config.yaml, so it is the FORM author's decision -
  // it just happens to travel in the request like every other field value. Stripping it
  // unconditionally did not fail the launch: the key was dropped, pushForminfoToExtravars
  // refilled it from the STATIC form property, and the job ran the wrong template while
  // reporting success. The form definition is what tells an author's declaration apart from
  // a key an attacker invented, so it is the gate.
  describe("a form may declare a reserved field, and then it is honoured", () => {
    const formWith = (...names) => ({ fields: names.map((name) => ({ name, type: "text" })) });

    for (const key of ["__template__", "__playbook__", "__inventory__", "__tags__", "__limit__"]) {
      test(`${key} survives when the form declares it`, () => {
        const out = stripReservedExtravars({ [key]: "chosen-by-the-form" }, formWith(key));
        assert.equal(out[key], "chosen-by-the-form", `${key} is a documented dynamic override`);
      });
    }

    test("declaring one reserved field does not admit the others", () => {
      const out = stripReservedExtravars(
        { __template__: "ok", __playbook__: "attacker", __credentials__: { a: 1 } },
        formWith("__template__")
      );
      assert.equal(out.__template__, "ok");
      assert.equal("__playbook__" in out, false, "only the DECLARED key may pass");
      assert.equal("__credentials__" in out, false);
    });

    test("a multistep step's fields count as declarations", () => {
      const form = { steps: [{ fields: [{ name: "host" }] }, { fields: [{ name: "__template__" }] }] };
      assert.equal(stripReservedExtravars({ __template__: "step-chosen" }, form).__template__, "step-chosen");
    });

    test("a form declaring nothing still strips everything, as before", () => {
      const out = stripReservedExtravars({ __template__: "attacker" }, { fields: [{ name: "hostname" }] });
      assert.equal("__template__" in out, false);
    });

    test("a malformed form definition cannot open the gate", () => {
      for (const form of [null, undefined, {}, { fields: null }, { fields: [null, {}, { name: 5 }] }, { steps: [null] }]) {
        const out = stripReservedExtravars({ __playbook__: "attacker" }, form);
        assert.equal("__playbook__" in out, false, `opened by ${JSON.stringify(form)}`);
      }
    });
  });

  test("a non-object body cannot crash the launch path", () => {
    assert.deepEqual(stripReservedExtravars(undefined), {});
    assert.deepEqual(stripReservedExtravars(null), {});
    assert.deepEqual(stripReservedExtravars("nope"), {});
  });
});

describe("aborting someone else's job is refused", () => {
  // Job.abort took only an id - no user, no ownership test - so any authenticated user
  // could kill any running playbook. Every sibling (delete, findById) filters on
  // j.user/j.user_type, and the AccessDeniedError branch in both controllers was dead code.
  const owner = { username: "alice", type: "local", roles: [], options: {} };
  const other = { username: "mallory", type: "local", roles: [], options: {} };
  const admin = { username: "root", type: "local", roles: ["admin"], options: {} };

  // job 7 exists and belongs to alice. Note checkExists writes `WHERE id = ?` (spaced)
  // while the ownership probe writes `WHERE id=? AND user=?` - match the specific one first.
  const existsAndOwnedBy = (who) => async (sql) => {
    if (/AND user=\? AND user_type=\?/.test(sql)) {
      return who === "alice" ? [{ id: 7 }] : [];
    }
    if (/SELECT id FROM AnsibleForms.`jobs` WHERE id = \?/.test(sql)) return [{ id: 7 }];
    return [];
  };

  test("a stranger is refused with 403, and no abort is written", async () => {
    dbHandler = existsAndOwnedBy("mallory");
    await assert.rejects(() => Job.abort(other, 7), (e) => e.name === "AccessDeniedError");
    assert.equal(queries.some((q) => /abort_requested=1/.test(q.sql)), false,
      "a refused abort must not have flagged the job");
  });

  test("no user at all is refused", async () => {
    dbHandler = existsAndOwnedBy("alice");
    await assert.rejects(() => Job.abort(undefined, 7), (e) => e.name === "AccessDeniedError");
    await assert.rejects(() => Job.abort({}, 7), (e) => e.name === "AccessDeniedError");
  });

  test("the owner gets past the ownership check", async () => {
    dbHandler = existsAndOwnedBy("alice");
    // it may still fail later (no running row to update); what matters is that it did NOT
    // fail with AccessDenied
    await Job.abort(owner, 7).catch((e) => {
      assert.notEqual(e.name, "AccessDeniedError", "the owner must not be refused");
    });
  });

  test("an admin gets past the ownership check without owning it", async () => {
    dbHandler = existsAndOwnedBy("mallory");
    await Job.abort(admin, 7).catch((e) => {
      assert.notEqual(e.name, "AccessDeniedError", "an admin must not be refused");
    });
  });
});

describe("deleting someone else's job that waits for approval is refused", () => {
  // Job.delete reused the non-admin query of Job.findById, including its
  // `OR (j.status='approve')` - there so an approver can open a pending job. For a delete
  // that meant any signed-in user could remove another user's job awaiting approval
  // through the API ; the UI only hid the button.
  const owner = { username: "alice", type: "local", roles: [], options: {} };
  const other = { username: "mallory", type: "local", roles: ["approvers"], options: {} };
  const admin = { username: "root", type: "local", roles: ["admin"], options: {} };
  const seesAll = { username: "auditor", type: "local", roles: [], options: { showAllJobLogs: true } };

  // job 7 belongs to alice and waits for approval. The SELECT is answered the way MySQL
  // would answer it : the row comes back when the WHERE the model wrote lets it through.
  const row = { id: 7, user: "alice", user_type: "local", status: "approve" };
  const pendingJobOfAlice = async (sql, vars) => {
    if (/SELECT id FROM AnsibleForms.`jobs` WHERE id = \?/.test(sql)) return [{ id: 7 }];
    if (/^SELECT j\.\*/.test(sql)) {
      const ownerFilter = /j\.user=\? AND j\.user_type=\?/.test(sql);
      if (!ownerFilter) return [row]; // admin / showAllJobLogs query
      const [username, type] = vars.slice(-2);
      const owns = username === row.user && type === row.user_type;
      const approveShortcut = /j\.status='approve'/.test(sql) && row.status === "approve";
      return owns || approveShortcut ? [row] : [];
    }
    return { affectedRows: 1 };
  };
  const deleted = () => queries.some((q) => /^DELETE FROM AnsibleForms.`jobs`/.test(q.sql));

  let sendEventNotification;
  beforeEach(() => {
    sendEventNotification = Job.sendEventNotification;
    Job.sendEventNotification = async () => {};
    dbHandler = pendingJobOfAlice;
  });
  afterEach(() => { Job.sendEventNotification = sendEventNotification; });

  test("another user is refused with 403, and nothing is deleted", async () => {
    await assert.rejects(() => Job.delete(other, 7), (e) => e.name === "AccessDeniedError");
    assert.equal(deleted(), false, "a refused delete must not have removed the job");
  });

  test("the owner may delete it", async () => {
    await Job.delete(owner, 7);
    assert.equal(deleted(), true);
  });

  test("an admin may delete it", async () => {
    await Job.delete(admin, 7);
    assert.equal(deleted(), true);
  });

  test("a user with showAllJobLogs may delete it", async () => {
    await Job.delete(seesAll, 7);
    assert.equal(deleted(), true);
  });
});

describe("job output cannot inject html", () => {
  // formatOutput's WORKFLOW branch concatenated the RAW line while every other branch used
  // the escaped one. The line it matches carries an AWX workflow NODE NAME - set in AWX, a
  // different trust domain - and the output is rendered with v-html, with the tokens in
  // localStorage.
  test("an AWX workflow node name is escaped", () => {
    const payload = 'WORKFLOW NODE [<img src=x onerror=alert(1)>] (successful) ****';
    const out = Helpers.formatOutput([{ output: payload, output_type: "stdout" }]);
    const html = typeof out === "string" ? out : JSON.stringify(out);
    assert.equal(html.includes("<img"), false, "the raw tag must not survive");
    assert.ok(html.includes("&lt;img"), "it must appear escaped");
  });

  test("the branch still colours the line it matched", () => {
    const out = Helpers.formatOutput([{ output: "WORKFLOW NODE [ok] (successful) ***", output_type: "stdout" }]);
    const html = typeof out === "string" ? out : JSON.stringify(out);
    assert.ok(/has-text-success/.test(html), "the status colour is the point of the branch");
  });

  // the sibling branches were already correct - pin them so a future edit cannot regress
  for (const [name, line] of [["warning", "[WARNING] <b>x</b>"], ["error", "[ERROR] <b>x</b>"]]) {
    test(`the ${name} branch escapes too`, () => {
      const out = Helpers.formatOutput([{ output: line, output_type: "stdout" }]);
      const html = typeof out === "string" ? out : JSON.stringify(out);
      assert.equal(html.includes("<b>"), false);
    });
  }
});


describe("a relaunch cannot smuggle verbose mode past the permission", () => {
  // The stored extravars carry whatever the ORIGINAL launch used. The controller checks the
  // ?verbose= query parameter but never looked at what was already in the row, so a user
  // without allowVerboseMode could relaunch a verbose job - or any job in 'approve', which
  // findById deliberately exposes to everyone - and get -vvv output.
  //
  // Asserted on the SOURCE rather than by calling relaunch: Form.load runs first and throws
  // NotFoundError before this code is reached, so a runtime test would need the whole form
  // config stack mocked to prove one ordering. Saying that plainly beats a test that looks
  // behavioural but only proves the mock.
  const src = readFileSync(new URL("../src/models/job.model.js", import.meta.url), "utf8");
  const relaunch = src.slice(src.indexOf("Job.relaunch = async function"),
                             src.indexOf("Job.relaunch = async function") + 2500);

  test("the stored __verbose__ is deleted before the flag is re-applied", () => {
    const del = relaunch.indexOf('delete extravars["__verbose__"]');
    const set = relaunch.indexOf('extravars["__verbose__"] = true');
    assert.ok(del > -1, "the stored value must be dropped");
    assert.ok(del < set, "it must be dropped BEFORE the requested value is applied");
  });

  test("asking for verbose re-checks allowVerboseMode", () => {
    assert.match(relaunch, /allowVerboseMode/);
    assert.match(relaunch, /AccessDeniedError/);
  });
});

describe("a credential that cannot be resolved does not stop the job", () => {
  // 6.3 made an unresolvable credential fail the job. That was reverted on purpose
  // ("don't crash on unfound credentials"): the credential stays unset and the playbook
  // runs without that extra var, as it did before 6.3. What is kept from 6.3 is the log
  // line naming WHICH credential failed, so the operator can find it afterwards.
  test("the failure is logged with the credential key and the job carries on", async () => {
    const { readFileSync } = await import("fs");
    // the resolution loop moved from the job model into the credential model in 7.x
    const src = readFileSync(new URL("../src/models/job.model.js", import.meta.url), "utf8")
      + readFileSync(new URL("../src/models/credential.model.v2.js", import.meta.url), "utf8");
    // the pre 6.3 shape logged the error without saying which credential it was
    assert.equal(/logger\.error\("Cannot get credential\." \+ err\)/.test(src), false,
      "the log line must name the credential");
    assert.match(src, /logger\.error\(`Cannot resolve credential '\$\{key\}'/,
      "the resolution failure must be logged with its key");
    assert.equal(/throw new Error\(`Cannot resolve credential/.test(src), false,
      "an unresolvable credential must not abort the launch");
    assert.equal(/Failed to process credentials[\s\S]{0,200}endJobStatus\(jobid, 1, "stderr", "failed"/.test(src), false,
      "and it must not fail the job");
  });
});


describe("changing a password requires the current one", () => {
  // A stolen access token expires; an account takeover does not. The endpoint updated the
  // caller's row straight from req.body with no re-authentication, and did not strip `id`
  // (a writable field in crud.config).
  //
  // The trap this pins: User.authenticate RESOLVES with { isValid: false } for a wrong
  // password rather than rejecting, so a try/catch around it catches NOTHING. My first
  // version of this fix did exactly that and let every wrong password through - verified
  // the hard way, by changing the dev admin's password with the wrong one.
  const src = readFileSync(new URL("../src/controllers/v2/user.controller.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("const changePassword"), src.indexOf("const find ="));

  test("the result is INSPECTED, not merely awaited in a try/catch", () => {
    // strip comments first : the explanation above this code says the word 'isValid', so a
    // bare /isValid/ matched the PROSE and passed against the broken version
    const code = fn.replace(/\/\/[^\n]*/g, "");
    assert.match(code, /if \(!\s*check\?\.isValid\)/,
      "a wrong password RESOLVES with {isValid:false}, so the flag must be tested");
  });

  test("a missing current password is refused before any write", () => {
    const guard = fn.indexOf("currentPasswordRequired");
    const write = fn.indexOf("User.update");
    assert.ok(guard > -1 && guard < write, "the guard must come before the update");
  });

  test("a wrong current password answers 403, not 401", () => {
    // 401 would trip App.vue's interceptor and log the user out mid-change
    assert.match(fn, /status\(403\)[\s\S]{0,120}currentPasswordWrong/);
  });

  test("the check only applies when a password is actually being set", () => {
    assert.match(fn, /if \(req\.body\.password\) \{/, "updating an email must not need it");
  });

  test("id, username and group_id are all stripped from the body", () => {
    for (const field of ["id", "username", "group_id"]) {
      assert.match(fn, new RegExp(`delete req\\.body\\.${field}\\b`), `${field} must not be settable here`);
    }
  });

  test("a refused attempt is audited", () => {
    assert.match(fn, /action: 'user\.password\.update'/);
    assert.match(fn, /outcome: 'denied'/);
  });
});

describe("the form's scm_branch reaches AWX", () => {
  // The schema and the designer write scm_branch ; the reserved key the AWX launch reads is
  // __scmBranch__. The static property was silently dropped between the two.
  test("scm_branch becomes __scmBranch__, and a field value still wins", () => {
    const ev = {};
    pushForminfoToExtravars({ name: "f", type: "awx", template: "t", scm_branch: "dev" }, ev);
    assert.equal(ev.__scmBranch__, "dev");
    const dyn = { __scmBranch__: "feature-1" };
    pushForminfoToExtravars({ name: "f", type: "awx", template: "t", scm_branch: "dev" }, dyn);
    assert.equal(dyn.__scmBranch__, "feature-1");
  });
});
