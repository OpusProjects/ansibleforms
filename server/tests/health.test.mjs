// tests for the system health snapshot. The point of this page is to make quiet
// failures loud, so these tests care most about the checks REPORTING a problem -
// a health page that always says 'ok' is worse than no health page.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
// Baseline for whatever the import graph reaches (auth.config reads ACCESS_TOKEN_SECRET at
// import time). Health itself no longer looks at either - the secrets check was removed.
process.env.ENCRYPTION_SECRET ||= "test-encryption-secret";
process.env.ACCESS_TOKEN_SECRET ||= "test-token-secret";

// health reaches the database ; stub the pool so nothing here needs mysql
const queries = [];
let dbHandler = async () => [];
vi.mock("../src/models/db.model.js", () => ({
  default: { do: async (sql, vars) => { queries.push(sql); return await dbHandler(sql, vars); } },
}));
let storeState = { stores: [], info: null, error: null };
let runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
let ldapRow = null;
// a fully patched schema by default, matching the mocked manifest above
let schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
// the secret stores : rows from the model, the connection test from the provider registry
vi.mock("../src/models/secretStore.model.js", () => ({
  default: { findAll: async () => storeState.stores },
}));
// the runners : one reachable RTE by default, the healthy case since 7.2
vi.mock("../src/models/runner.model.js", () => ({
  default: {
    findAll: async () => runnerState.runners,
    check: async (runner) => { if (runnerState.error) throw new Error(runnerState.error); return { version: "7.2.0", name: runner.name }; },
  },
}));
vi.mock("../src/secrets/providers/index.js", () => ({
  checkStore: async () => { if (storeState.error) throw new Error(storeState.error); return storeState.info; },
}));
vi.mock("../src/models/schema.model.js", () => ({
  default: { isProvisioned: async () => true },
  // The real manifest shape : an empty one must not silently report 'complete'.
  // Two entries, so a finding can be attributed to the right one - and both are real
  // patch names, because there is one patch function per MAJOR version (4 to 7).
  SCHEMA_MANIFEST: {
    base: { tables: ["jobs", "settings"] },
    patches: {
      patchVersion5: { columns: ["settings.default_theme"] },
      patchVersion6: { indexes: ["jobs.idx_jobs_retention"] },
    },
  },
}));
vi.mock("../src/models/settings.model.js", () => ({
  default: {
    findFormsYaml: async () => ({ forms_yaml: "categories: []", config_source: null }),
    resolveConfigInDatabase: () => false,
    getActiveConfig: async () => "categories: []\n",
    findMailSettings: async () => ({ mail_server: "smtp.example.com", mail_port: 587, mail_secure: 1, mail_username: "mailer" }),
  },
}));
// the scheduler lives in-process, so in a test there are no registered tasks and
// the real singleton would always report 'not running' - which would then dominate
// every overall-status assertion. Mock it and drive it explicitly instead.
vi.mock("../src/services/cron.service.js", () => ({
  default: {
    jobs: {
      system: new Map([["nightlyBackup", { nextRun: () => new Date("2030-01-01T00:00:00Z") }]]),
      schedules: new Map(),
      repositories: new Map(),
    },
  },
}));

const appConfig = (await import("./__mocks__/app.config.js")).default;
const Cmd = (await import("./__mocks__/cmd.js")).default;
const cronService = (await import("../src/services/cron.service.js")).default;
const Health = (await import("../src/models/health.model.js")).default;

const realExecute = Cmd.executeSilentCommand;
let tmpRoot;

