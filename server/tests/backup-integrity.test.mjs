// tests for backup integrity : a failed backup must not leave a folder that looks
// like a restore point, and a restore must refuse one that is not.
//
// vitest.config.mjs aliases '../lib/cmd.js', '../lib/logger.js' and
// '../../config/app.config.js' to the shared mocks in tests/__mocks__, which is
// exactly what backup.model.js imports - so the model already runs against those.
// Importing the same mock modules here hands back the same objects, and setting
// fields on them is how this drives the model without touching a real database.
import { test, describe, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// db.config.js throws at import time unless these are present
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// MUST be set BEFORE importing envSettings (through backup.model), because MANAGED_ENV_PATH
// is a module-level constant. Without it the default resolves to the developer's real
// server/persistent/.env, so `npm test` copied live DB_PASSWORD / VAULT_TOKEN values into a
// tmp folder on any machine where the settings page had ever been used.
const ENV_FIXTURE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "af-env-fixture-"));
process.env.MANAGED_ENV_PATH = path.join(ENV_FIXTURE_DIR, ".env");

const appConfig = (await import("./__mocks__/app.config.js")).default;
const Cmd = (await import("./__mocks__/cmd.js")).default;
const BackupModel = (await import("../src/models/backup.model.js")).default;

const realExecute = Cmd.executeSilentCommand;
let tmpRoot;
let cmdCalls;

// mirror what the real shell redirect does : `cmd > "file"` creates the file before
// the command runs, which is why a missing binary leaves a 0-byte dump behind
function dumpTargetOf(command) {
  const m = command.match(/> "([^"]+)"/);
  return m ? m[1] : null;
}

// default: the dump binary exists and writes a plausible dump
function behave({ toolFound = true, dumpWrites = "-- MySQL dump\nCREATE TABLE x();\n", dumpFails = false } = {}) {
  Cmd.executeSilentCommand = async (cmd) => {
    cmdCalls.push(cmd.command);
    if (cmd.command.startsWith("command -v")) {
      if (!toolFound) throw new Error("not found");
      return "";
    }
    const target = dumpTargetOf(cmd.command);
    if (target) await fs.writeFile(target, dumpWrites);
    if (dumpFails) throw new Error("/bin/sh: 1: mariadb-dump: not found");
    return "";
  };
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "af-backup-test-"));
  cmdCalls = [];
  appConfig.backupPath = tmpRoot;
  appConfig.configPath = path.join(tmpRoot, "src", "config.yaml");
  appConfig.formsFolderPath = path.join(tmpRoot, "src", "forms");
  appConfig.mysqldumpCommand = "mariadb-dump";
  appConfig.mysqlCommand = "mariadb";
  await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
  await fs.writeFile(appConfig.configPath, "categories: []\n");
  behave();
});

