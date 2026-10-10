// Granting admin is the admin role's own : a user with settings access cannot put an account
// in a group that grants admin, nor change, reset or delete an admin account or such a group,
// and a designer without the admin role cannot change the roles (lib/adminGrants.js).
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// users 1 (admin, in group 1 'admins'), 2 (bob, in group 2 'ops') ; groups 1 admins, 2 ops
const users = { 1: { username: "admin", group_id: 1 }, 2: { username: "bob", group_id: 2 }, 3: { username: "carol", group_id: 2 } };
const groups = { 1: "admins", 2: "ops", 3: "superusers" };
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/FROM AnsibleForms.`users` WHERE id=\?/.test(sql)) return users[params[0]] ? [users[params[0]]] : [];
      if (/FROM AnsibleForms.`user_groups`/.test(sql)) return params[0] == 3 ? [{ group_id: 3 }] : [];
      if (/FROM AnsibleForms.`groups` WHERE id IN/.test(sql)) return params[0].map((id) => ({ name: groups[id] })).filter((g) => g.name);
      return [];
    },
  },
}));
vi.mock("../src/models/form.model.js", () => ({
  default: {
    load: async () => ({ roles: [{ name: "admin", groups: ["local/admins", "local/superusers"], users: ["local/root"] }, { name: "public", groups: ["local/ops"] }] }),
  },
}));

const { assertMayTouchAdmin, adminGrantsFromRoles } = await import("../src/lib/adminGrants.js");
const settingsUser = { user: { user: { username: "ops", roles: ["public"] } } };
const admin = { user: { user: { username: "admin", roles: ["admin"] } } };

describe("who grants admin", () => {
  test("the admin role's local groups and users", () => {
    const g = adminGrantsFromRoles([{ name: "admin", groups: ["local/admins", "ldap/x"], users: ["local/root"] }]);
    expect([...g.groups]).toEqual(["admins"]);
    expect([...g.users]).toEqual(["root"]);
  });
});

describe("a user with settings access, without the admin role", () => {
  test.each([
    ["create a user in the admins group", { username: "new", groupIds: [1] }],
    ["create a user the admin role names", { username: "root" }],
    ["change the admin account (its password)", { userId: 1 }],
    ["change a user who is admin through a second group", { userId: 3 }],
    ["move a user into the admins group", { userId: 2, groupIds: [1] }],
    ["rename or delete the admins group", { groupId: 1 }],
    ["create a group that grants admin", { groupName: "superusers" }],
  ])("cannot %s", async (_what, change) => {
    await expect(assertMayTouchAdmin(settingsUser, change)).rejects.toThrow(/Only an admin/);
  });

  test("still manages everybody else", async () => {
    await expect(assertMayTouchAdmin(settingsUser, { userId: 2, groupIds: [2] })).resolves.toBeUndefined();
    await expect(assertMayTouchAdmin(settingsUser, { username: "new", groupIds: [2] })).resolves.toBeUndefined();
    await expect(assertMayTouchAdmin(settingsUser, { groupId: 2, groupName: "ops2" })).resolves.toBeUndefined();
  });
});

describe("an admin", () => {
  test("does all of it", async () => {
    await expect(assertMayTouchAdmin(admin, { userId: 1, groupIds: [1], groupId: 1, groupName: "admins", username: "root" })).resolves.toBeUndefined();
  });
});

describe("a designer without the admin role", () => {
  test("saves a configuration whose roles are as they were, and only that", async () => {
    vi.resetModules();
    vi.doMock("../src/models/settings.model.js", () => ({
      default: { getActiveConfig: async () => "roles:\n  - name: admin\n    groups: [local/admins]\n  - name: public\n    groups: [local/ops]\n" },
    }));
    const { assertRolesUnchanged } = await import("../src/controllers/v2/config.controller.js");
    const designer = { user: { user: { username: "dee", roles: ["public"], options: { showDesigner: true } } } };
    // the same roles, keys in another order : unchanged
    await expect(assertRolesUnchanged(designer, [{ groups: ["local/admins"], name: "admin" }, { name: "public", groups: ["local/ops"] }])).resolves.toBeUndefined();
    // a group added to admin : refused
    await expect(assertRolesUnchanged(designer, [{ name: "admin", groups: ["local/admins", "local/ops"] }, { name: "public", groups: ["local/ops"] }])).rejects.toThrow(/Only an admin can change the roles/);
    // an admin may
    await expect(assertRolesUnchanged(admin, [{ name: "admin", groups: ["local/everyone"] }])).resolves.toBeUndefined();
    // a backup without a base configuration has nothing to check
    await expect(assertRolesUnchanged(designer, null)).resolves.toBeUndefined();
  });
});