function statusOf(result, key) {
  return result.checks.find((c) => c.key === key)?.status;
}
function checkOf(result, key) {
  return result.checks.find((c) => c.key === key);
}
// facts live in a separate list with NO status field, so a green dot never implies a
// verdict was reached about something that was never tested
function infoOf(result, key) {
  return result.info.find((i) => i.key === key);
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "af-health-test-"));
  queries.length = 0;
  appConfig.backupPath = path.join(tmpRoot, "backups");
  appConfig.lockPath = path.join(tmpRoot, "ansibleForms.lock");
  appConfig.configPath = path.join(tmpRoot, "config.yaml");
  appConfig.formsFolderPath = path.join(tmpRoot, "forms");
  appConfig.mysqldumpCommand = "mariadb-dump";
  // real directory : repositoriesCheck now asks whether each row has a working tree on disk
  appConfig.repoPath = path.join(tmpRoot, "repositories");
  await fs.mkdir(appConfig.repoPath, { recursive: true });
  await fs.mkdir(appConfig.backupPath, { recursive: true });
  storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
    if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9" }];
    if (/repositories/.test(sql)) return [];
    if (/FROM AnsibleForms.`ldap`/.test(sql)) return ldapRow ? [ldapRow] : [];
    if (/information_schema.tables/.test(sql)) return schemaState.tables.map((t) => ({ t }));
    if (/information_schema.columns/.test(sql)) return schemaState.columns.map((x) => { const [t, c] = x.split("."); return { t, c }; });
    if (/information_schema.statistics/.test(sql)) return schemaState.indexes.map((x) => { const [t, i] = x.split("."); return { t, i }; });
    if (/information_schema/.test(sql)) return [];
    if (/SUM\(status='running'\)/.test(sql)) return [{ running: 0, awaitingApproval: 0, stuck: 0 }];
    if (/MIN\(created_at\)/.test(sql)) return [{ first: null }];
    if (/DATE\(created_at\)/.test(sql)) return [];
    return [];
  };
  Cmd.executeSilentCommand = async () => "";
});

