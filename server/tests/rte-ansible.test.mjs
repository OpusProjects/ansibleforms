// The RTE's playbook run (server/src/rte/ansible-core.js), the approval gate and which
// runner a job goes to (server/src/runners/orchestrator.js). A playbook job runs from its
// jobs row alone, so these tests drive it through the row, with ansible-playbook replaced
// by a fake process.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

let child;
const spawned = [];
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: vi.fn((file, args, options) => {
      child = new EventEmitter();
      child.pid = 5151;
      child.signalCode = null;
      child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
      child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
      child.stdin = Object.assign(new EventEmitter(), { end(data) { child.stdinWritten = data; } });
      // what ansible-playbook would read : the extravars files, while it runs
      const read = (name) => JSON.parse(fs.readFileSync(path.join(options.cwd, name), "utf8"));
      spawned.push({ file, args, options, extravars: read("extravars_11.json"), hidden: read("he_extravars_11.json") });
      return child;
    }),
  };
});

// the credentials table : resolved by name, nothing else
const credentialRows = {
  db: { name: "db", user: "dbuser", password: "dbpw", host: "db.local" },
  ssh: { name: "ssh", user: "root", password: "sshpw" },
  vault: { name: "vault", user: "", password: "v@ult" },
};
vi.mock("../src/models/credential.model.v2.js", () => ({
  default: {
    resolveCredentialMap: async (map) => {
      const out = {};
      for (const [key, name] of Object.entries(map || {})) if (credentialRows[name]) out[key] = { ...credentialRows[name] };
      return out;
    },
    resolveCredential: async (name) => {
      if (!credentialRows[name]) throw new Error(`no credential ${name}`);
      return { ...credentialRows[name] };
    },
  },
}));

// the runners table : by name, and the one marked default
let runnerRows = [];
vi.mock("../src/models/runner.model.js", () => ({
  default: {
    findByName: async (name) => runnerRows.find((r) => r.name === name) || undefined,
    findDefault: async (type) => runnerRows.find((r) => r.is_default && r.type === type) || null,
  },
}));

const jobExports = await import("../src/models/job.model.js");
const { default: Job } = jobExports;
const { default: mysql } = await import("../src/models/db.model.js");
const { default: Repository } = await import("../src/models/repository.model.js");
const core = await import("../src/rte/ansible-core.js");
const { dispatch, resolveRunner } = await import("../src/runners/orchestrator.js");
const { RUNNERS } = await import("../src/runners/index.js");

let jobRow;
let outputs;
mysql.do = async function (sql, params) {
  if (sql.includes("SELECT extravars, credentials FROM")) return [{ extravars: jobRow.extravars, credentials: jobRow.credentials }];
  if (sql.includes("MAX(`order`)")) return [{ last: outputs.reduce((m, o) => Math.max(m, o.order), 0) }];
  if (sql.includes("INSERT INTO AnsibleForms.`job_output`")) {
    outputs.push({ ...params[0] });
    return { insertId: outputs.length };
  }
  if (sql.includes("UPDATE AnsibleForms.`jobs` set ?")) {
    Object.assign(jobRow, params[0]);
    return { changedRows: 1 };
  }
  if (sql.includes("SELECT abort_requested")) return [{ abort_requested: 0 }];
  if (sql.includes("SET runner=?")) { jobRow.runner = params[0]; return { changedRows: 1 }; }
  if (sql.includes("SET job_log=?")) { jobRow.job_log = params[0]; return { changedRows: 1 }; }
  if (sql.includes("SELECT id FROM AnsibleForms.`jobs`")) return [{ id: params[0] }];
  return { changedRows: 1 };
};
Job.sendStatusNotification = async () => {};
const approvalMails = [];
Job.sendApprovalNotification = async (approval, extravars, jobid) => { approvalMails.push({ approval, jobid }); };

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-runner-"));
  vi.spyOn(Repository, "getAnsiblePath").mockResolvedValue(dir);
  outputs = [];
  spawned.length = 0;
  approvalMails.length = 0;
  runnerRows = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function row(extravars, credentials = {}) {
  jobRow = { id: 11, status: "running", extravars: JSON.stringify(extravars), credentials: JSON.stringify(credentials) };
}

