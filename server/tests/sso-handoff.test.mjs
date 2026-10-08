// #542 : the Azure AD login failed because the handoff token was signed from the decoded
// Azure access token, whose exp / iss made jsonwebtoken refuse the expiresIn / issuer
// options - and the sign sat outside the try, so the browser was never redirected.
import { describe, test, expect, vi } from "vitest";
import jwt from "jsonwebtoken";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

const { signHandoff, sealToken, openToken } = await import("../src/lib/ssoHandoff.js");
const authConfig = (await import("../config/auth.config.js")).default;

// an Azure access token as passport hands it over : signed by Microsoft, not by us
const now = Math.floor(Date.now() / 1000);
const azureToken = jwt.sign({
  aud: "00000003-0000-0000-c000-000000000000",
  iss: "https://sts.windows.net/tenant-id/",
  iat: now - 3000, nbf: now - 3000, exp: now + 600,
  upn: "alice@example.com", name: "Alice", oid: "1234", groups: ["g1"],
}, "microsofts-own-key");

describe("signHandoff", () => {
  test("signs the claims of an Azure token that carries exp, iat, nbf and iss", () => {
    const token = signHandoff(azureToken, "azuread");
    const claims = jwt.verify(token, authConfig.secret, { issuer: authConfig.jwtIssuer });
    expect(claims).toMatchObject({ sso: "azuread", upn: "alice@example.com", name: "Alice", oid: "1234" });
    // the access token travels sealed - never in the clear - and the bulky claims stay out
    expect(claims.groups).toBeUndefined();
    expect(claims.aud).toBeUndefined();
    expect(token).not.toContain(azureToken.split(".")[2]);
    expect(openToken(claims.at)).toBe(azureToken);
    // its own lifetime, from now - not the provider's
    expect(claims.iat).toBeGreaterThanOrEqual(now);
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims.nbf).toBeUndefined();
  });

  test("a sealed token cannot be opened when tampered with", () => {
    const sealed = sealToken("secret-access-token");
    expect(openToken(sealed)).toBe("secret-access-token");
    const bytes = Buffer.from(sealed, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(() => openToken(bytes.toString("base64url"))).toThrow();
    expect(() => openToken("")).toThrow();
  });

  test("an oidc profile object works as before", () => {
    const claims = jwt.verify(signHandoff({ sub: "abc", email: "bob@example.com" }, "oidc"), authConfig.secret, { issuer: authConfig.jwtIssuer });
    expect(claims).toMatchObject({ sso: "oidc", sub: "abc", email: "bob@example.com" });
  });

  test("the caller's object is not changed", () => {
    const profile = { sub: "abc", exp: now + 10, iss: "x" };
    signHandoff(profile, "oidc");
    expect(profile).toEqual({ sub: "abc", exp: now + 10, iss: "x" });
  });
});

describe("the callback of the login controller", () => {
  for (const version of ["v2"]) {
    test(`${version} : redirects with a handoff token, and hands errors to next instead of hanging`, async () => {
      const src = await import("fs").then((fs) => fs.readFileSync(new URL(`../src/controllers/${version}/login.controller.js`, import.meta.url), "utf8"));
      const fn = src.slice(src.indexOf("const authCallback"), src.indexOf("};\n", src.indexOf("const authCallback")));
      // the sign happens inside the try, after the error check
      expect(fn.indexOf("signHandoff(")).toBeGreaterThan(fn.indexOf("try {"));
      expect(fn.indexOf("signHandoff(")).toBeGreaterThan(fn.indexOf("if (err)"));
      expect(fn).not.toMatch(/jwt\.sign\(/);
    });
  }
});
