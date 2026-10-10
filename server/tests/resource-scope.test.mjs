// What a user may use, by role : credentials, secret stores and runners (lib/resourceScope.js).
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// the credentials table : a REGEXP lookup finds the first row whose name matches
const rows = [{ name: "vcenter", user: "svc", password: "" }, { name: "cmdb-prod", user: "db", password: "" }, { name: "prod-root", user: "root", password: "" }];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/FROM AnsibleForms.`credentials` WHERE name REGEXP/.test(sql)) {
        const re = new RegExp(String(Array.isArray(params) ? params[0] : params));
        return rows.filter((r) => re.test(r.name)).slice(0, 1).map((r) => ({ ...r }));
      }
      return [];
    },
  },
}));

// the configuration's roles
let configRoles = [];
vi.mock("../src/models/form.model.js", () => ({
  default: { load: async () => ({ roles: configRoles, forms: [] }) },
}));

// the runners : by name, and the default rte
vi.mock("../src/models/runner.model.js", () => ({
  default: {
    findByName: async (name) => ({ name, type: name.startsWith("awx") ? "awx" : "rte" }),
    findDefault: async () => ({ name: "rte-default", type: "rte" }),
  },
}));

const { scopeFromRoles, runWithScope, currentScope } = await import("../src/lib/resourceScope.js");
const { default: Credential } = await import("../src/models/credential.model.v2.js");
const { assertLaunchScope } = await import("../src/models/job.model.js");
const { default: Middleware } = await import("../src/lib/middleware.js");

const ops = { username: "bob", roles: ["public", "ops"] };
beforeEach(() => {
  configRoles = [
    { name: "public", groups: [] },
    { name: "ops", groups: [], credentials: ["vcenter", "cmdb-.*"], runners: ["rte-default"] },
    { name: "dba", groups: [], credentials: ["prod-.*"] },
  ];
});

describe("the scope of a user", () => {
  test("nothing listed : no limit, as before", () => {
    expect(scopeFromRoles({ roles: ["public"] }, configRoles)).toBe(null);
  });

  test("the admin role is never limited", () => {
    expect(scopeFromRoles({ roles: ["admin", "ops"] }, configRoles)).toBe(null);
  });

  test("the roles that list a kind are combined, the ones that do not add nothing", () => {
    const scope = scopeFromRoles({ roles: ["public", "ops", "dba"] }, configRoles);
    expect(scope.credentials.some((re) => re.test("prod-root"))).toBe(true);
    expect(scope.credentials.some((re) => re.test("vcenter"))).toBe(true);
    expect(scope.secretStores).toBe(null);
    expect([...scope.runners]).toEqual(["rte-default"]);
  });

  test("a pattern matches the whole name", () => {
    const scope = scopeFromRoles(ops, configRoles);
    expect(scope.credentials.some((re) => re.test("vcenter-old"))).toBe(false);
  });
});

describe("resolving a credential inside a scope", () => {
  const scope = () => scopeFromRoles(ops, configRoles);

  test("an allowed credential resolves", async () => {
    const c = await runWithScope(scope(), () => Credential.resolveCredential("vcenter"));
    expect(c.name).toBe("vcenter");
  });

  test("a pattern is judged by the name it finds", async () => {
    await expect(runWithScope(scope(), () => Credential.resolveCredential("prod-.*"))).rejects.toThrow(/do not allow the credential 'prod-root'/);
    await expect(runWithScope(scope(), () => Credential.resolveCredential(".*root"))).rejects.toThrow(/prod-root/);
  });

  test("fnCredentials (findByName) is limited too", async () => {
    await expect(runWithScope(scope(), () => Credential.findByName("prod-root"))).rejects.toThrow(/do not allow/);
  });

  test("an inline secret is no way around the credential patterns", async () => {
    await expect(runWithScope(scope(), () => Credential.resolveCredential("secret:vault:prod/root"))).rejects.toThrow(/do not allow the credential/);
    await expect(runWithScope(scope(), () => Credential.resolveCredential("vault:prod/root"))).rejects.toThrow(/do not allow/);
  });

  test("with stores listed, an inline secret needs its store", async () => {
    configRoles[1].secretStores = ["cyberark"];
    await expect(runWithScope(scope(), () => Credential.resolveCredential("secret:vault:x"))).rejects.toThrow(/secret store 'vault'/);
  });

  test("the app's own database (__self__) is a credential like the others", async () => {
    const map = await runWithScope(scope(), () => Credential.resolveCredentialMap({ db: "__self__" }));
    expect(map).toEqual({});
  });

  test("outside a scope nothing is limited", async () => {
    expect(currentScope()).toBe(null);
    const c = await Credential.resolveCredential("prod-root");
    expect(c.name).toBe("prod-root");
  });
});

describe("a launch", () => {
  test("refused when it passes a credential the roles do not allow", async () => {
    await expect(assertLaunchScope(ops, "ansible", { __credentials__: { db: "prod-root" } }, {})).rejects.toThrow(/prod-root/);
    await expect(assertLaunchScope(ops, "ansible", { __ansibleCredentials__: "prod-.*" }, {})).rejects.toThrow(/prod-root/);
    await expect(assertLaunchScope(ops, "ansible", {}, { db: "cmdb-prod,vcenter" })).resolves.toBeUndefined();
  });

  test("refused on a runner the roles do not allow", async () => {
    await expect(assertLaunchScope(ops, "ansible", { __runner__: "rte-secure" }, {})).rejects.toThrow(/runner 'rte-secure'/);
    await expect(assertLaunchScope(ops, "ansible", {}, {})).resolves.toBeUndefined();
  });

  test("an admin, or a user nothing limits, launches as before", async () => {
    await expect(assertLaunchScope({ roles: ["admin"] }, "ansible", { __credentials__: { db: "prod-root" }, __runner__: "x" }, {})).resolves.toBeUndefined();
    await expect(assertLaunchScope({ roles: ["public"] }, "ansible", { __credentials__: { db: "prod-root" } }, {})).resolves.toBeUndefined();
  });
});

describe("the request scope", () => {
  test("the signed-in user's scope holds for the rest of the request", async () => {
    let seen;
    await Middleware.resourceScope({ user: { user: ops } }, {}, () => { seen = currentScope(); });
    expect(seen.user).toBe("bob");
    expect(currentScope()).toBe(null);
  });
});