async function runToEnd(start, exitCode = 0) {
  const done = start();
  await new Promise((r) => setTimeout(r, 20));
  child.emit("exit", exitCode);
  return done;
}

describe("the ansible-playbook arguments", () => {
  const files = { extravarsFileName: "e.json", hiddenExtravarsFileName: "he_e.json" };

  test("every option, values passed as they are", () => {
    const { args } = core.buildAnsibleArgs({
      __playbook__: "site.yml", __inventory__: ["hosts", "extra"], __tags__: "a,b", __check__: true,
      __diff__: true, __verbose__: true, __limit__: "web*",
    }, files);
    assert.deepEqual(args, [
      "-e", "@e.json", "-e", "@he_e.json",
      "-i", "hosts", "-i", "extra",
      "-t", "a,b", "--check", "--diff", "-vvv", "--limit", "web*", "site.yml",
    ]);
  });

  test("each inventory once : a list is never joined into a host list", () => {
    const one = core.buildAnsibleArgs({ __playbook__: "p.yml", __inventory__: "hosts" }, files).args;
    assert.deepEqual(one.filter((a, i) => one[i - 1] === "-i"), ["hosts"]);
    const adhoc = core.buildAnsibleArgs({ __playbook__: "p.yml", __inventory__: "web1,web2," }, files).args;
    assert.deepEqual(adhoc.filter((a, i) => adhoc[i - 1] === "-i"), ["web1,web2,"], "a host list the form meant stays one");
  });

  test("a value with quotes and spaces stays one argument", () => {
    const { args } = core.buildAnsibleArgs({ __playbook__: "my play.yml", __limit__: "it's \"x\"; rm -rf /" }, files);
    assert.deepEqual(args.slice(-3), ["--limit", "it's \"x\"; rm -rf /", "my play.yml"]);
  });

  test("a vault password adds the stdin reader, never the password itself", () => {
    const { args } = core.buildAnsibleArgs({ __playbook__: "p.yml" }, { ...files, vaultPassword: "secret" });
    assert.ok(args.includes("--vault-password-file=/bin/cat"));
    assert.equal(args.join(" ").includes("secret"), false);
  });
});

describe("a playbook job runs from its jobs row", () => {
  test("credentials, hidden credentials and the vault password are resolved from the names in the row", async () => {
    row({ __playbook__: "site.yml", __credentials__: { dbcred: "db" }, __ansibleCredentials__: "ssh", __vaultCredentials__: "vault" });
    const ok = await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.equal(ok, true);
    const run = spawned[0];
    assert.equal(run.file, "ansible-playbook");
    assert.equal(run.options.cwd, dir);
    assert.deepEqual(run.extravars.dbcred, credentialRows.db, "a resolved credential becomes an extravar");
    assert.equal(run.extravars.__jobid__, 11, "the row lacks the id ; the runner adds it");
    assert.deepEqual(run.hidden, { ansible_user: "root", ansible_password: "sshpw" });
    assert.equal(child.stdinWritten, "v@ult");
    assert.equal(jobRow.status, "success");
    assert.equal(fs.existsSync(path.join(dir, "extravars_11.json")), false, "files removed afterwards");
  });

  test("the playbook sub path is the working folder", async () => {
    fs.mkdirSync(path.join(dir, "sub"));
    row({ __playbook__: "site.yml", __playbookSubPath__: "sub" });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.equal(spawned[0].options.cwd, path.join(dir, "sub"));
  });

  test("a missing ansible credential fails the job with the line it always had", async () => {
    row({ __playbook__: "site.yml", __ansibleCredentials__: "nope" });
    const ok = await core.runAnsibleJob({ jobId: 11 });
    assert.equal(ok, false);
    assert.equal(spawned.length, 0, "nothing ran");
    assert.equal(jobRow.status, "failed");
    assert.ok(outputs.some((o) => o.output === "[ERROR]: Failed to get ansible credentials"));
  });

  test("output continues after what the job already wrote", async () => {
    row({ __playbook__: "site.yml" });
    outputs.push({ output: "changed: [approved by admin]", order: 4 });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    const after = outputs.slice(1).map((o) => o.order);
    assert.ok(after.every((n) => n > 4), "every new line comes after the existing ones");
  });
});

