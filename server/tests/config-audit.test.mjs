// tests for the role delta that makes a permission change visible after the fact.
// A privilege escalation shipped here once (renaming a role to `admin` silently
// granted full admin while the editor showed the switches off), so the cases that
// matter most are the subtle ones: an option that is ABSENT on one side, and a role
// whose membership changed without any option changing.
import { test, describe } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const { diffRoles } = await import("../src/lib/configAudit.js");

const role = (name, options, groups = [], users = []) => ({ name, options, groups, users });

describe("diffRoles reports option changes", () => {
  test("a flag flipped true -> false", () => {
    const d = diffRoles([role("ops", { showSettings: true })], [role("ops", { showSettings: false })]);
    assert.deepEqual(d.updated, [{ role: "ops", changed: { showSettings: { from: true, to: false } } }]);
    assert.deepEqual(d.created, []);
    assert.deepEqual(d.deleted, []);
  });

  test("an option ADDED where it was absent is a change, not a no-op", () => {
    // absent is not false : most options default to true and the server ANDs them
    // across roles, so undefined -> false genuinely removes a permission
    const d = diffRoles([role("ops", {})], [role("ops", { showDesigner: false })]);
    assert.deepEqual(d.updated, [{ role: "ops", changed: { showDesigner: { from: undefined, to: false } } }]);
  });

  test("an option REMOVED is a change too", () => {
    const d = diffRoles([role("ops", { showDesigner: false })], [role("ops", {})]);
    assert.deepEqual(d.updated, [{ role: "ops", changed: { showDesigner: { from: false, to: undefined } } }]);
  });

  test("both showExtravars spellings are reported, neither normalised away", () => {
    const d = diffRoles(
      [role("ops", { showExtravars: true, showExtraVars: true })],
      [role("ops", { showExtravars: false, showExtraVars: false })]
    );
    assert.deepEqual(d.updated[0].changed, {
      showExtravars: { from: true, to: false },
      showExtraVars: { from: true, to: false },
    });
  });

  test("no change records nothing at all", () => {
    const same = [role("ops", { showSettings: true }, ["local/ops"], ["local/bob"])];
    const d = diffRoles(same, [role("ops", { showSettings: true }, ["local/ops"], ["local/bob"])]);
    assert.deepEqual(d, { created: [], deleted: [], updated: [], duplicated: [] });
  });

  test("missing / non-array role lists do not throw", () => {
    const empty = { created: [], deleted: [], updated: [], duplicated: [] };
    assert.deepEqual(diffRoles(undefined, undefined), empty);
    assert.deepEqual(diffRoles(null, "nonsense"), empty);
    // an entry without a name is ignored rather than crashing the save
    assert.deepEqual(diffRoles([{ options: {} }], [{ options: {} }]), empty);
  });
});

describe("diffRoles reports membership changes", () => {
  test("a swapped group is a change even when no option moved", () => {
    // this is how a role silently starts applying to different people
    const d = diffRoles(
      [role("ops", { showSettings: true }, ["local/ops"])],
      [role("ops", { showSettings: true }, ["local/everyone"])]
    );
    assert.equal(d.updated.length, 1);
    assert.deepEqual(d.updated[0].groups, { from: ["local/ops"], to: ["local/everyone"] });
    assert.equal(d.updated[0].changed, undefined, "no option changed, so no changed block");
  });

  test("group order alone is not a change", () => {
    const d = diffRoles([role("ops", {}, ["b", "a"])], [role("ops", {}, ["a", "b"])]);
    assert.deepEqual(d.updated, []);
  });

  test("object-shaped members are supported", () => {
    // the designer writes {provider,name} entries, the roles page writes strings
    const d = diffRoles(
      [role("ops", {}, [{ provider: "local", name: "ops" }])],
      [role("ops", {}, [{ provider: "local", name: "admins" }])]
    );
    assert.deepEqual(d.updated[0].groups, { from: ["ops"], to: ["admins"] });
  });
});

describe("diffRoles reports created and deleted roles", () => {
  test("a renamed role is a delete plus a create, which is the honest reading", () => {
    // it is also exactly the escalation case : 'ops' becoming 'admin' shows up as
    // admin being CREATED, which is the line worth seeing in a review
    const d = diffRoles(
      [role("ops", { showSettings: true }, ["local/ops"], ["local/bob"])],
      [role("admin", { showSettings: true }, ["local/ops"], ["local/bob"])]
    );
    assert.deepEqual(d.created, [{ role: "admin", groups: 1, users: 1 }]);
    assert.deepEqual(d.deleted, [{ role: "ops", groups: 1, users: 1 }]);
    assert.deepEqual(d.updated, []);
  });

  test("membership is counted, not listed, for create and delete", () => {
    const many = Array.from({ length: 40 }, (_, i) => `local/g${i}`);
    const d = diffRoles([], [role("wide", {}, many)]);
    assert.deepEqual(d.created, [{ role: "wide", groups: 40, users: 0 }]);
  });

  test("a deleted role is reported even when others changed", () => {
    const d = diffRoles(
      [role("a", { showSettings: true }), role("b", {})],
      [role("a", { showSettings: false })]
    );
    assert.deepEqual(d.deleted, [{ role: "b", groups: 0, users: 0 }]);
    assert.equal(d.updated.length, 1);
  });
});

