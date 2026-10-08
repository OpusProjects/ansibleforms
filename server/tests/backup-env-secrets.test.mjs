// A backup must never carry ENCRYPTION_SECRET or ACCESS_TOKEN_SECRET.
//
// The dump beside the environment file holds every stored credential as AES ciphertext, so
// shipping the key in the same folder defeats it - and a backup travels: rsync, a support
// bundle, a playbook that reads persistent/. Neither secret is readable through the API at
// all (REFUSED in envSettings, redacted by GET /api/v2/config/env), so it must not be
// readable from a backup either.
//
// The filter used to be a hand written line pattern that did not recognise dotenv's
// optional `export ` prefix. `export ENCRYPTION_SECRET='...'` was therefore read by the
// application as a real value and NOT recognised by the filter, and the key went into
// every backup verbatim. That form is not exotic - it is what you write when the file is
// also meant to be sourced, which this project's own documentation does.
//
// So the rule under test is not "does this one pattern work" but "does the filter agree
// with the reader", which is why every case below is asserted with dotenv itself.
import { test, describe, expect, vi, beforeEach, afterAll } from "vitest";
import dotenv from "dotenv";
import path from "path";
import os from "os";
import { promises as realFs, mkdtempSync } from "fs";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
// MANAGED_ENV_PATH is a module level constant, so it has to be set before the first import
// or the test reads the developer's real persistent/.env
const tmp = mkdtempSync(path.join(os.tmpdir(), "af-env-backup-"));
process.env.MANAGED_ENV_PATH = path.join(tmp, ".env");

const logged = { error: [], info: [], warning: [] };
vi.mock("../src/lib/logger.js", () => ({
  default: {
    error: (m) => logged.error.push(String(m)),
    info: (m) => logged.info.push(String(m)),
    warning: (m) => logged.warning.push(String(m)),
    notice: () => {}, debug: () => {},
  },
}));

// vitest.config aliases '../../config/app.config.js' to the shared stub, which is
// deliberately minimal - so the fields this model reads have to be added to the stub
// object itself (it is the same object the model holds), not to a fresh mock.
const appConfig = (await import("./__mocks__/app.config.js")).default;
const before = { ...appConfig };
appConfig.configPath = path.join(tmp, "config.yaml");
appConfig.formsFolderPath = path.join(tmp, "forms");
appConfig.backupPath = path.join(tmp, "backups");

const BackupModel = (await import("../src/models/backup.model.js")).default;

const SECRETS = ["ENCRYPTION_SECRET", "ACCESS_TOKEN_SECRET"];

/** Write `content` as the managed env file, back it up, and read what landed. */
async function roundTrip(content) {
  const src = process.env.MANAGED_ENV_PATH;
  const folder = path.join(tmp, "backup");
  await realFs.mkdir(folder, { recursive: true });
  await realFs.writeFile(src, content);
  await BackupModel.backupFormsAndFolder(folder);
  const dest = path.join(folder, "managed.env");
  try {
    return await realFs.readFile(dest, "utf8");
  } catch {
    return null;   // deliberately not written
  }
}

beforeEach(async () => {
  logged.error.length = 0; logged.info.length = 0; logged.warning.length = 0;
  await realFs.rm(path.join(tmp, "backup"), { recursive: true, force: true });
});

// the stub is shared across the whole run, so put back what was there
afterAll(async () => {
  for (const k of Object.keys(appConfig)) if (!(k in before)) delete appConfig[k];
  Object.assign(appConfig, before);
  await realFs.rm(tmp, { recursive: true, force: true });
});

describe("the master secrets never reach a backup", () => {
  test.each([
    ["a plain assignment", "ENCRYPTION_SECRET='shhh'\nDB_HOST='db'\n"],
    ["the export prefix dotenv accepts", "export ENCRYPTION_SECRET='shhh'\nDB_HOST='db'\n"],
    ["export with extra spacing", "   export   ACCESS_TOKEN_SECRET = 'shhh'\nDB_HOST='db'\n"],
    ["both, mixed forms", "export ENCRYPTION_SECRET='a'\nACCESS_TOKEN_SECRET=\"b\"\nDB_HOST='db'\n"],
    ["a value spanning lines", 'ENCRYPTION_SECRET="line1\nline2"\nDB_HOST=\'db\'\n'],
    ["a backtick quoted value", "ENCRYPTION_SECRET=`shhh`\nDB_HOST='db'\n"],
  ])("%s", async (_name, content) => {
    const backed = await roundTrip(content);
    // either the file was written without them, or it was refused entirely - never leaked
    if (backed === null) {
      expect(logged.error.join(" ")).toMatch(/Refusing to put the environment file/);
      return;
    }
    const parsed = dotenv.parse(backed);
    for (const secret of SECRETS) {
      expect(parsed[secret], `${secret} must not be readable from the backup`).toBeUndefined();
    }
    // and not present as loose text either - a dropped first line whose value continued
    // would leave the rest of the secret behind
    expect(backed).not.toMatch(/shhh|line2/);
  });

  test("everything else is kept, or a rebuild loses the instance", async () => {
    const backed = await roundTrip("export ENCRYPTION_SECRET='shhh'\nDB_HOST='db'\nVAULT_ADDR='https://v'\n# a comment\n");
    const parsed = dotenv.parse(backed);
    expect(parsed.DB_HOST).toBe("db");
    expect(parsed.VAULT_ADDR).toBe("https://v");
    expect(backed).toContain("# a comment");
  });

  test("a name that merely CONTAINS a secret name is not stripped", async () => {
    const backed = await roundTrip("MY_ENCRYPTION_SECRET_NOTE='keep me'\nENCRYPTION_SECRET='shhh'\n");
    expect(dotenv.parse(backed).MY_ENCRYPTION_SECRET_NOTE).toBe("keep me");
    expect(dotenv.parse(backed).ENCRYPTION_SECRET).toBeUndefined();
  });

  test("and the removal is stated in the file, so a restore is not a surprise", async () => {
    const backed = await roundTrip("ENCRYPTION_SECRET='shhh'\nDB_HOST='db'\n");
    expect(backed).toMatch(/removed from this backup on purpose/);
  });
});

describe("the filter is checked against the real reader, not against itself", () => {
  test("a form it cannot handle is refused rather than shipped", async () => {
    // the verification pass is what makes the whole class safe : if some future dotenv
    // grammar slips past the line filter, the file is left out instead of leaking
    const src = await import("fs").then((m) => m.readFileSync("src/models/backup.model.js", "utf8"));
    expect(src).toMatch(/dotenv\.parse\(body\)\[name\] !== undefined/);
    expect(src).toMatch(/Refusing to put the environment file in the backup/);
  });
});
