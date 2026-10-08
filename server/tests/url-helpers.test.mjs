import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { stripTrailingSlashes, stripLeadingSlashes, joinUrl } from "../src/lib/url.js";

describe("url helpers", () => {
  test("strip slashes at either end", () => {
    assert.equal(stripTrailingSlashes("https://v:8200///"), "https://v:8200");
    assert.equal(stripTrailingSlashes("https://v:8200"), "https://v:8200");
    assert.equal(stripLeadingSlashes("///secret/app"), "secret/app");
    assert.equal(stripTrailingSlashes(null), "");
    assert.equal(stripLeadingSlashes(undefined), "");
    assert.equal(stripTrailingSlashes("///"), "");
  });

  test("join with exactly one slash", () => {
    assert.equal(joinUrl("https://h/", "/v1/x"), "https://h/v1/x");
    assert.equal(joinUrl("https://h", "v1/x"), "https://h/v1/x");
    assert.equal(joinUrl("https://h//", ""), "https://h");
  });

  // the reason these are loops : a regex like /\/+$/ is polynomial on this input
  test("linear on a long run of slashes", () => {
    const evil = "/".repeat(200000) + "x";
    const t = Date.now();
    assert.equal(stripTrailingSlashes(evil), evil);
    const tail = "x" + "/".repeat(200000);
    assert.equal(stripLeadingSlashes(tail), tail);
    assert.ok(Date.now() - t < 200);
  });
});
