// Live TLS certificate reload (lib/httpsContext.js).
//
// The settings page can point HTTPS_KEY / HTTPS_CERT at renewed files and the process
// replaces its secure context instead of restarting. The failure modes here are all quiet,
// and the dangerous one is the opposite of the usual: this code runs on the path that keeps
// the server able to accept TLS connections at all, so a bad or missing file must leave the
// PREVIOUS context in place rather than tearing it down. Returning false and logging is the
// whole contract - there is no state to half-apply.
//
// Pinned here, none of which fails loudly on its own:
//  - http mode registers nothing, so applying reports false instead of throwing on null
//  - an object with no setSecureContext (the plain http.Server) must not register
//  - an unreadable key or cert must not reach setSecureContext
//  - a throw from setSecureContext is caught, so a malformed pair cannot kill the process
//  - index.js registers ONLY in the https branch, and envSettings actually calls the applier
import { test, describe, beforeEach, afterAll, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// httpsContext.js imports './logger.js'. That specifier is NOT one of the three aliased in
// vitest.config.js, so it resolves to the real module - and a vi.mock of the same file
// therefore does intercept it (the alias caveat applies only where the alias points the
// source at a different file than the test mocks).
const logged = vi.hoisted(() => ({ warning: [], notice: [] }));
vi.mock("../src/lib/logger.js", () => ({
  default: {
    warning: (m) => logged.warning.push(m),
    notice: (m) => logged.notice.push(m),
    error: () => {}, info: () => {}, debug: () => {},
  },
}));

const { registerHttpsServer, applySecureContext } = await import("../src/lib/httpsContext.js");

const tmp = mkdtempSync(path.join(os.tmpdir(), "af-tls-"));
const keyPath = path.join(tmp, "key.pem");
const certPath = path.join(tmp, "cert.pem");
writeFileSync(keyPath, "KEY-ONE");
writeFileSync(certPath, "CERT-ONE");

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A stand-in https.Server : records what it was given, and can be told to reject it. */
function fakeServer() {
  return {
    applied: [],
    throwOnce: false,
    setSecureContext(ctx) {
      if (this.throwOnce) { this.throwOnce = false; throw new Error("bad key/cert pair"); }
      this.applied.push({ key: String(ctx.key), cert: String(ctx.cert) });
    },
  };
}

describe("registering the server", () => {
  beforeEach(() => {
    logged.warning.length = 0;
    logged.notice.length = 0;
    process.env.HTTPS_KEY = keyPath;
    process.env.HTTPS_CERT = certPath;
  });

  test("an https server registers", () => {
    expect(registerHttpsServer(fakeServer())).toBe(true);
  });

  test("a plain http.Server does not register, so http mode cannot half-enable reload", () => {
    // http.Server has no setSecureContext - registering it would make applySecureContext
    // report success while doing nothing
    expect(registerHttpsServer({ listen() {} })).toBe(false);
    expect(registerHttpsServer(null)).toBe(false);
    expect(registerHttpsServer(undefined)).toBe(false);
  });

  test("in http mode applying reports false instead of throwing", () => {
    registerHttpsServer(null);
    expect(() => applySecureContext()).not.toThrow();
    expect(applySecureContext()).toBe(false);
  });
});

describe("applying a renewed certificate", () => {
  let server;
  beforeEach(() => {
    logged.warning.length = 0;
    logged.notice.length = 0;
    server = fakeServer();
    registerHttpsServer(server);
    process.env.HTTPS_KEY = keyPath;
    process.env.HTTPS_CERT = certPath;
    writeFileSync(keyPath, "KEY-ONE");
    writeFileSync(certPath, "CERT-ONE");
  });

  test("the files are re-read at apply time, so a renewal in place is picked up", () => {
    expect(applySecureContext()).toBe(true);
    expect(server.applied.at(-1)).toEqual({ key: "KEY-ONE", cert: "CERT-ONE" });

    // certbot rewrites the same paths
    writeFileSync(keyPath, "KEY-TWO");
    writeFileSync(certPath, "CERT-TWO");
    expect(applySecureContext()).toBe(true);
    expect(server.applied.at(-1)).toEqual({ key: "KEY-TWO", cert: "CERT-TWO" });
  });

  test("a missing file leaves the running context alone", () => {
    expect(applySecureContext()).toBe(true);
    const before = server.applied.length;

    process.env.HTTPS_CERT = path.join(tmp, "does-not-exist.pem");
    expect(applySecureContext()).toBe(false);
    // the point of the test : setSecureContext was never reached
    expect(server.applied.length).toBe(before);
    expect(logged.warning.join(" ")).toMatch(/keeping the current one/i);
  });

  test("an unreadable file is treated the same way as a missing one", () => {
    const secret = path.join(tmp, "locked.pem");
    writeFileSync(secret, "KEY");
    chmodSync(secret, 0o000);
    process.env.HTTPS_KEY = secret;
    const before = server.applied.length;
    // running as root defeats the permission bit ; skip rather than assert a false pass
    let readable = true;
    try { readFileSync(secret); } catch { readable = false; }
    if (readable) return;
    expect(applySecureContext()).toBe(false);
    expect(server.applied.length).toBe(before);
  });

  test("a rejected key/cert pair is caught, not thrown at the caller", () => {
    server.throwOnce = true;
    expect(() => applySecureContext()).not.toThrow();
    server.throwOnce = true;
    expect(applySecureContext()).toBe(false);
    expect(logged.warning.join(" ")).toMatch(/keeping the current one/i);
  });
});

describe("the wiring that makes it live", () => {
  test("the app start registers the https server, and only in the https branch", () => {
    const src = readFileSync(path.join(serverRoot, "src", "app-start.js"), "utf8");
    expect(src).toMatch(/registerHttpsServer\(/);
    // everything from the https branch to the else must contain the call ; registering the
    // http server would be the bug (setSecureContext does not exist on it)
    const branch = /if\s*\(httpsConfig\.https\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}/.exec(src);
    expect(branch, "could not find the https/http branch in src/app-start.js").toBeTruthy();
    expect(branch[1]).toMatch(/registerHttpsServer\(/);
    expect(branch[2]).not.toMatch(/registerHttpsServer\(/);
  });

  test("HTTPS_KEY and HTTPS_CERT both apply the new context", () => {
    const env = readFileSync(path.join(serverRoot, "src/lib/envSettings.js"), "utf8");
    for (const name of ["HTTPS_KEY", "HTTPS_CERT"]) {
      const line = env.split("\n").find((l) => l.trim().startsWith(`${name}:`));
      expect(line, `${name} must have a LIVE_CUSTOM applier`).toBeTruthy();
      expect(line).toContain("applySecureContext");
    }
  });

  test("HTTPS_KEY stays readable, because it is a path and not the key itself", () => {
    // A redacted variable comes back as the mask string and the client leaves its box
    // empty, so sweeping HTTPS_KEY in would make the path uneditable for no benefit - it
    // names a file, it is not the key. Read the REAL pattern rather than restating it.
    const src = readFileSync(path.join(serverRoot, "src/controllers/v2/config.controller.js"), "utf8");
    const m = /const SECRET_ENV_NAME\s*=\s*\/(.+?)\/([gimsuy]*)\s*;/.exec(src);
    expect(m, "SECRET_ENV_NAME moved - this test is pinning nothing").toBeTruthy();
    const pattern = new RegExp(m[1], m[2]);
    expect(pattern.test("HTTPS_KEY"), "HTTPS_KEY must stay visible").toBe(false);
    expect(pattern.test("HTTPS_CERT"), "HTTPS_CERT must stay visible").toBe(false);
    // and the pattern must still be doing its job
    expect(pattern.test("DB_PASSWORD")).toBe(true);
    expect(pattern.test("ENCRYPTION_SECRET")).toBe(true);
    expect(pattern.test("VAULT_TOKEN")).toBe(true);
    // a bare TOKEN would also hide these, which are not secrets
    expect(pattern.test("ACCESS_TOKEN_EXPIRATION")).toBe(false);
    expect(pattern.test("ACCESS_TOKEN_ISSUER")).toBe(false);
  });
});
