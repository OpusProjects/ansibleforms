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

const { default: Job } = await import("../src/models/job.model.js");
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
      "-i", "hosts,extra", "-i", "hosts", "-i", "extra",
      "-t", "a,b", "--check", "--diff", "-vvv", "--limit", "web*", "site.yml",
    ]);
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

  test("an awx job runs on awx, whatever the runners table holds", async () => {
    runnerRows = [{ name: "rte-default", type: "rte", is_default: 1 }];
    assert.equal((await resolveRunner({ jobType: "awx", extravars: {} })).impl.type, "awx");
  });
});
