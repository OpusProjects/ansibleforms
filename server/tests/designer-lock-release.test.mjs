// The designer lock is exclusive and survives restarts (it is a file, persistent/
// ansibleForms.lock), so a request that claims it and does not hand it back makes every
// later config save, import and export answer 423 until somebody unlocks it by hand.
//
// restore() got this right - it tracks whether THIS request took the lock and releases it
// in a finally. save() did not: it claimed the lock whenever it was free and never
// released it, and its empty-body check returned 400 after the claim, so even a malformed
// request stranded it.
//
// Only lock.free may be released. lock.match means the designer already held it before the
// call and expects to keep it for the rest of the session.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../src/controllers/v2/config.controller.js"), "utf8");

const slice = (name, next) =>
  src.slice(src.indexOf(`const ${name} = async function`), src.indexOf(`const ${next} =`));

describe.each([
  ["restore", "save"],
  ["save", "validate"],
])("%s hands the lock back", (name, next) => {
  const fn = slice(name, next);

  test("the slice really is the function, so these assertions are not vacuous", () => {
    assert.ok(fn.length > 300, `${name} not found`);
    assert.match(fn, /Lock\.status\(user\)/);
  });

  test("it records whether IT took the lock", () => {
    assert.match(fn, /lockAcquired\s*=\s*true/,
      "releasing unconditionally would steal the lock from an active designer session");
  });

  test("it releases in a finally, so an error cannot strand it", () => {
    const fin = fn.indexOf("finally");
    assert.ok(fin > -1, "the release must not sit on the success path only");
    assert.match(fn.slice(fin), /if\s*\(\s*lockAcquired\s*\)/);
    assert.match(fn.slice(fin), /Lock\.delete\(user, \{ onlyMine: true \}\)/, "only its own lock : never one a designer took meanwhile");
  });

  test("it releases only what it acquired", () => {
    // Lock.delete must be reachable only under the lockAcquired test
    const guard = fn.indexOf("if(lockAcquired)") >= 0 ? fn.indexOf("if(lockAcquired)")
                                                      : fn.indexOf("if (lockAcquired)");
    assert.ok(guard > -1 && guard < fn.indexOf("Lock.delete(user"),
      "an unguarded release would drop a designer's own lock mid-session");
  });
});

describe("save validates the body before taking the lock", () => {
  const fn = slice("save", "validate");

  test("the empty-body check comes first", () => {
    const check = fn.indexOf("Object.keys(req.body).length === 0");
    const claim = fn.indexOf("Lock.set(user)");
    assert.ok(check > -1 && claim > -1);
    assert.ok(check < claim,
      "returning 400 after claiming the lock left it claimed with nothing to release it");
  });
});
