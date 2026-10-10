// The Content-Security-Policy of the web app (lib/csp.js) : scripts from the app only, no framing
// by another site - with what the app itself needs.
import { describe, test, expect } from "vitest";
import { cspDirectives } from "../src/lib/csp.js";

describe("the Content-Security-Policy", () => {
  const d = cspDirectives();

  test("no inline script, no script from elsewhere, no inline handler", () => {
    expect(d.scriptSrc).not.toContain("'unsafe-inline'");
    expect(d.scriptSrc.filter((s) => !s.startsWith("'"))).toEqual([]);
    expect(d.scriptSrcAttr).toEqual(["'none'"]);
  });

  test("no framing by another site, no plugins, no base tag elsewhere", () => {
    expect(d.frameAncestors).toEqual(["'self'"]);
    expect(d.objectSrc).toEqual(["'none'"]);
    expect(d.baseUri).toEqual(["'self'"]);
  });

  test("the api is the only place the app talks to", () => {
    expect(d.connectSrc).toEqual(["'self'"]);
    expect(d.formAction).toEqual(["'self'"]);
  });

  test("what the app needs : local expressions (eval), inline styles, images from any url", () => {
    expect(d.scriptSrc).toContain("'unsafe-eval'");
    expect(d.styleSrc).toContain("'unsafe-inline'");
    expect(d.imgSrc).toEqual(expect.arrayContaining(["https:", "data:"]));
  });
});