describe("a form value is never a template", () => {
  // ansible templates a string from an extravars file when the playbook uses it : a value of
  // `{{ lookup('pipe', ...) }}` typed into a form field ran that command on the RTE
  const attack = "{{ lookup('pipe', 'id') }}";

  test("a string with a Jinja marker is written as ansible's unsafe, anywhere in the extravars", async () => {
    row({ __playbook__: "site.yml", name: attack, list: ["ok", "{% if 1 %}x{% endif %}"], nested: { note: "{# c #}" } });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    const ev = spawned[0].extravars;
    assert.deepEqual(ev.name, { __ansible_unsafe: attack });
    assert.deepEqual(ev.list, ["ok", { __ansible_unsafe: "{% if 1 %}x{% endif %}" }]);
    assert.deepEqual(ev.nested, { note: { __ansible_unsafe: "{# c #}" } });
  });

  test("everything without a marker is written exactly as before", async () => {
    const values = { __playbook__: "site.yml", name: "web01", n: 3, on: true, none: null, tags: ["a", "b"], obj: { k: "{ not jinja }" } };
    row(values);
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.deepEqual(spawned[0].extravars, { ...values, __jobid__: 11 });
  });

  test("a credential's password is never templated, in the extravars or the hidden file", async () => {
    credentialRows.braces = { name: "braces", user: "u", password: "p{{w}}" };
    row({ __playbook__: "site.yml", __credentials__: { c: "braces" }, __ansibleCredentials__: "braces" });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.deepEqual(spawned[0].extravars.c.password, { __ansible_unsafe: "p{{w}}" });
    assert.deepEqual(spawned[0].hidden.ansible_password, { __ansible_unsafe: "p{{w}}" });
    delete credentialRows.braces;
  });

  test("a form with allowJinjaInExtravars keeps its templates", async () => {
    row({ __playbook__: "site.yml", __allowJinjaInExtravars__: true, name: "{{ inventory_hostname }}" });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.equal(spawned[0].extravars.name, "{{ inventory_hostname }}");
  });

  test("only a real true opts out", async () => {
    row({ __playbook__: "site.yml", __allowJinjaInExtravars__: "false", name: attack });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.deepEqual(spawned[0].extravars.name, { __ansible_unsafe: attack });
  });
});

describe("the form decides allowJinjaInExtravars, never the request", () => {
  test("the form property is handed to the RTE as __allowJinjaInExtravars__", () => {
    const formObj = { name: "f", playbook: "site.yml", allowJinjaInExtravars: true, fields: [] };
    const ev = {};
    jobExports.pushForminfoToExtravars(formObj, ev);
    assert.equal(ev.__allowJinjaInExtravars__, true);
  });

  test("a client cannot switch it on for a form that does not declare it", () => {
    const ev = jobExports.stripReservedExtravars({ __allowJinjaInExtravars__: true, name: "x" }, { name: "f", fields: [{ name: "name" }] });
    assert.equal("__allowJinjaInExtravars__" in ev, false);
  });
});

describe("every way out removes the files holding the credentials, and ends the job once", () => {
  const endLines = () => outputs.filter((o) => /failed|finished/.test(o.output || ""));

  test("ansible-playbook missing (a spawn error : error and close, never exit)", async () => {
    row({ __playbook__: "site.yml", __credentials__: { dbcred: "db" } });
    const done = core.runAnsibleJob({ jobId: 11 });
    await new Promise((r) => setTimeout(r, 20));
    child.emit("error", Object.assign(new Error("spawn ansible-playbook ENOENT"), { code: "ENOENT" }));
    child.emit("close", -2);
    const ok = await done;
    assert.equal(ok, false, "the run settles - before, it never did and the RTE listed the job as running for ever");
    assert.equal(jobRow.status, "failed");
    assert.equal(fs.existsSync(path.join(dir, "extravars_11.json")), false, "the resolved credentials are not left on disk");
    assert.equal(fs.existsSync(path.join(dir, "he_extravars_11.json")), false);
    assert.equal(endLines().length, 1);
  });

  test("an error after the exit (a kill that failed) does not end the job a second time", async () => {
    row({ __playbook__: "site.yml" });
    const done = core.runAnsibleJob({ jobId: 11 });
    await new Promise((r) => setTimeout(r, 20));
    child.emit("exit", 0);
    await done;
    child.emit("error", new Error("kill ESRCH"));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(jobRow.status, "success");
    assert.equal(endLines().length, 1);
  });

  test("a playbook folder missing on the RTE says so, instead of failing on the extravars file", async () => {
    row({ __playbook__: "site.yml", __playbookSubPath__: "not/mounted" });
    const ok = await core.runAnsibleJob({ jobId: 11 });
    assert.equal(ok, false);
    assert.equal(spawned.length, 0, "nothing ran");
    assert.equal(jobRow.status, "failed");
    assert.ok(outputs.some((o) => /playbook folder .*not\/mounted does not exist on RTE/.test(o.output)), "the line names the folder and what to do");
  });
});