afterEach(async () => {
  Cmd.executeSilentCommand = realExecute;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function listFolders() {
  return (await fs.readdir(tmpRoot)).filter((f) => /^\d{14}$/.test(f));
}

describe("doBackup leaves nothing behind when it fails", () => {
  test("a missing dump binary is reported before anything is created", async () => {
    behave({ toolFound: false });
    await assert.rejects(
      () => BackupModel.doBackup("probe"),
      (err) => /was not found on this system/.test(err.message)
    );
    assert.deepEqual(await listFolders(), [], "no backup folder should be created");
  });

  test("a dump that fails removes the half written folder", async () => {
    behave({ dumpWrites: "", dumpFails: true });
    await assert.rejects(() => BackupModel.doBackup("probe"));
    assert.deepEqual(await listFolders(), [], "the incomplete folder must be removed");
  });

  test("a dump that exits 0 but writes an empty file is treated as a failure", async () => {
    behave({ dumpWrites: "" });
    await assert.rejects(
      () => BackupModel.doBackup("probe"),
      (err) => /dump is empty/.test(err.message)
    );
    assert.deepEqual(await listFolders(), [], "an empty dump is not a restore point");
  });

  test("a successful dump keeps the folder, copies config.yaml and writes meta.yaml", async () => {
    const result = await BackupModel.doBackup("good one");
    assert.equal((await listFolders()).length, 1);
    const meta = await fs.readFile(path.join(result.backupFolder, "meta.yaml"), "utf8");
    assert.match(meta, /good one/);
    const copied = await fs.readFile(path.join(result.backupFolder, "config.yaml"), "utf8");
    assert.match(copied, /categories/);
  });
});

describe("backup validity is reported", () => {
  test("an empty dump is invalid, a real one is valid, and list agrees with detail", async () => {
    const bad = path.join(tmpRoot, "20260101000000");
    const good = path.join(tmpRoot, "20260102000000");
    await fs.mkdir(bad, { recursive: true });
    await fs.mkdir(good, { recursive: true });
    await fs.writeFile(path.join(bad, "ansibleforms.sql"), "");
    await fs.writeFile(path.join(good, "ansibleforms.sql"), "-- dump\n");

    const byFolder = Object.fromEntries((await BackupModel.listBackups()).map((b) => [b.folder, b]));
    assert.equal(byFolder["20260101000000"].valid, false);
    // the 0-byte file genuinely exists : that is what made a failed backup look real
    assert.equal(byFolder["20260101000000"].backupFileExists, true);
    assert.equal(byFolder["20260102000000"].valid, true);

    assert.equal((await BackupModel.getBackupByFolder("20260101000000")).valid, false);
    assert.equal((await BackupModel.getBackupByFolder("20260102000000")).valid, true);
  });

  test("a missing dump file is invalid too", async () => {
    await fs.mkdir(path.join(tmpRoot, "20260103000000"), { recursive: true });
    const detail = await BackupModel.getBackupByFolder("20260103000000");
    assert.equal(detail.backupFileExists, false);
    assert.equal(detail.valid, false);
  });
});

describe("restore refuses a backup that is not a restore point", () => {
  test("an empty dump is rejected instead of reporting success", async () => {
    const folder = "20260104000000";
    await fs.mkdir(path.join(tmpRoot, folder), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, folder, "ansibleforms.sql"), "");

    await assert.rejects(
      () => BackupModel.restore(folder, false),
      (err) => /no usable database dump/.test(err.message)
    );
    assert.equal(
      cmdCalls.some((c) => c.includes("< ")),
      false,
      "no restore command should run for an invalid backup"
    );
  });

  test("a missing dump file is rejected", async () => {
    const folder = "20260105000000";
    await fs.mkdir(path.join(tmpRoot, folder), { recursive: true });
    await assert.rejects(
      () => BackupModel.restore(folder, false),
      (err) => /no usable database dump/.test(err.message)
    );
  });

  test("a valid backup does run the restore command", async () => {
    const folder = "20260106000000";
    await fs.mkdir(path.join(tmpRoot, folder), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, folder, "ansibleforms.sql"), "-- dump\n");
    const result = await BackupModel.restore(folder, false);
    assert.match(result.message, /Restore completed/);
    assert.equal(cmdCalls.some((c) => c.includes("< ")), true);
  });
});

