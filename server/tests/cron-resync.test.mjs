// The worker's cron registry follows the database (cron.service.js resync) : a schedule or a
// repository edited on any app node, or by the seed, is registered, rebuilt or dropped on the
// worker. Outside the worker the registry stays empty, whatever the controllers ask.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let repositories;
let schedules;
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql) => {
      if (/FROM AnsibleForms.`repositories`/.test(sql)) return repositories;
      if (/FROM AnsibleForms.`schedule`/.test(sql)) return schedules;
      return [];
    },
    tryDo: async () => [],
  },
}));

const { default: cronService } = await import("../src/services/cron.service.js");

beforeEach(() => {
  repositories = [{ name: "forms", cron: "0 * * * *" }];
  schedules = [{ id: 1, name: "nightly", one_time_run: 0, cron: "0 2 * * *", run_at: null }];
});
afterEach(() => {
  cronService.stopAll();
  cronService.active = false;
  cronService.signatures.repositories.clear();
  cronService.signatures.schedules.clear();
});

describe("only the worker registers anything", () => {
  test("before the worker starts it, add is a no-op (an app node's controllers call it)", () => {
    cronService.addSchedule(9, "x", "0 1 * * *", 0, null);
    cronService.addRepository("r", "0 1 * * *");
    assert.equal(cronService.jobs.schedules.size, 0);
    assert.equal(cronService.jobs.repositories.size, 0);
  });
});

describe("the registry follows the database", () => {
  test("initializeAll registers what the database holds", async () => {
    await cronService.initializeAll();
    assert.deepEqual([...cronService.jobs.repositories.keys()], ["forms"]);
    assert.deepEqual([...cronService.jobs.schedules.keys()], [1]);
  });

  test("a changed cron is rebuilt, an unchanged one is left running", async () => {
    await cronService.initializeAll();
    const before = { repo: cronService.jobs.repositories.get("forms"), sched: cronService.jobs.schedules.get(1) };
    schedules = [{ ...schedules[0], cron: "30 2 * * *" }];
    await cronService.resync();
    assert.equal(cronService.jobs.repositories.get("forms"), before.repo, "untouched : same task");
    assert.notEqual(cronService.jobs.schedules.get(1), before.sched, "changed : a new task");
  });

  test("a new row is added and a removed one dropped", async () => {
    await cronService.initializeAll();
    repositories = [{ name: "playbooks", cron: "*/5 * * * *" }];
    schedules = [...schedules, { id: 2, name: "once", one_time_run: 1, cron: "", run_at: new Date("2030-01-01T00:00:00Z") }];
    await cronService.resync();
    assert.deepEqual([...cronService.jobs.repositories.keys()], ["playbooks"]);
    assert.deepEqual([...cronService.jobs.schedules.keys()].sort(), [1, 2]);
  });

  test("describe() counts what is registered, for any node's Status page", async () => {
    await cronService.initializeAll();
    const d = cronService.describe();
    assert.equal(d.counts.schedules, 1);
    assert.equal(d.counts.repositories, 1);
    assert.ok(d.lastResync);
  });
});