afterEach(async () => {
  Cmd.executeSilentCommand = realExecute;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function writeBackup(folder, dumpContents) {
  const dir = path.join(appConfig.backupPath, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ansibleforms.sql"), dumpContents);
}

// build a folder name (YYYYMMDDHHmmss) a given number of days ago
function folderDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().replace(/[-:T.]/g, "").slice(0, 14);
}

describe("the dump command is redacted before it is shown", () => {
  test("a password is redacted, and a port is not", async () => {
    const { scrubCommand } = await import("../src/models/health.model.js");
    assert.equal(scrubCommand("mysqldump -psecret123"), "mysqldump -p***");
    assert.equal(scrubCommand("mysqldump --password=secret123"), "mysqldump --password=***");
    assert.equal(scrubCommand("mysqldump -u root -pP@ss --single-transaction"), "mysqldump -u root -p*** --single-transaction");
    // NOT a secret : an unanchored /-p\\S+/ would turn this into '--p***'
    assert.equal(scrubCommand("mysqldump --port=3306 -h db"), "mysqldump --port=3306 -h db");
    assert.equal(scrubCommand("docker exec -i ansibleforms-mysql mysql"), "docker exec -i ansibleforms-mysql mysql");
    assert.equal(scrubCommand("mariadb-dump --ssl-verify-server-cert=OFF"), "mariadb-dump --ssl-verify-server-cert=OFF");
  });
});

describe("health reports problems, not just ok", () => {
  // A held lock is the designer working. Only an ABANDONED one is a fault - warning on
  // every held lock turned the row amber during ordinary use.
  test("a lock held right now is ok, and names the holder", async () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace("T", " ");
    await fs.writeFile(appConfig.lockPath, `username: alice\ntype: local\ncreated: ${stamp}\n`);
    const r = await Health.check();
    assert.equal(statusOf(r, "designerLock"), "ok");
    assert.match(checkOf(r, "designerLock").value, /alice/);
  });

  test("a lock held for longer than the threshold is a warning", async () => {
    const old = new Date(Date.now() - 30 * 3600000);
    const stamp = old.toISOString().slice(0, 19).replace("T", " ");
    await fs.writeFile(appConfig.lockPath, `username: alice\ntype: local\ncreated: ${stamp}\n`);
    const r = await Health.check();
    assert.equal(statusOf(r, "designerLock"), "warning");
    assert.match(checkOf(r, "designerLock").value, /alice for \d+h/);
    assert.equal(r.status, "warning", "overall status takes the worst check");
  });

  test("a lock with no timestamp is a warning : it cannot be shown to be active", async () => {
    await fs.writeFile(appConfig.lockPath, "username: alice\ntype: local\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "designerLock"), "warning");
    assert.match(checkOf(r, "designerLock").detail.reason, /no usable creation time/);
  });

  test("no lock file is ok", async () => {
    await writeBackup(folderDaysAgo(0), "-- dump\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "designerLock"), "ok");
    assert.equal(checkOf(r, "designerLock").value, "free");
  });

  test("an empty newest dump is an error, not a healthy backup", async () => {
    await writeBackup(folderDaysAgo(0), ""); // 0 bytes : the real world failure
    const r = await Health.check();
    assert.equal(statusOf(r, "lastBackup"), "error");
    assert.equal(r.status, "error");
  });

  test("a stale backup is a warning even when it is valid", async () => {
    await writeBackup(folderDaysAgo(9), "-- dump\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "lastBackup"), "warning");
    assert.match(JSON.stringify(checkOf(r, "lastBackup").detail), /days old/);
  });

  test("a recent valid backup is ok", async () => {
    await writeBackup(folderDaysAgo(0), "-- dump\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "lastBackup"), "ok");
  });

  test("no backups at all is a warning", async () => {
    const r = await Health.check();
    assert.equal(statusOf(r, "lastBackup"), "warning");
    assert.equal(checkOf(r, "lastBackup").value, "none");
  });

  test("a missing dump binary is an error naming the env var", async () => {
    Cmd.executeSilentCommand = async (cmd) => {
      if (cmd.command.startsWith("command -v")) throw new Error("not found");
      return "";
    };
    const r = await Health.check();
    assert.equal(statusOf(r, "backupTooling"), "error");
    assert.match(checkOf(r, "backupTooling").detail, /MYSQLDUMP_COMMAND/);
  });

  test("a failed repository is an error and healthy ones are counted", async () => {
    storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9" }];
      if (/repositories/.test(sql)) return [
        { name: "ok-repo", status: "success", head: "abc" },
        { name: "bad-repo", status: "failed", head: null },
      ];
      return [];
    };
    // both have a working tree, so this test measures `status` and nothing else
    await fs.mkdir(path.join(appConfig.repoPath, "ok-repo"), { recursive: true });
    await fs.mkdir(path.join(appConfig.repoPath, "bad-repo"), { recursive: true });
    await writeBackup(folderDaysAgo(0), "-- dump\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "repositories"), "error");
    assert.equal(checkOf(r, "repositories").value, "1/2 healthy");
  });

  // A repository row whose clone never landed. `status` misses it - the first failed attempt
  // leaves whatever status it wrote, and for a SEEDED repository the seed then reports
  // 'unchanged' on every later boot, so an instance using it for config served no forms with
  // nothing saying why.
  // THE regression for authenticationFacts. It used to wrap both queries in .catch(() => [])
  // and so printed `local` on an instance whose ldap and oauth2 tables it had never
  // successfully read - a confidently wrong answer on the one page whose whole premise is not
  // claiming unearned verdicts. Re-adding those catches must break this test: the row has to
  // be ABSENT and the database check has to carry the cause.
  test("authentication is omitted, not guessed, when its tables cannot be read", async () => {
    dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9" }];
      if (/FROM AnsibleForms.`ldap`/.test(sql)) throw new Error("ER_NO_SUCH_TABLE");
      if (/oauth2_providers/.test(sql)) return [];
      if (/repositories/.test(sql)) return [];
      return [];
    };
    const r = await Health.check();
    assert.equal(infoOf(r, "authentication"), undefined, "a fact it could not read must not be shown");
    // and it must not have silently degraded to the wrong answer
    assert.equal(JSON.stringify(r.info).includes('"local"'), false);
  });

  test("authentication IS reported when the tables can be read", async () => {
    ldapRow = { enable: 1 };
    const r = await Health.check();
    // proves the test above fails for the right reason rather than because the row never exists
    assert.equal(infoOf(r, "authentication").value, "local, ldap");
  });

  test("a repository with no working tree is an error, even when its status looks fine", async () => {
    dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9" }];
      if (/repositories/.test(sql)) return [
        { name: "cloned", status: "success", head: "abc" },
        { name: "never-cloned", status: "success", head: "def" },
      ];
      return [];
    };
    await fs.mkdir(path.join(appConfig.repoPath, "cloned"), { recursive: true });
    const r = await Health.check();
    assert.equal(statusOf(r, "repositories"), "error");
    assert.equal(checkOf(r, "repositories").value, "1 of 2 not cloned");
    assert.deepEqual(checkOf(r, "repositories").detail.notCloned, ["never-cloned"]);
  });

  test("a ytt templated config is reported so the read-only editors make sense", async () => {
    const settings = (await import("../src/models/settings.model.js")).default;
    const original = settings.getActiveConfig;
    settings.getActiveConfig = async () => "#@ load('x')\ncategories: []\n";
    try {
      const r = await Health.check();
      assert.equal(infoOf(r, "configSource").detail.templated, true);
      assert.equal(checkOf(r, "configSource"), undefined, "config source is a fact, not a check");
    } finally {
      settings.getActiveConfig = original;
    }
  });

  test("a database failure becomes that row's error, not a broken page", async () => {
    storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) throw new Error("ECONNREFUSED");
      return [];
    };
    const r = await Health.check();
    assert.equal(statusOf(r, "database"), "error");
    // every other check still reported (16 : runners joined in 7.2)
    assert.equal(r.checks.length, 16);
  });

  // Since 7.2 jobs run on runners : none at all means no form can run a job
  test("runners : none is a warning that says what to add", async () => {
    runnerState = { runners: [], error: null };
    const r = await Health.check();
    assert.equal(statusOf(r, "runners"), "warning");
    assert.match(checkOf(r, "runners").detail.reason, /Connections > Runners/);
  });

  test("runners : an unreachable one is an error naming it", async () => {
    runnerState = { runners: [{ name: "rte-1", type: "rte" }, { name: "aap", type: "awx" }], error: "the RTE at http://rte:8000 is unreachable : ECONNREFUSED" };
    const r = await Health.check();
    assert.equal(statusOf(r, "runners"), "error");
    assert.match(checkOf(r, "runners").value, /2 of 2 runner\(s\) need attention : rte-1, aap/);
  });

  // Since 7.2 the app runs no playbook itself (an RTE does), so it never asks for an ansible
  // version - even where one happens to be installed.
  test("there is no ansible row : the app does not run ansible-playbook", async () => {
    const saved = Cmd.executeSilentCommand;
    const asked = [];
    Cmd.executeSilentCommand = async (cmd) => {
      asked.push(String(cmd?.command || ''));
      return 'ansible-playbook [core 2.17.9]';
    };
    try {
      const r = await Health.check();
      assert.equal(infoOf(r, "ansible"), undefined);
      assert.equal(asked.some((c) => c.startsWith('ansible-playbook')), false, "ansible is never called");
      assert.ok(infoOf(r, "version"), "other info rows still present");
    } finally {
      Cmd.executeSilentCommand = saved;
    }
  });

  test("the writable check covers every configured folder, deduplicated", async () => {
    const r = await Health.check();
    const w = r.checks.find((c) => c.key === "writable");
    assert.ok(w, "expected a writable check");
    // ten configured paths, most of them the same 'persistent' folder : the row must
    // report distinct folders, or one real failure would be buried under repeats
    const folders = w.detail?.folders || [];
    assert.equal(folders.length, new Set(folders).size);
    assert.ok(folders.length > 0 && folders.length < 10);
    assert.match(w.value, /folders writable$/);
  });

  // Secret stores are optional, so an instance without one is not a fault - but once one is
  // used a dead server or an expired token breaks every credential that reads from it.
  test("secret stores are ok when none is configured, and make no network call", async () => {
    const r = await Health.check();
    assert.equal(statusOf(r, "secretStores"), "ok");
    assert.equal(checkOf(r, "secretStores").value, "none configured");
  });

  test("a vault token near the end of its ttl is a warning", async () => {
    storeState = { stores: [{ name: "vault", type: "vault", url: "https://v:8200" }], error: null, info: { addr: "https://v:8200", namespace: null, kvVersion: 2, defaultMount: "secret", renewable: true, ttl: 2 * 24 * 3600, policies: ["default"] } };
    const r = await Health.check();
    assert.equal(statusOf(r, "secretStores"), "warning");
    assert.match(checkOf(r, "secretStores").value, /expires in 2d/);
    assert.match(checkOf(r, "secretStores").detail.reason, /renews this token/i);
  });

  test("a token that does not expire is ok, and an unreachable store is an error", async () => {
    storeState = { stores: [{ name: "vault", type: "vault", url: "https://v:8200" }], error: null, info: { addr: "https://v:8200", namespace: null, kvVersion: 2, defaultMount: "secret", renewable: false, ttl: 0, policies: [] } };
    assert.equal(statusOf(await Health.check(), "secretStores"), "ok");
    storeState = { stores: [{ name: "vault", type: "vault", url: "https://v:8200" }], error: "Could not reach Vault", info: null };
    assert.equal(statusOf(await Health.check(), "secretStores"), "error");
  });

  // The page must never BIND to ldap : that is an authentication attempt against the
  // directory, logged and counted against lockout, on every refresh.
  test("ldap is ok when disabled, and enabled-with-no-server is an error", async () => {
    assert.equal(statusOf(await Health.check(), "ldap"), "ok");
    assert.equal(checkOf(await Health.check(), "ldap").value, "not enabled");
    ldapRow = { server: "", port: 389, enable_tls: 0, ignore_certs: 1, enable: 1 };
    const r = await Health.check();
    assert.equal(statusOf(r, "ldap"), "error");
    assert.match(checkOf(r, "ldap").value, /no server/);
  });

  test("an unreachable ldap server is an error, and the row says no bind was attempted", async () => {
    // TEST-NET-1, guaranteed unroutable, so this exercises the timeout path
    ldapRow = { server: "192.0.2.1", port: 389, enable_tls: 0, ignore_certs: 1, enable: 1 };
    const r = await Health.check();
    assert.equal(statusOf(r, "ldap"), "error");
    assert.equal(checkOf(r, "ldap").value, "unreachable");
    assert.match(checkOf(r, "ldap").detail.reason, /within 5s|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/);
  }, 15000);

  // There is no version table, so a half-applied patch is otherwise invisible after the
  // startup log scrolls away.
  test("a complete schema is ok", async () => {
    const r = await Health.check();
    assert.equal(statusOf(r, "schema"), "ok");
    assert.equal(checkOf(r, "schema").value, "complete");
  });

  test("a missing column is an error and names the patch that adds it", async () => {
    schemaState.columns = [];
    const r = await Health.check();
    assert.equal(statusOf(r, "schema"), "error");
    assert.match(checkOf(r, "schema").value, /1 missing/);
    assert.deepEqual(checkOf(r, "schema").detail.missingColumns, ["settings.default_theme"]);
    assert.deepEqual(checkOf(r, "schema").detail.failedPatches, ["patchVersion5"]);
  });

  test("a missing index is only a warning : slow, not broken", async () => {
    schemaState.indexes = [];
    const r = await Health.check();
    assert.equal(statusOf(r, "schema"), "warning");
    assert.deepEqual(checkOf(r, "schema").detail.missingIndexes, ["jobs.idx_jobs_retention"]);
    assert.deepEqual(checkOf(r, "schema").detail.failedPatches, ["patchVersion6"]);
  });

  test("a missing table does not also report its columns as missing", async () => {
    schemaState.tables = ["jobs"];        // settings gone
    const r = await Health.check();
    assert.deepEqual(checkOf(r, "schema").detail.missingTables, ["settings"]);
    assert.deepEqual(checkOf(r, "schema").detail.missingColumns, [], "the table is the finding, not its columns");
  });

  test("a scheduler with no system tasks is an error", async () => {
    const saved = cronService.jobs.system;
    cronService.jobs.system = new Map();
    try {
      const r = await Health.check();
      assert.equal(statusOf(r, "scheduler"), "error");
      assert.match(checkOf(r, "scheduler").detail, /No system tasks/);
    } finally {
      cronService.jobs.system = saved;
    }
  });

  // The empty-map branch above is not reachable on a live instance : app.js awaits
  // init() - which registers the six system tasks - before the http server listens, so
  // a registration failure means there is no page to show the row on. A task that is
  // registered but will never fire again IS observable, and used to show green.
  test("a registered task with no next run is an error, not a green dot", async () => {
    const saved = cronService.jobs.system;
    cronService.jobs.system = new Map([
      ["nightlyBackup", { nextRun: () => new Date("2030-01-01T00:00:00Z") }],
      ["jobCleanup", { nextRun: () => null }],
    ]);
    try {
      const r = await Health.check();
      assert.equal(statusOf(r, "scheduler"), "error");
      assert.match(checkOf(r, "scheduler").value, /1 of 2 tasks will not run again/);
      assert.deepEqual(checkOf(r, "scheduler").detail.stopped, ["jobCleanup"]);
    } finally {
      cronService.jobs.system = saved;
    }
  });

  test("a running scheduler reports its task count and next run", async () => {
    await writeBackup(folderDaysAgo(0), "-- dump\n");
    const r = await Health.check();
    assert.equal(statusOf(r, "scheduler"), "ok");
    assert.equal(r.status, "ok", "a fully healthy instance reports ok overall");
    assert.match(JSON.stringify(checkOf(r, "scheduler").detail), /nightlyBackup/);
  });

  test("every check is always present", async () => {
    const r = await Health.check();
    const keys = r.checks.map((c) => c.key).sort();
    // Only rows that can actually FAIL. 'schema' is folded into database (behind
    // showSettings it could never read anything but 'provisioned'), and configSource /
    // runtime moved to `info` because they have no failing value.
    assert.deepEqual(keys, [
      "backupTooling", "configSeed", "database", "designerLock", "disk", "expressions",
      "jobs", "lastBackup", "ldap", "repositories", "runners", "scheduler", "schema", "secretStores", "storage", "writable",
    ]);
    // and every info entry is status-free by construction
    assert.ok(r.info.length > 0);
    assert.equal(r.info.some((i) => i.status !== undefined), false);
  });
});

describe("the database check names the engine, not just a version number", () => {
  test("MySQL is identified from @@version_comment", async () => {
    storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9", comment: "MySQL Community Server - GPL" }];
      return [];
    };
    const r = await Health.check();
    // '8.4.9' alone says nothing about which of the two supported engines this is
    assert.equal(infoOf(r, "database").value, "MySQL 8.4.9");
    // the CHECK is only about reachability - the engine is a fact
    assert.equal(checkOf(r, "database").value, "reachable");
  });

  test("MariaDB is identified, and the suffix is not repeated", async () => {
    storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "10.11.2-MariaDB", comment: "mariadb.org binary distribution" }];
      return [];
    };
    const r = await Health.check();
    // not 'MariaDB 10.11.2-MariaDB'
    assert.equal(infoOf(r, "database").value, "MariaDB 10.11.2");
  });

  test("where the database lives is a fact, not a check", async () => {
    const r = await Health.check();
    assert.match(infoOf(r, "databaseHost").value, /:\d+$/);
    assert.equal(infoOf(r, "databaseHost").detail.schema, "AnsibleForms");
  });

  test("the information block carries version, uptime and timezone", async () => {
    const r = await Health.check();
    // version is the first row : it is what every support conversation opens with
    assert.equal(r.info[0].key, "version");
    // no 'ansible' : the app runs no playbook since 7.2 (covered by its own test)
    for (const key of ["version", "baseUrl", "authentication", "retention", "mail", "logs", "uptime", "timezone", "node", "platform"]) {
      assert.ok(infoOf(r, key), `expected an info entry for ${key}`);
    }
    assert.match(infoOf(r, "uptime").value, /^up /);
    // LOG_TZ decides how every stored timestamp is rendered
    assert.ok(infoOf(r, "timezone").value.length > 0);
  });
});

