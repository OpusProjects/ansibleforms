// The API shows every secret masked. A client that edits a record and sends the mask back
// unchanged means "keep it" : the mask must never be stored as the secret itself.
import { describe, test, expect, vi } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      queries.push({ sql, vars });
      if (/^SELECT/i.test(sql)) return [{ id: 1, username: "bob", managed: 0 }];
      return { affectedRows: 1, changedRows: 1 };
    },
  },
}));

const appConfig = (await import("./__mocks__/app.config.js")).default;
appConfig.encryptionSecret ||= "0123456789abcdef0123456789abcdef";
const { default: CrudModel } = await import("../src/models/crud.model.js");
const { default: User } = await import("../src/models/user.model.js");

describe("a masked secret sent back on an update", () => {
  test.each([["credential", "password"], ["credential", "client_key"], ["oauth2", "client_secret"], ["repositories", "password"], ["runner", "token"], ["secretstore", "token"], ["ldap", "bind_user_pw"]])(
    "%s.%s keeps its stored value", (model, field) => {
      expect(CrudModel.getFieldValues(model, { [field]: "**********" }, true)).not.toHaveProperty(field);
      expect(CrudModel.getFieldValues(model, { [field]: "********" }, true)).not.toHaveProperty(field);
    });

  test("a real new secret is still written, encrypted", () => {
    const out = CrudModel.getFieldValues("credential", { password: "N3w-pass" }, true);
    expect(out.password).toBeDefined();
    expect(out.password).not.toBe("N3w-pass");
  });

  test("a field that is not a secret is written as sent", () => {
    expect(CrudModel.getFieldValues("credential", { user: "**********" }, true).user).toBe("**********");
  });

  test("a user's masked password is not hashed into a new one", async () => {
    queries.length = 0;
    await User.update({ password: "**********", email: "bob@example.com" }, 1);
    const update = queries.find((q) => /^UPDATE/i.test(q.sql));
    expect(update.vars[0]).not.toHaveProperty("password");
    expect(update.vars[0].email).toBe("bob@example.com");
  });
});
