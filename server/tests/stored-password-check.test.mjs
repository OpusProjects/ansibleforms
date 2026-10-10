// A connection check with the masked password tests with the stored one : only against the
// stored server, never against one the request names (it would receive the password).
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const storedLdap = { server: "ldap.corp", port: 636, enable_tls: 1, ignore_certs: 0, cert: "", ca_bundle: "", bind_user_dn: "cn=svc", bind_user_pw: "Bind-Secret" };
let ldapChecked = null;
vi.mock("../src/models/ldap.model.js", () => {
  function Ldap(cfg) { Object.assign(this, cfg); }
  Ldap.find = async () => ({ ...storedLdap });
  Ldap.check = async (cfg) => { ldapChecked = cfg; return "ok"; };
  return { default: Ldap };
});

const storedSettings = { mail_server: "smtp.corp", mail_port: 587, mail_secure: 0, mail_username: "svc", mail_password: "Mail-Secret" };
let mailChecked = null;
vi.mock("../src/models/settings.model.js", () => {
  function Settings(cfg) { Object.assign(this, cfg); }
  Settings.find = async () => ({ ...storedSettings });
  Settings.mailcheck = async (cfg) => { mailChecked = cfg; return "id-1"; };
  return { default: Settings };
});

const ldapController = (await import("../src/controllers/v2/ldap.controller.js")).default;
const settingsController = (await import("../src/controllers/v2/settings.controller.js")).default;

function call(handler, body) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return handler({ body, headers: {} }, res).then(() => res);
}

beforeEach(() => { ldapChecked = null; mailChecked = null; });

describe("/ldap/check with the masked bind password", () => {
  const masked = { ...storedLdap, bind_user_pw: "**********" };

  test("checks the stored server with the stored password, a port as text and a flag as true count the same", async () => {
    const res = await call(ldapController.check, { ...masked, port: "636", enable_tls: true });
    expect(res.statusCode).toBe(200);
    expect(ldapChecked.bind_user_pw).toBe("Bind-Secret");
  });

  test.each([["server", "evil.example.com"], ["port", 389], ["enable_tls", 0], ["ignore_certs", 1], ["ca_bundle", "-----BEGIN-----"]])(
    "another %s never receives the stored password", async (field, value) => {
      const res = await call(ldapController.check, { ...masked, [field]: value });
      expect(res.statusCode).toBe(400);
      expect(ldapChecked).toBe(null);
    });

  test("a typed password checks any server", async () => {
    const res = await call(ldapController.check, { ...masked, server: "other.corp", bind_user_pw: "typed" });
    expect(res.statusCode).toBe(200);
    expect(ldapChecked.bind_user_pw).toBe("typed");
  });
});

describe("/settings/mailcheck with the masked mail password", () => {
  const masked = { ...storedSettings, mail_password: "**********", to: "a@b.c" };

  test("tests the stored server with the stored password", async () => {
    const res = await call(settingsController.mailcheck, { ...masked });
    expect(res.statusCode).toBe(200);
    expect(mailChecked.mail_password).toBe("Mail-Secret");
  });

  test.each([["mail_server", "evil.example.com"], ["mail_port", 25], ["mail_secure", true]])(
    "another %s never receives the stored password", async (field, value) => {
      const res = await call(settingsController.mailcheck, { ...masked, [field]: value });
      expect(res.statusCode).toBe(400);
      expect(mailChecked).toBe(null);
    });
});