describe("the job log a playbook writes", () => {
  test("is stored on the job while it runs and at the end, then the file goes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      row({ __playbook__: "site.yml" });
      fs.mkdirSync(path.join(dir, ".joblogs"));
      const logFile = path.join(dir, ".joblogs", "job_log_11.log");
      const done = core.runAnsibleJob({ jobId: 11 });
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFileSync(logFile, "step 1 of 2\n");
      await vi.advanceTimersByTimeAsync(2000);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(jobRow.job_log, "step 1 of 2\n", "visible while the playbook runs");
      fs.appendFileSync(logFile, "step 2 of 2\n");
      child.emit("exit", 0);
      await done;
      assert.equal(jobRow.job_log, "step 1 of 2\nstep 2 of 2\n", "the final content");
      assert.equal(fs.existsSync(logFile), false, "the file is removed");
    } finally {
      vi.useRealTimers();
    }
  });

  test("no log file is no job log, and no error", async () => {
    row({ __playbook__: "site.yml" });
    await runToEnd(() => core.runAnsibleJob({ jobId: 11 }));
    assert.equal(jobRow.job_log, undefined);
    assert.equal(jobRow.status, "success");
  });
});

describe("the approval gate", () => {
  test("halts the job with the APPROVE line and never runs the playbook", async () => {
    row({ __playbook__: "site.yml" });
    const approval = { roles: ["admin"], title: "ok?" };
    await dispatch({ jobId: 11, jobType: "ansible", extravars: { __playbook__: "site.yml" }, approval });
    assert.equal(spawned.length, 0);
    assert.equal(jobRow.status, "approve");
    assert.equal(jobRow.approval, JSON.stringify(approval));
    assert.ok(jobRow.end);
    assert.equal(outputs[0].output, `APPROVE [site.yml] ${"*".repeat(69 - "site.yml".length)}`);
    assert.equal(approvalMails.length, 1);
  });

  test("a playbook path longer than the APPROVE line still halts for approval", async () => {
    const playbook = "playbooks/vmware/provisioning/create-virtual-machine-from-template-with-disks.yml";
    row({ __playbook__: playbook });
    await dispatch({ jobId: 11, jobType: "ansible", extravars: { __playbook__: playbook }, approval: { roles: ["admin"] } });
    assert.equal(jobRow.status, "approve", "a RangeError here left the job running for ever");
    assert.equal(outputs[0].output, `APPROVE [${playbook}] `);
  });

  test("an approved job goes to its runner", async () => {
    runnerRows = [{ name: "rte-default", type: "rte", is_default: 1 }];
    const launch = vi.spyOn(RUNNERS.rte, "launch").mockResolvedValue(true);
    try {
      row({ __playbook__: "site.yml" });
      await dispatch({ jobId: 11, jobType: "ansible", extravars: {}, approval: { roles: [] }, approved: true });
      assert.equal(launch.mock.calls.length, 1);
      assert.equal(launch.mock.calls[0][0].runner.name, "rte-default");
    } finally {
      launch.mockRestore();
    }
  });

  test("an awx job is labelled with its template", async () => {
    await dispatch({ jobId: 11, jobType: "awx", extravars: { __template__: "Deploy" }, approval: { roles: [] } });
    assert.equal(outputs[0].output, `APPROVE [Deploy] ${"*".repeat(69 - "Deploy".length)}`);
  });
});