describe("the environment file is captured but never silently restored", () => {
  // The backup carries persistent/.env so a rebuild gets DB_*, VAULT_* and the paths back.
  // Two properties matter and neither was covered: the MASTER secrets must be stripped (the
  // dump next to it is AES ciphertext, so shipping the key with it would defeat the
  // encryption), and a NORMAL restore must not touch the live file, because DB_HOST and the
  // paths in it describe the machine the backup came from.
  const LIVE = 'DB_HOST="LIVE"\nENCRYPTION_SECRET="THE-KEY"\nACCESS_TOKEN_SECRET="SIGNER"\nVAULT_TOKEN="hvs.x"\n';

  beforeEach(async () => {
    await fs.writeFile(process.env.MANAGED_ENV_PATH, LIVE, { mode: 0o600 });
  });

  test("the master secrets are stripped, everything else is kept", async () => {
    const folder = path.join(tmpRoot, "envcap");
    await fs.mkdir(folder, { recursive: true });
    await BackupModel.backupFormsAndFolder(folder);
    const text = await fs.readFile(path.join(folder, "managed.env"), "utf8");
    assert.equal(text.includes("THE-KEY"), false, "ENCRYPTION_SECRET must never reach a backup");
    assert.equal(text.includes("SIGNER"), false, "ACCESS_TOKEN_SECRET must never reach a backup");
    assert.match(text, /DB_HOST="LIVE"/);
    assert.match(text, /VAULT_TOKEN="hvs.x"/);
    // and it says why, so a restore onto a new host is not a mystery
    assert.match(text, /removed from this backup on purpose/);
  });

  test("the copy is not readable by anyone else", async () => {
    const folder = path.join(tmpRoot, "envmode");
    await fs.mkdir(folder, { recursive: true });
    await BackupModel.backupFormsAndFolder(folder);
    const stat = await fs.stat(path.join(folder, "managed.env"));
    assert.equal(stat.mode & 0o077, 0, "it can still hold VAULT_TOKEN and a mail password");
  });

  test("a normal restore leaves the live environment file alone", async () => {
    const folder = path.join(tmpRoot, "20260101000000");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "managed.env"), 'DB_HOST="FROM-BACKUP"\n');
    await BackupModel.restoreFormsAndFolder(folder);
    const live = await fs.readFile(process.env.MANAGED_ENV_PATH, "utf8");
    assert.match(live, /LIVE/, "restoreFormsAndFolder must not move the environment file");
    assert.equal(live.includes("FROM-BACKUP"), false);
  });

  test("restoring it explicitly takes a folder NAME and keeps the previous file", async () => {
    const folder = "20260303000000";
    await fs.mkdir(path.join(appConfig.backupPath, folder), { recursive: true });
    await fs.writeFile(path.join(appConfig.backupPath, folder, "managed.env"), 'DB_HOST="FROM-BACKUP"\n');
    const result = await BackupModel.restoreManagedEnv(folder);
    assert.equal(result.restored, true);
    assert.equal(result.restartRequired, true);
    assert.match(await fs.readFile(process.env.MANAGED_ENV_PATH, "utf8"), /FROM-BACKUP/);
    // a bad DB_HOST here stops the app booting, so the previous file is the only way back
    assert.match(await fs.readFile(`${process.env.MANAGED_ENV_PATH}.bak`, "utf8"), /LIVE/);
  });

  // It used to take a full PATH while every sibling takes a folder name, so the natural
  // wiring looked in the wrong place - and path.join on an unvalidated string could write an
  // arbitrary file over the live persistent/.env.
  for (const bad of ["../../etc", "/etc/passwd", "not-a-folder", "", "2026010100000"]) {
    test(`restoreManagedEnv refuses ${JSON.stringify(bad)}`, async () => {
      await assert.rejects(() => BackupModel.restoreManagedEnv(bad), (e) => e.status === 400);
    });
  }

  test("a valid folder with no environment file reports it instead of throwing", async () => {
    const folder = "20260404000000";
    await fs.mkdir(path.join(appConfig.backupPath, folder), { recursive: true });
    const result = await BackupModel.restoreManagedEnv(folder);
    assert.equal(result.restored, false);
    assert.match(result.reason, /no environment file/);
  });

  test("the backup listing reports whether it carries an environment file", async () => {
    const withEnv = "20260505000000";
    await fs.mkdir(path.join(appConfig.backupPath, withEnv), { recursive: true });
    await fs.writeFile(path.join(appConfig.backupPath, withEnv, "ansibleforms.sql"), "-- dump\n");
    await fs.writeFile(path.join(appConfig.backupPath, withEnv, "managed.env"), 'A="b"\n');
    const listed = (await BackupModel.listBackups()).find((b) => b.folder === withEnv);
    // without this an operator cannot tell that a folder is credential-bearing
    assert.equal(listed.envFileExists, true);
    assert.ok(listed.envFileSize > 0);
  });
});
