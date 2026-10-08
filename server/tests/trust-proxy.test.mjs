// TRUST_PROXY decides which address req.ip - and so every audit row - names.
//
// Without express 'trust proxy' req.ip is the TCP peer, so behind a reverse proxy the audit
// trail recorded the proxy for every action. Turning it on unconditionally is the opposite
// mistake: X-Forwarded-For is a header any client can send, so the client would pick the
// address the trail records. These tests pin both halves against a REAL express app and a
// real socket, because what matters is what req.ip answers, not what a setting holds:
//
//  - unset, the forwarded header is ignored (no spoofing by default) ;
//  - set, the client address comes through, and only the hops the operator trusts are
//    skipped - an address a client prepends to the header itself is never taken ;
//  - an invalid value falls back to trusting nothing, rather than failing open ;
//  - the settings page can change it on the running app, and it holds when index.js mounts
//    the app under a BASE_URL ;
//  - app.js actually applies it - the setting is silent when it is not wired in.
import { describe, test, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const { parseTrustProxy, compileTrustProxy, applyTrustProxy } = await import("../src/lib/trustProxy.js");

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = "203.0.113.7";

// an app answering with the req.ip it sees, optionally mounted under a parent app the way
// index.js does for BASE_URL
function ipApp() {
  const app = express();
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  return app;
}

// one request over a real socket from 127.0.0.1, with the given X-Forwarded-For
async function ipSeen(app, xff, url = "/ip") {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const headers = xff ? { "X-Forwarded-For": xff } : {};
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { headers });
    return (await res.json()).ip;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const original = process.env.TRUST_PROXY;
afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

describe("parseTrustProxy", () => {
  test.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["OFF", false],
    ["true", true],
    ["1", 1],
    [" 2 ", 2],
    ["loopback", ["loopback"]],
    ["10.0.0.5, 172.16.0.0/12,", ["10.0.0.5", "172.16.0.0/12"]],
  ])("%j -> %j", (raw, expected) => {
    expect(parseTrustProxy(raw)).toEqual(expected);
  });

  test("an address express cannot parse is refused", () => {
    expect(() => compileTrustProxy("10.0.0.300")).toThrow();
    expect(() => compileTrustProxy("not-an-address")).toThrow();
  });

  test("the legacy shapes ipaddr.js would read as an address are refused too", () => {
    // '1, 10.0.0.5' used to trust 0.0.0.1 and 10.0.0.5 without a word
    for (const raw of ["1, 10.0.0.5", "2,3", "0x1", "10.1", "10.1/8"]) {
      expect(() => compileTrustProxy(raw), raw).toThrow(/invalid IP address/);
    }
    expect(compileTrustProxy("::ffff:10.0.0.1, fe80::/10, 10.0.0.0/255.0.0.0, uniquelocal")).toHaveLength(4);
  });
});

describe("the address req.ip reports", () => {
  test("unset : the forwarded header is ignored, so a client cannot choose its address", async () => {
    delete process.env.TRUST_PROXY;
    const app = ipApp();
    expect(applyTrustProxy(app)).toBe(true);
    const ip = await ipSeen(app, CLIENT);
    expect(ip).not.toBe(CLIENT);
    expect(ip).toMatch(/127\.0\.0\.1$/);
  });

  test("one trusted hop : the client behind the proxy is recorded", async () => {
    process.env.TRUST_PROXY = "1";
    const app = ipApp();
    applyTrustProxy(app);
    expect(await ipSeen(app, CLIENT)).toBe(CLIENT);
  });

  test("one trusted hop : an address the client prepends itself is not taken", async () => {
    // the client sent 'X-Forwarded-For: 6.6.6.6', the proxy appended the real peer
    process.env.TRUST_PROXY = "1";
    const app = ipApp();
    applyTrustProxy(app);
    expect(await ipSeen(app, `6.6.6.6, ${CLIENT}`)).toBe(CLIENT);
  });

  test("a list : only a peer in it is believed", async () => {
    process.env.TRUST_PROXY = "loopback";
    const trusted = ipApp();
    applyTrustProxy(trusted);
    expect(await ipSeen(trusted, CLIENT)).toBe(CLIENT);

    // the request comes from 127.0.0.1, which is not in 10.0.0.0/8
    process.env.TRUST_PROXY = "10.0.0.0/8";
    const untrusted = ipApp();
    applyTrustProxy(untrusted);
    expect(await ipSeen(untrusted, CLIENT)).toMatch(/127\.0\.0\.1$/);
  });

  test("an invalid value trusts nothing rather than failing open", async () => {
    process.env.TRUST_PROXY = "10.0.0.300";
    const app = ipApp();
    expect(applyTrustProxy(app)).toBe(false);
    expect(await ipSeen(app, CLIENT)).toMatch(/127\.0\.0\.1$/);
  });

  test("re-applied without an app, a changed value reaches the registered one", async () => {
    delete process.env.TRUST_PROXY;
    const app = ipApp();
    applyTrustProxy(app);
    expect(await ipSeen(app, CLIENT)).not.toBe(CLIENT);
    process.env.TRUST_PROXY = "1";
    expect(applyTrustProxy()).toBe(true);
    expect(await ipSeen(app, CLIENT)).toBe(CLIENT);
  });

  test("it holds when the app is mounted under a BASE_URL", async () => {
    process.env.TRUST_PROXY = "1";
    const app = ipApp();
    applyTrustProxy(app);
    const root = express();
    root.use("/ansibleforms", app);
    expect(await ipSeen(root, CLIENT, "/ansibleforms/ip")).toBe(CLIENT);
  });
});

describe("wiring", () => {
  test("app.js applies TRUST_PROXY to the app", () => {
    const src = readFileSync(path.join(serverRoot, "src/app.js"), "utf8");
    expect(src).toMatch(/applyTrustProxy\(app\)/);
  });

  test("the settings page applies it live and refuses an invalid value", async () => {
    const Env = (await import("../src/lib/envSettings.js")).default;
    expect(Env.classify("TRUST_PROXY")).toBe("live");
    expect(Env.validate("TRUST_PROXY", "10.0.0.300", { type: "string" })).toMatch(/TRUST_PROXY/);
    expect(Env.validate("TRUST_PROXY", "10.0.0.0/8, loopback", { type: "string" })).toBeNull();
    expect(Env.validate("TRUST_PROXY", "1", { type: "string" })).toBeNull();
  });

  test("help.yaml documents it", () => {
    const help = readFileSync(path.join(serverRoot, "help.yaml"), "utf8");
    expect(help).toMatch(/- name: TRUST_PROXY\n/);
  });
});