describe("a duplicated role name is never silently collapsed", () => {
  test("the same name twice is reported, not hidden by last-one-wins", () => {
    // the escalation: a second `- name: admin` grants admin to a different group,
    // while a Map keyed on name can only ever describe one of the two entries
    const d = diffRoles(
      [role("public", {}), role("admin", {}, ["local/admins"])],
      [role("public", {}), role("admin", {}, ["local/ops"]), role("admin", {}, ["local/admins"])]
    );
    assert.deepEqual(d.duplicated, ["admin"]);
  });

  test("no duplicates means an empty list, not undefined", () => {
    const d = diffRoles([role("a", {})], [role("a", {}), role("b", {})]);
    assert.deepEqual(d.duplicated, []);
    assert.deepEqual(d.created, [{ role: "b", groups: 0, users: 0 }]);
  });
});

describe("validateConfig rejects a duplicate role name (the escalation itself)", () => {
  test("a second entry for the same role is refused, not merged", async () => {
    // JSON Schema cannot express "unique by property", so ajv accepted this. The server
    // applies EVERY matching role entry, so a second `- name: admin` with different
    // groups granted admin to those groups while every by-name view showed one role.
    const Form = (await import("../src/models/form.model.js")).default;
    const cfg = (roles) => ({ categories: [{ name: "Default", icon: "bars" }], roles, constants: {} });
    assert.throws(
      () => Form.validateConfig(cfg([
        { name: "public", groups: [] },
        { name: "admin", groups: ["local/ops"] },
        { name: "admin", groups: ["local/admins"] },
      ])),
      /Duplicate role name/
    );
    // and a legitimate config still passes
    assert.doesNotThrow(() => Form.validateConfig(cfg([
      { name: "public", groups: [] },
      { name: "admin", groups: ["local/admins"] },
      { name: "ops", groups: ["local/ops"] },
    ])));
  });
});


// The duplicate-role check is a privilege escalation guard, not a tidiness rule:
// getRolesAndOptions applies EVERY matching entry, so a second `- name: admin` grants
// admin to that entry's groups while every UI keys roles by name and shows one.
// It lived in validateConfig only - Form.save (the designer, and /config/check) goes
// through Form.validate, which had no check, so the designer could write a config the
// next Form.load then refused, 500ing every config endpoint.
// Form.validate compiles the forms schema, which a bare roles object does not satisfy -
// so for the positive case assert only that it does not complain about DUPLICATES.
function assertRolesOk(Form, cfg) {
  try { Form.validate(cfg); } catch (e) {
    if (/Duplicate role name/.test(e.message)) throw e;
  }
}

describe("both validators reject duplicate role names", () => {
  // schema-valid on purpose : validateConfig runs ajv FIRST, so an invalid fixture would
  // fail on the schema and never reach the duplicate check this test is about
  const base = () => ({
    // the schema requires this exact category to be present
    categories: [{ name: "Default", icon: "bars" }],
    constants: {},
    roles: [{ name: "admin", groups: ["local/admins"] }, { name: "public", groups: [] }],
  });
  const dup = () => {
    const c = base();
    c.roles.splice(1, 0, { name: "admin", groups: ["ldap/other"] });
    return c;
  };

  test("Form.validateConfig rejects them", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.throws(() => Form.validateConfig(dup()), /Duplicate role name/);
  });

  // THE regression : this is the designer's path
  test("Form.validate rejects them too", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.throws(() => Form.validate(dup()), /Duplicate role name/);
  });

  test("a config with unique role names passes both", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.doesNotThrow(() => Form.validateConfig(base()));
    // Form.validate applies the FORMS schema, so it is only asked about the roles here
    assert.doesNotThrow(() => assertRolesOk(Form, base()));
  });
});

// The admin and public roles cannot be deleted : the server derives admin rights from the role
// NAMED admin, and the schema requires public. The roles page greys them out, but the config
// can be written from the designer, the API or a posted YAML, so the SAVES refuse it. The LOAD
// does not, so an install whose config already lacks one keeps starting and can be repaired.
describe("the admin and public roles are kept by every save", () => {
  const config = (names) => ({
    categories: [{ name: "Default", icon: "bars" }],
    constants: {},
    roles: names.map((name) => ({ name, groups: name === "public" ? [] : ["local/admins"] })),
  });

  test("assertRequiredRoles refuses a config without admin, or without public", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.throws(() => Form.assertRequiredRoles(config(["public", "ops"])), /admin cannot be deleted/);
    assert.throws(() => Form.assertRequiredRoles(config(["admin", "ops"])), /public cannot be deleted/);
    assert.doesNotThrow(() => Form.assertRequiredRoles(config(["admin", "public", "ops"])));
  });

  test("a save that sends no roles at all is not refused for them", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.doesNotThrow(() => Form.assertRequiredRoles({ categories: [] }));
  });

  test("the designer's save (Form.validate) refuses it", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.throws(() => Form.validate({ ...config(["public"]), forms: [] }), /admin cannot be deleted/);
  });

  test("the load (Form.validateConfig) still accepts a config without admin", async () => {
    const Form = (await import("../src/models/form.model.js")).default;
    assert.doesNotThrow(() => Form.validateConfig(config(["public", "ops"])));
  });
});
