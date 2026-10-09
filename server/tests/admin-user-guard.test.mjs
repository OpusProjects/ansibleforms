// The admin user is the way back in : it is never deleted, nor renamed, whatever sends the
// request (the users list and the user's page grey the buttons out, the api is guarded here).
import { test, describe, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// the users table : an admin and another user ; what reaches the base model is recorded
const rows = { 1: { id: 1, username: "admin" }, 2: { id: 2, username: "jdoe" } };
const calls = [];
vi.mock("../src/models/crud.model.js", () => ({
  default: class CrudModel {
    static async findById(_model, id) { return rows[id]; }
    static async delete(_model, id) { calls.push(["delete", id]); return true; }
    static async update(_model, data, id) { calls.push(["update", id, data]); return true; }
  },
}));
vi.mock("../src/lib/logger.js", () => ({
  default: { info() {}, debug() {}, warning() {}, error() {}, notice() {} },
}));
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));
vi.mock("../src/models/token.model.js", () => ({ default: { deleteAllForUser: async () => {} } }));
vi.mock("../src/models/ldap.model.js", () => ({ default: {} }));
vi.mock("../src/models/form.model.js", () => ({ default: {} }));

const User = (await import("../src/models/user.model.js")).default;

describe("the admin user is kept", () => {
  beforeEach(() => { calls.length = 0; });

  test("deleting it is refused, and nothing is deleted", async () => {
    await assert.rejects(() => User.delete(1), /cannot delete user 'admin'/);
    assert.deepEqual(calls, []);
  });

  test("renaming it is refused", async () => {
    await assert.rejects(() => User.update({ username: "root" }, 1), /cannot rename user 'admin'/);
    assert.deepEqual(calls, []);
  });

  test("its other fields still change", async () => {
    await User.update({ username: "admin", email: "admin@example.com" }, 1);
    assert.equal(calls[0][0], "update");
  });

  test("another user is deleted as before", async () => {
    await User.delete(2);
    assert.deepEqual(calls, [["delete", 2]]);
  });
});

// A description or an email cleared on the user's page is saved empty, not dropped (it used to
// be, so neither could ever be cleared) ; an empty password still means "keep the current one".
describe("a user update keeps a cleared description", () => {
  beforeEach(() => { calls.length = 0; });

  test("an empty description and email are written, an empty password is not", async () => {
    await User.update({ description: "", email: null, password: "" }, 2);
    assert.deepEqual(calls[0], ["update", 2, { description: "", email: "" }]);
  });

  test("an update with nothing left to change writes nothing", async () => {
    await User.update({ password: "" }, 2);
    assert.deepEqual(calls, []);
  });
});
