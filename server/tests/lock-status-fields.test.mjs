// GET /api/v2/lock : who holds the designer lock, without the rest of their user record.
//
// The lock file is a copy of the user who took the lock - roles, groups, options, email.
// The status went out whole to every designer user, who only needs to see who holds the
// lock and since when (the designer page, and the lock on the header's Designer link).
import { describe, test, expect, vi, beforeEach } from "vitest";

const stored = {
  username: "bsmith",
  type: "ldap",
  displayName: "Bob Smith",
  created: "2026-10-07 10:00:00",
  email: "bob@example.com",
  roles: ["admin", "designers"],
  groups: ["ldap/Domain Admins"],
  options: { showDesigner: true, showSettings: true },
};
const status = vi.fn();
vi.mock("../src/models/lock.model.js", () => ({ default: { status: (...a) => status(...a) } }));

const { default: lockController } = await import("../src/controllers/v2/lock.controller.js");

/** Runs the status endpoint and returns what it answered. */
async function call() {
  let body;
  const res = { json: (b) => (body = b), status: () => res };
  await lockController.status({ user: { user: { username: "alice", type: "local" } }, headers: {} }, res);
  return body;
}

describe("the lock status", () => {
  beforeEach(() => status.mockReset());

  test("names the holder and the time, nothing else of their record", async () => {
    status.mockResolvedValue({ lock: { ...stored }, match: false, free: false });
    const body = await call();
    const lock = (body.data?.output ?? body).lock;
    expect(lock).toEqual({ username: "bsmith", type: "ldap", displayName: "Bob Smith", created: "2026-10-07 10:00:00" });
    expect(JSON.stringify(body)).not.toMatch(/Domain Admins|showSettings|bob@example\.com|designers/);
  });

  test("leaves out a field the holder does not have (a local user has no display name)", async () => {
    status.mockResolvedValue({ lock: { username: "alice", type: "local", created: "x", roles: ["admin"] }, match: true, free: false });
    const body = await call();
    expect((body.data?.output ?? body).lock).toEqual({ username: "alice", type: "local", created: "x" });
    expect((body.data?.output ?? body).match).toBe(true);
  });

  test("answers a free lock as before", async () => {
    status.mockResolvedValue({ free: true });
    const body = await call();
    expect(body.data?.output ?? body).toEqual({ free: true });
  });
});
