// Every server locale defines the keys en.js defines, and no other. i18n.t falls back to
// English, so a missing key never shows as an error : five languages answered "Runner added"
// in English for a release before anybody noticed. This makes it a red test instead.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/locales");
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));

const en = new Set(flat((await import(path.join(dir, "en.js"))).default));
const others = readdirSync(dir).filter((f) => /^[a-z]{2}\.js$/.test(f) && f !== "en.js");

describe("the server locales", () => {
  test("there are other languages to compare", () => {
    assert.ok(others.length >= 5);
  });
  for (const file of others) {
    test(`${file} has exactly the keys of en.js`, async () => {
      const keys = new Set(flat((await import(path.join(dir, file))).default));
      assert.deepEqual([...en].filter((k) => !keys.has(k)), [], "missing");
      assert.deepEqual([...keys].filter((k) => !en.has(k)), [], "not in en.js");
    });
  }
});
