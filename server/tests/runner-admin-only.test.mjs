// A runner receives the credentials of every job it runs (an RTE sealed with its token, AWX as
// extra vars) : only an admin adds, changes or deletes one. A user with settings access sees
// and tests them.
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const calls = [];
vi.mock("../src/models/runner.model.js", () => ({
  SECRET_MASK: "********",
  default: {
    create: async (data) => { calls.push(["create", data]); return 1; },
    update: async (data, id) => { calls.push(["update", data, id]); return true; },
    delete: async (id) => { calls.push(["delete", id]); return true; },
    findById: async () => ({ id: 1, name: "rte", type: "rte", token: "secret-token" }),
    findAll: async () => [],
  },
}));

const { default: controller } = await import("../src/controllers/v2/runner.controller.js");

function call(handler, user, { body = { name: "evil", uri: "http://evil:8000", token: "mine" }, params = { id: "1" } } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
    };
    handler({ body, params, headers: {}, user: { user } }, res);
  });
}

const settingsUser = { username: "ops", roles: ["ops"], options: { showSettings: true } };
const admin = { username: "admin", roles: ["admin"], options: { showSettings: true } };

beforeEach(() => { calls.length = 0; });

describe("changing a runner", () => {
  test.each([["create", "create"], ["update", "update"], ["delete", "delete"]])("%s : refused for a user with settings access only", async (_n, fn) => {
    const r = await call(controller[fn], settingsUser);
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test.each([["create", "create"], ["update", "update"], ["delete", "delete"]])("%s : an admin may", async (_n, fn) => {
    const r = await call(controller[fn], admin);
    expect(r.status).toBeLessThan(300);
    expect(calls.length).toBe(1);
  });

  test("seeing and testing stay open to settings users", async () => {
    const r = await call(controller.findById, settingsUser);
    expect(r.status).toBe(200);
  });
});
