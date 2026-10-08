// A schedule the scheduler cannot run must not reach the database.
//
// cron.service.js validates too, but only when it REGISTERS the task - and there a failure
// is a log line and a `return`. By then the row is stored, so the repository or
// schedule simply never runs again and nothing on any page says why. That is the quietest
// failure in the product: a sync that has stopped looks exactly like one with nothing to do.
//
// The check is central rather than per model on purpose: all three tables that carry a
// schedule declare the same `cron` column, and a fourth should not need anyone to remember.
import { test, describe, expect, vi } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// nothing may reach the database at all for a refused write - that is the whole point
const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: { do: async (sql) => { queries.push(sql); return [{ id: 1, managed: 0 }]; } },
}));

const CrudModel = (await import("../src/models/crud.model.js")).default;

// a payload that satisfies each model's own required fields, so the only thing under
// test is the cron - assertRequired runs first on create and would otherwise be what
// throws, making every assertion below vacuous
const BASE = {
  repositories: { name: "x", uri: "https://example.com/r.git" },
  schedule: { name: "x" },
  users: { username: "x", password: "y", group_id: 1 },
};
const CRON_TABLES = ["repositories", "schedule"];

describe("an unrunnable cron is refused on the way in", () => {
  test.each(CRON_TABLES)("%s.create refuses an inverted range", async (model) => {
    queries.length = 0;
    await expect(CrudModel.create(model, { ...BASE[model], cron: "0 0 * * 5-1" }))
      .rejects.toThrow(/[Ii]nvalid cron/);
    expect(queries, "the row must not be written").toEqual([]);
  });

  test.each(CRON_TABLES)("%s.update refuses an inverted range", async (model) => {
    queries.length = 0;
    await expect(CrudModel.update(model, { ...BASE[model], cron: "0 0 * * 5-1" }, 1))
      .rejects.toThrow(/[Ii]nvalid cron/);
    expect(queries, "not even the existence check should run for a bad input").toEqual([]);
  });

  test("a pattern that compiles but can never occur again is refused too", async () => {
    // croner parses '0 0 30 2 *' happily and then never fires it
    await expect(CrudModel.create("schedule", { ...BASE.schedule, cron: "0 0 30 2 *" }))
      .rejects.toThrow(/[Ii]nvalid cron/);
  });
});

describe("what the scheduler can run still gets through", () => {
  test.each(["0 0 * * *", "0 8 * * MON", "*/5 * * * *", "0 0 L * *", "0 0 * * 1#2"])(
    "accepts %s", async (cron) => {
      queries.length = 0;
      await CrudModel.create("schedule", { ...BASE.schedule, cron });
      expect(queries.length, "a valid cron must reach the insert").toBeGreaterThan(0);
    });

  test("an absent cron is not validated - it means 'not being changed'", async () => {
    queries.length = 0;
    await CrudModel.update("schedule", { ...BASE.schedule }, 1);
    expect(queries.length).toBeGreaterThan(0);
  });

  test("an empty cron is allowed - 'no schedule' is a legitimate value", async () => {
    queries.length = 0;
    await CrudModel.create("repositories", { ...BASE.repositories, cron: "" });
    expect(queries.length).toBeGreaterThan(0);
  });
});

describe("models without a cron column are unaffected", () => {
  test("a users payload carrying a stray cron key is not validated", async () => {
    queries.length = 0;
    await CrudModel.create("users", { ...BASE.users, cron: "nonsense" });
    expect(queries.length).toBeGreaterThan(0);
  });
});
