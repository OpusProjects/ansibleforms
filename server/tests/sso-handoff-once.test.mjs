// The SSO handoff is taken once : a replayed one (a browser history, a shared link) is refused.
import { describe, test, expect, vi } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// token_revocations : the primary key refuses a second insert of a key
const keys = new Set();
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/^INSERT INTO AnsibleForms.`token_revocations` \(`key`, expires_at\) VALUES/.test(sql)) {
        if (keys.has(params[0])) throw Object.assign(new Error(`Duplicate entry '${params[0]}' for key 'PRIMARY'`), { code: "ER_DUP_ENTRY" });
        keys.add(params[0]);
        return { affectedRows: 1 };
      }
      return [];
    },
    tryDo: async () => [],
  },
}));
const provider = { enable: 1, groupfilter: "" };
vi.mock("../src/models/oidc.model.js", () => ({ default: { isEnabled: async () => provider, find: async () => provider } }));
vi.mock("../src/models/user.model.js", () => ({ default: { getRolesAndOptions: async (groups) => ({ roles: groups, options: { allowLogin: true } }) } }));
vi.mock("../src/models/audit.model.js", () => ({ default: { log: async () => {} } }));

const { signHandoff } = await import("../src/lib/ssoHandoff.js");
const controller = (await import("../src/controllers/v2/login.controller.js")).default;

const res = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

describe("an SSO handoff", () => {
  test("logs in once, and is refused the second time", async () => {
    const handoff = signHandoff({ preferred_username: "alice", groups: [] }, "oidc");
    const first = res();
    await controller.oidcLogin({ body: { token: handoff }, headers: {}, ip: "127.0.0.1" }, first);
    expect(first.statusCode).toBe(200);
    const again = res();
    await controller.oidcLogin({ body: { token: handoff }, headers: {}, ip: "127.0.0.1" }, again);
    expect(again.statusCode).toBe(401);
    expect(JSON.stringify(again.body)).toMatch(/used already/);
  });

  test("two handoffs of the same user are two logins", async () => {
    for (let i = 0; i < 2; i++) {
      const r = res();
      await controller.oidcLogin({ body: { token: signHandoff({ preferred_username: "bob", groups: [] }, "oidc") }, headers: {}, ip: "127.0.0.1" }, r);
      expect(r.statusCode).toBe(200);
    }
  });
});