describe("which runner runs a playbook job", () => {
  test("no runner named and no default : the job fails with a line that says what to do", async () => {
    row({ __playbook__: "site.yml" });
    await assert.rejects(resolveRunner({ jobType: "ansible", extravars: {} }), /No runner to run this playbook/);
    const ok = await dispatch({ jobId: 11, jobType: "ansible", extravars: {}, approval: null });
    assert.equal(ok, false);
    assert.equal(spawned.length, 0, "the app runs no playbook itself");
    assert.equal(jobRow.status, "failed");
    assert.ok(outputs.some((o) => /No runner to run this playbook : add one of type rte/.test(o.output)));
  });

  test("a default of another type is not a playbook runner's default", async () => {
    runnerRows = [{ name: "aap", type: "awx", is_default: 1 }];
    await assert.rejects(resolveRunner({ jobType: "ansible", extravars: {} }), /No runner to run this playbook/);
  });

  test("the form's runner: name wins over the default", async () => {
    runnerRows = [{ name: "rte-default", type: "rte", is_default: 1 }, { name: "rte-vmware", type: "rte" }];
    const picked = await resolveRunner({ jobType: "ansible", extravars: { __runner__: "rte-vmware" } });
    assert.equal(picked.impl.type, "rte");
    assert.equal(picked.row.name, "rte-vmware");
    const byDefault = await resolveRunner({ jobType: "ansible", extravars: {} });
    assert.equal(byDefault.row.name, "rte-default");
  });

  test("a runner the form names but nobody added fails the job with a line that says so", async () => {
    row({ __playbook__: "site.yml", __runner__: "rte-nope" });
    const ok = await dispatch({ jobId: 11, jobType: "ansible", extravars: { __runner__: "rte-nope" } });
    assert.equal(ok, false);
    assert.equal(spawned.length, 0);
    assert.equal(jobRow.status, "failed");
    assert.ok(outputs.some((o) => /No runner named 'rte-nope'/.test(o.output)));
  });

  test("a named rte is handed the job, and the job remembers it for the abort", async () => {
    runnerRows = [{ name: "rte-vmware", type: "rte", uri: "http://rte:8000", token: "t" }];
    const launch = vi.spyOn(RUNNERS.rte, "launch").mockResolvedValue(true);
    try {
      row({ __playbook__: "site.yml", __runner__: "rte-vmware" });
      await dispatch({ jobId: 11, jobType: "ansible", extravars: { __runner__: "rte-vmware" } });
      assert.equal(launch.mock.calls.length, 1);
      assert.equal(launch.mock.calls[0][0].runner.name, "rte-vmware");
      assert.equal(jobRow.runner, "rte-vmware");
    } finally {
      launch.mockRestore();
    }
  });

  test("a template job runs on the default awx runner, never on an rte", async () => {
    runnerRows = [{ name: "rte-default", type: "rte", is_default: 1 }, { name: "aap", type: "awx", is_default: 1 }];
    const picked = await resolveRunner({ jobType: "awx", extravars: {} });
    assert.equal(picked.impl.type, "awx");
    assert.equal(picked.row.name, "aap");
    runnerRows = [{ name: "rte-default", type: "rte", is_default: 1 }];
    await assert.rejects(resolveRunner({ jobType: "awx", extravars: {} }), /No runner to run this template : add one of type awx/);
  });

  test("runner: on a template form names the awx runner ; an rte cannot run a template", async () => {
    runnerRows = [{ name: "aap-prod", type: "awx" }, { name: "rte-vmware", type: "rte" }];
    assert.equal((await resolveRunner({ jobType: "awx", extravars: { __runner__: "aap-prod" } })).row.name, "aap-prod");
    await assert.rejects(resolveRunner({ jobType: "awx", extravars: { __runner__: "rte-vmware" } }), /cannot run a template/);
    await assert.rejects(resolveRunner({ jobType: "ansible", extravars: { __runner__: "aap-prod" } }), /cannot run a playbook/);
  });

  test("awx: is an alias of runner:, and runner: wins when both are there", async () => {
    runnerRows = [{ name: "aap-old", type: "awx" }, { name: "aap-new", type: "awx" }];
    assert.equal((await resolveRunner({ jobType: "awx", extravars: { __awx__: "aap-old" } })).row.name, "aap-old");
    assert.equal((await resolveRunner({ jobType: "awx", extravars: { __awx__: "aap-old", __runner__: "aap-new" } })).row.name, "aap-new");
  });
});