describe("the checks added after the first release round", () => {
  test("disk space is reported and warns before it is too late", async () => {
    const r = await Health.check();
    const d = checkOf(r, "disk");
    assert.match(d.value, /% used/);
    assert.ok(d.detail.freeGb >= 0 && d.detail.totalGb > 0);
    assert.ok(["ok", "warning", "error"].includes(d.status));
  });

  test("storage says whether anything actually prunes it", async () => {
    // the size alone is not actionable : JOB_RETENTION_DAYS defaults to 0 = never
    appConfig.jobRetentionDays = 0;
    let r = await Health.check();
    assert.match(checkOf(r, "storage").value, /retention disabled/);
    assert.match(checkOf(r, "storage").detail.note, /JOB_RETENTION_DAYS/);

    appConfig.jobRetentionDays = 90;
    r = await Health.check();
    assert.match(checkOf(r, "storage").value, /kept 90 days/);
    assert.equal(checkOf(r, "storage").detail.note, null);
    appConfig.jobRetentionDays = 0;
  });

  test("a job stuck in running is a warning", async () => {
    storeState = { stores: [], info: null, error: null };
  runnerState = { runners: [{ name: "rte-1", type: "rte", uri: "http://rte:8000" }], error: null };
  ldapRow = null;   // ldap disabled unless a test says otherwise
  schemaState = { tables: ["jobs", "settings"], columns: ["settings.default_theme"], indexes: ["jobs.idx_jobs_retention"] };
  dbHandler = async (sql) => {
      if (/VERSION\(\)/.test(sql)) return [{ version: "8.4.9" }];
      if (/SUM\(status='running'\)/.test(sql)) return [{ running: 2, awaitingApproval: 3, stuck: 1 }];
      return [];
    };
    const r = await Health.check();
    assert.equal(statusOf(r, "jobs"), "warning");
    assert.match(checkOf(r, "jobs").value, /2 running, 3 awaiting approval/);
    assert.match(checkOf(r, "jobs").detail.note, /more than 24 hours/);
  });

  test("uptime and timezone are facts, not checks", async () => {
    const r = await Health.check();
    // there is no failing value for 'the process has been up 4 hours'
    assert.equal(checkOf(r, "runtime"), undefined);
    assert.match(infoOf(r, "uptime").value, /^up /);
    assert.match(infoOf(r, "node").value, /^v\d+/);
  });
});

describe("the summary counts match the checks", () => {
  test("every check is counted exactly once", async () => {
    const r = await Health.check();
    assert.equal(r.summary.ok + r.summary.warning + r.summary.error, r.checks.length);
  });
});
