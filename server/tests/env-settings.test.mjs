import { describe, test, afterEach, assert } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "root";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "secret";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "afenv-"));
process.env.MANAGED_ENV_PATH = path.join(tmp, ".env");
const Env = (await import("../src/lib/envSettings.js")).default;
// The STUB, not the real config : vitest aliases '../../config/app.config.js' - the
// specifier envSettings.js uses - to tests/__mocks__/app.config.js, so importing the real
// module here would hand back a different object than the one applyLive() mutates.
const appConfig = (await import("./__mocks__/app.config.js")).default;

describe("a written value survives the boot reader unchanged", () => {
  // serialize() escaped \\ and " inside double quotes; dotenv unescapes neither, so every
  // value with a backslash came back DIFFERENT after a restart - `\\[low\\]`, the documented
  // default of REGEX_FILTER_JOB_OUTPUT, became `\\\\[low\\\\]`. isOverridden then compared that
  // against the file, flipped the row to read-only, and the value could never be corrected
  // from the page again. dotenv is the boot reader, so it is what this must agree with.
  const CASES = {
    plain: "hello",
    spaces: "docker exec ansibleforms-mysql mysqldump",
    regex: "\\[low\\]",
    windowsPath: "C:\\new\\dir",
    doubleQuote: 'say "hi"',
    singleQuote: "it's",
    bothQuotes: `it's "x"`,
    hash: "a # b",
    equals: "a=b",
    dollar: "$HOME",
    trailingBackslash: "ends\\",
    newline: "line1\nline2",
    empty: "",
  };

  for (const [name, value] of Object.entries(CASES)) {
    test(`round-trips ${name} through dotenv`, async () => {
      const dotenv = (await import("dotenv")).default;
      const text = Env.serialize(new Map([["K", value]]));
      assert.equal(dotenv.parse(text).K, value, `serialize -> dotenv changed ${name}`);
      // and our own reader must agree with dotenv, or isOverridden locks the field
      assert.equal(Env.parseEnvFile(text).get("K"), value, `parseEnvFile disagrees for ${name}`);
    });
  }
});

