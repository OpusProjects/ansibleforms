// Re-applying the config seed under a RUNNING process (CONFIG_SEED_RELOAD_SECONDS,
// POST /api/v2/config-seed/apply, SIGHUP).
//
// Four properties carry this feature, and every one of them fails silently :
//
//  1. An unchanged file must not be re-applied. The poll runs every minute for the life of
//     the instance, so an apply per tick would rewrite every managed row for ever - and
//     each rewrite of a credential is a fresh encryption, which the audit trail would
//     record as a change that nobody made.
//  2. A changed file MUST be applied, or the whole feature is decoration and the operator
//     believes a change reached the instance when it did not.
//  3. A bad reload must NOT be fatal. At boot it is - refusing to start is safe, the old
//     pod keeps serving. Exiting an instance that is already up because a file it watches
//     was edited badly would take the application down with no operator action at all.
//  4. The same broken content must not be retried every tick, or one typo writes an
//     identical error to the log for ever while nothing about the outcome can differ.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// Nothing here touches mysql : every query answers with an empty result, which for the
// sections an empty seed declares is exactly what a converged database returns.
const queries = [];
let dbHandler = async () => [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      queries.push({ sql, vars });
      return dbHandler(sql, vars);
    },
  },
}));

// the same object lib/seed.js sees : vitest.config aliases '../../config/app.config.js'
// to this mock, so importing the real file here would set the path on a different object
const appConfig = (await import("./__mocks__/app.config.js")).default;
const { applyConfigSeed, reloadConfigSeed, getSeedState, _resetSeedState } =
  await import("../src/lib/seed.js");

let dir;
let seedPath;

// An empty-but-valid seed. It declares nothing, so applying it is a complete run of the
// real code path - every section, the release sweep, the audit decision - that touches no
// row, which is what makes it usable without a database.
const EMPTY_SEED = "version: 1\n";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-seed-reload-"));
  seedPath = path.join(dir, "seed.yaml");
  fs.writeFileSync(seedPath, EMPTY_SEED);
  appConfig.configSeedPath = seedPath;
  _resetSeedState();
  queries.length = 0;
  dbHandler = async () => [];
});

afterEach(() => {
  appConfig.configSeedPath = "";
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reloading the config seed", () => {
  test("does nothing at all when no seed is configured", async () => {
    appConfig.configSeedPath = "";
    assert.deepEqual(await reloadConfigSeed(), { status: "off" });
  });

  test("applies a file it has not seen", async () => {
    const result = await reloadConfigSeed();
    assert.equal(result.status, "applied");
    assert.ok(result.summary, "an applied reload reports what it did");
  });

  // The property that keeps the poll from rewriting the database every minute.
  test("leaves an unchanged file alone on the next tick", async () => {
    assert.equal((await reloadConfigSeed()).status, "applied");
    assert.equal((await reloadConfigSeed()).status, "unchanged");
    assert.equal((await reloadConfigSeed()).status, "unchanged");
  });

  // The boot apply has to seed the same state, or the FIRST poll of every instance would
  // re-apply a file that had just been applied seconds earlier.
  test("the apply at startup counts, so the first poll is already a no-op", async () => {
    await applyConfigSeed();
    assert.equal((await reloadConfigSeed()).status, "unchanged");
  });

  test("applies again once the content changes", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "version: 1\nawx:\n  items: []\n");
    assert.equal((await reloadConfigSeed()).status, "applied");
  });

  test("force applies even when nothing changed, which is what the endpoint asks for", async () => {
    await reloadConfigSeed();
    assert.equal((await reloadConfigSeed()).status, "unchanged");
    assert.equal((await reloadConfigSeed({ force: true })).status, "applied");
  });
});

describe("a reload that fails keeps the instance running", () => {
  test("a schema violation is reported, not thrown", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "version: 1\nawx:\n  items:\n    - name: t\n      uri: u\n      tokenn: x\n");

    const result = await reloadConfigSeed();
    assert.equal(result.status, "failed");
    assert.match(result.error, /validation failed/);
  });

  test("the failure is visible to the Status page instead of only the log", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "this: is: not: valid: yaml:\n");
    await reloadConfigSeed();

    const state = getSeedState();
    assert.ok(state.failure, "getSeedState reports the failed reload");
    assert.ok(state.failure.at, "with when it happened");
    assert.ok(state.appliedAt, "and still remembers the apply that IS in force");
  });

  test("the same broken content is not retried on every tick", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "version: 1\nnope: {}\n");

    assert.equal((await reloadConfigSeed()).status, "failed");
    assert.equal((await reloadConfigSeed()).status, "skipped");
    assert.equal((await reloadConfigSeed()).status, "skipped");
  });

  test("but asking explicitly retries it, because that is why somebody asked", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "version: 1\nnope: {}\n");
    await reloadConfigSeed();
    assert.equal((await reloadConfigSeed()).status, "skipped");
    assert.equal((await reloadConfigSeed({ force: true })).status, "failed");
  });

  test("fixing the file clears the failure and applies it", async () => {
    await reloadConfigSeed();
    fs.writeFileSync(seedPath, "version: 1\nnope: {}\n");
    await reloadConfigSeed();
    assert.ok(getSeedState().failure);

    fs.writeFileSync(seedPath, "version: 1\nawx:\n  items: []\n");
    assert.equal((await reloadConfigSeed()).status, "applied");
    assert.equal(getSeedState().failure, null, "a good apply clears the reported failure");
  });

  // A ConfigMap being remounted can leave the path missing for a moment. That must read as
  // a failed reload on a running instance, never as a crash.
  test("a file that has gone away is a failed reload, not an exception", async () => {
    await reloadConfigSeed();
    fs.rmSync(seedPath);

    const result = await reloadConfigSeed();
    assert.equal(result.status, "failed");
    assert.ok(getSeedState().failure);
  });

  test("and a file that comes back is applied again", async () => {
    await reloadConfigSeed();
    fs.rmSync(seedPath);
    await reloadConfigSeed();

    fs.writeFileSync(seedPath, "version: 1\nawx:\n  items: []\n");
    assert.equal((await reloadConfigSeed()).status, "applied");
  });
});

// The boot, the reload poll and SIGHUP can ask at the same moment. Each section is
// find-then-create, so two applies at once could create one row twice : they run one after
// the other. And a reload that applies must not wait for itself.
describe("one apply at a time", () => {
  test("concurrent applies and reloads run one after the other, and all finish", async () => {
    let inFlight = 0;
    let most = 0;
    dbHandler = async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return [];
    };
    const results = await Promise.all([
      applyConfigSeed(),
      reloadConfigSeed({ force: true, trigger: "SIGHUP" }),
      reloadConfigSeed({ force: true, trigger: "poll" }),
      applyConfigSeed(),
    ]);
    assert.equal(results.length, 4, "none waits for ever - a reload that applies does not queue behind itself");
    assert.equal(most, 1, "never two queries of two applies at the same time");
  });

  test("a failing apply does not block the next", async () => {
    fs.writeFileSync(seedPath, "version: 1\nnot_a_section: [\n");
    const first = await reloadConfigSeed({ force: true });
    assert.equal(first.status, "failed");
    fs.writeFileSync(seedPath, EMPTY_SEED);
    assert.equal((await reloadConfigSeed({ force: true })).status, "applied");
  });
});
