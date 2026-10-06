// The stored jobs api : who sees which stored job.
//
// A stored job holds the field values a user saved for a form, so it belongs to that user.
// allowStoredJobs is on for every user by default, which makes the scope of each route the
// only thing between one user and another user's values. The per-id routes (read, update,
// delete) always checked ownership, but the plain list (the stored jobs page) returned
// every row of every user. These tests pin one rule across all of them : a settings user
// (showSettings) manages everyone's, any other user only their own.
import { test, describe, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// i18n reaches the locale files; keep it out of the way and make the key visible
vi.mock("../src/lib/i18n.js", () => ({
  default: { t: (_req, key) => key },
}));

// the rows live in this array instead of the database
let rows = [];
vi.mock("../src/models/crud.model.js", () => ({
  default: {
    findAll: vi.fn(async () => rows.map(r => ({ ...r }))),
    findById: vi.fn(async (_model, id) => {
      const row = rows.find(r => String(r.id) === String(id));
      if (!row) {
        const err = new Error(`No record found with id ${id}`);
        err.statusCode = 404;
        throw err;
      }
      return { ...row };
    }),
    update: vi.fn(async () => true),
    delete: vi.fn(async () => true),
  },
}));

const controller = (await import("../src/controllers/v2/stored-jobs.controller.js")).default;

// Minimal express-shaped double; `status()` must be chainable
function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

// a logged in user as the auth middleware leaves it on req.user
const user = (username, options = {}) => ({
  user: { type: "local", username, options: { allowStoredJobs: true, ...options } },
});

async function call(handler, who, { params = {}, query = {}, body = {} } = {}) {
  const res = makeRes();
  await controller[handler]({ user: who, params, query, body }, res);
  return res;
}

const alice = user("alice");
const bob = user("bob");
const admin = user("admin", { showSettings: true });

beforeEach(() => {
  rows = [
    { id: 1, name: "a1", form_name: "Demo", username: "local/alice", form_data: '{"key":"alice-value"}' },
    { id: 2, name: "b1", form_name: "Demo", username: "local/bob", form_data: '{"key":"bob-value"}' },
    { id: 3, name: "a2", form_name: "Other", username: "local/alice", form_data: '{"key":"alice-other"}' },
  ];
});

describe("the stored jobs list", () => {
  test("a user without settings only gets their own stored jobs", async () => {
    const res = await call("find", bob);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.records.map(r => r.id), [2]);
    assert.ok(!JSON.stringify(res.body).includes("alice-value"), "another user's values must not be listed");
  });

  test("a user with no stored jobs gets an empty list, not everyone's", async () => {
    const res = await call("find", user("carol"));
    assert.deepEqual(res.body.records, []);
  });

  test("the same username from another login type is another user", async () => {
    const ldapAlice = { user: { type: "ldap", username: "alice", options: { allowStoredJobs: true } } };
    const res = await call("find", ldapAlice);
    assert.deepEqual(res.body.records, []);
  });

  test("a settings user still gets every stored job", async () => {
    const res = await call("find", admin);
    assert.deepEqual(res.body.records.map(r => r.id), [1, 2, 3]);
  });

  test("the form filter only gives the caller's own, even for a settings user", async () => {
    const res = await call("find", alice, { query: { form_name: "Demo" } });
    assert.deepEqual(res.body.records.map(r => r.id), [1]);
    const resAdmin = await call("find", admin, { query: { form_name: "Demo" } });
    assert.deepEqual(resAdmin.body.records, []);
  });
});

describe("the per-id routes refuse another user's stored job", () => {
  for (const handler of ["findById", "update", "delete"]) {
    test(`${handler} answers 403 for another user's stored job`, async () => {
      const res = await call(handler, bob, { params: { id: "1" }, body: { name: "x" } });
      assert.equal(res.statusCode, 403);
      assert.ok(!JSON.stringify(res.body).includes("alice-value"));
    });

    test(`${handler} is allowed on the caller's own stored job`, async () => {
      const res = await call(handler, alice, { params: { id: "1" }, body: { name: "x" } });
      assert.equal(res.statusCode, 200);
    });

    test(`${handler} is allowed for a settings user on anyone's stored job`, async () => {
      const res = await call(handler, admin, { params: { id: "2" }, body: { name: "x" } });
      assert.equal(res.statusCode, 200);
    });
  }
});