describe("editing environment variables", () => {
  afterEach(async () => { await fs.rm(process.env.MANAGED_ENV_PATH, { force: true }); });

  test("values are always quoted, so sourcing the file in bash is safe", () => {
    // `FOO=docker exec x` read by `. ./.env` assigns FOO=docker and then RUNS `exec x`,
    // which replaces the shell - a footgun this repo has already been bitten by
    const text = Env.serialize(new Map([["MYSQLDUMP_COMMAND", "docker exec db mysqldump"]]));
    assert.match(text, /^MYSQLDUMP_COMMAND='docker exec db mysqldump'$/m);
  });

  test("a round trip preserves quotes, backslashes and spaces", () => {
    const original = new Map([["A", 'has "quotes"'], ["B", "back\\slash"], ["C", "a b c"]]);
    const back = Env.parseEnvFile(Env.serialize(original));
    for (const [k, v] of original) assert.equal(back.get(k), v, `${k} survived the round trip`);
  });

  test("the destructive variables are refused, not merely hidden", () => {
    for (const name of ["ENCRYPTION_SECRET", "ACCESS_TOKEN_SECRET", "REINIT_ADMIN", "ALLOW_SCHEMA_CREATION", "ADMIN_PASSWORD", "NODE_ENV"]) {
      assert.equal(Env.classify(name), "refused", `${name} must be refused`);
      assert.ok(Env.REFUSED[name], `${name} must carry a reason`);
    }
  });

  test("a variable set in the real environment counts as overridden", () => {
    process.env.AF_TEST_OVERRIDE = "from-compose";
    const managed = new Map([["AF_TEST_OVERRIDE", "from-file"]]);
    // dotenv would not overwrite the real value, so saving the file cannot change it
    assert.equal(Env.isOverridden("AF_TEST_OVERRIDE", managed), true);
    assert.equal(Env.isOverridden("AF_TEST_ABSENT", new Map()), false);
    delete process.env.AF_TEST_OVERRIDE;
  });

  test("a number field rejects a non-number, and no field takes a line break", () => {
    assert.match(Env.validate("JOB_RETENTION_DAYS", "abc", { type: "number" }), /whole number/);
    assert.equal(Env.validate("JOB_RETENTION_DAYS", "45", { type: "number" }), null);
    assert.match(Env.validate("ANY", "a\nb", {}), /line break/);
  });

  test("a live variable is applied to the running config, a restart one is not", () => {
    const saved = appConfig.jobRetentionDays;
    try {
      assert.equal(Env.applyLive("JOB_RETENTION_DAYS", "45"), true);
      assert.equal(appConfig.jobRetentionDays, 45, "takes effect without a restart");
      assert.equal(Env.applyLive("PORT", "9999"), false, "PORT is captured before listen");
      // VAULT_* are imported once when upgrading and ignored afterwards : nothing to apply
      assert.equal(Env.applyLive("VAULT_TOKEN", "hvs.test"), false);
      assert.equal(process.env.PORT, "9999", "still written to the environment");
    } finally {
      appConfig.jobRetentionDays = saved;
      delete process.env.PORT;
      delete process.env.VAULT_TOKEN;
    }
  });

  // An applier that cannot apply must say so : reporting 'live' would tell the user the
  // change is in effect when only the file was written.
  test("a live applier that refuses is reported as needing a restart", () => {
    // http mode : no https server is registered, so the TLS context cannot be swapped
    assert.equal(Env.applyLive("HTTPS_CERT", "/tmp/nope.crt"), false);
    assert.equal(process.env.HTTPS_CERT, "/tmp/nope.crt", "still written to the environment");
    delete process.env.HTTPS_CERT;
  });

  test("'a positive integer' is enforced, so a 0 cannot reach the next boot", () => {
    const doc = { type: "number", allowed: "a positive integer" };
    assert.match(Env.validate("DB_POOL_SIZE", "0", doc), /greater than 0/);
    assert.match(Env.validate("DB_POOL_SIZE", "-4", doc), /greater than 0/);
    assert.equal(Env.validate("DB_POOL_SIZE", "8", doc), null);
    // a number field without that wording keeps accepting 0 - it means 'off' for retention
    assert.equal(Env.validate("JOB_RETENTION_DAYS", "0", { type: "number" }), null);
  });

  test("LAUNCH_VALIDATION is enforce unless off or log is set : a typo does not switch it off", () => {
    const saved = process.env.LAUNCH_VALIDATION;
    try {
      for (const [value, expected] of [["off", "off"], ["LOG", "log"], ["enforce", "enforce"], ["0", "enforce"], ["of", "enforce"]]) {
        Env.applyLive("LAUNCH_VALIDATION", value);
        assert.equal(appConfig.launchValidation, expected, `'${value}'`);
      }
    } finally {
      if (saved === undefined) delete process.env.LAUNCH_VALIDATION;
      else process.env.LAUNCH_VALIDATION = saved;
      delete appConfig.launchValidation;
    }
  });

  test("writing keeps the previous file as .env.bak, and the file is not world readable", async () => {
    await Env.writeManaged(new Map([["JOB_RETENTION_DAYS", "10"]]));
    await Env.writeManaged(new Map([["JOB_RETENTION_DAYS", "20"]]));
    const backup = await fs.readFile(`${process.env.MANAGED_ENV_PATH}.bak`, "utf8");
    // a bad value can stop the app from starting, so the old file is the way back
    assert.match(backup, /JOB_RETENTION_DAYS='10'/);
    const stat = await fs.stat(process.env.MANAGED_ENV_PATH);
    assert.equal(stat.mode & 0o077, 0, "the file can hold credentials");
    const current = await Env.readManaged();
    assert.equal(current.get("JOB_RETENTION_DAYS"), "20");
  });
});
