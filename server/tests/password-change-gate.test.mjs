// A user who signs in with the public default password (DEFAULT_ADMIN_PASSWORD) may only change
// it : everything else answers 403 password_change_required (Middleware.passwordChangeGate).
import { describe, test, expect } from "vitest";

const { default: Middleware } = await import("../src/lib/middleware.js");

function gate(user, baseUrl, originalUrl = baseUrl) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Middleware.passwordChangeGate({ user: { user }, baseUrl, originalUrl, headers: {} }, res, () => resolve({ status: "next" }));
  });
}

describe("the default password gate", () => {
  const marked = { username: "admin", roles: ["admin"], mustChangePassword: true };

  test("everything is refused with its code", async () => {
    for (const url of ["/api/v2/job", "/api/v2/user", "/api/v2/config", "/api/v2/settings"]) {
      const r = await gate(marked, url);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("password_change_required");
    }
  });

  test("but the profile, where the password is changed", async () => {
    expect((await gate(marked, "/api/v2/profile")).status).toBe("next");
  });

  test("a user with another password is not touched", async () => {
    expect((await gate({ username: "admin", roles: ["admin"] }, "/api/v2/job")).status).toBe("next");
  });
});
