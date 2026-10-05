// Calls to helpers that DO NOT EXIST.
//
// These share a failure mode that ordinary tests do not reach: the call sits on an error
// path or a rarely taken branch, so it is never executed until the day it matters, and
// then it throws a TypeError instead of doing its job. Two have already shipped here:
//
//   - `logger.warn(...)` in a catch block. The logger is built on winston's syslog levels,
//     which have `warning` and no `warn`, so the call turned a handled error into a
//     TypeError that escaped to an outer catch returning [] - and a job became permanently
//     unviewable, as a 200 with an empty body.
//   - `RestResult.success(...)`, which does not exist either. It throws AFTER the work is
//     done, so the change lands and the caller still gets a 500. A test that only checks
//     the side effect calls that a pass.
//
// So this checks the SURFACE rather than the behaviour: every member reached through one
// of these objects has to be one the object actually has. It is a cheap standing check
// over the whole source tree, which is the only way to cover a branch nobody runs.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import winston from "winston";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..");

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules/.test(p)) sourceFiles(p, acc);
    } else if (entry.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}
const FILES = [...sourceFiles(path.join(serverRoot, "src")), ...sourceFiles(path.join(serverRoot, "config"))];
const rel = (f) => path.relative(serverRoot, f);

// every `<object>.<member>` reached in the source, with the files it appears in
function membersUsed(pattern) {
  const found = new Map();
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(pattern)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(rel(file));
    }
  }
  return found;
}

test("found the source tree, so none of this is vacuous", () => {
  assert.ok(FILES.length > 100, `only ${FILES.length} files found`);
  // form.model.js and common.js used to hold a literal NUL byte (a key separator), so GNU
  // grep classified them as binary and printed NOTHING for them - no error, no match. That
  // produced wrong conclusions more than once. The separators are written as "\0" escapes
  // now (the same string at runtime) ; keep it that way, so every source file stays text.
  const withNul = FILES.filter((f) => readFileSync(f, "utf8").includes("\0")).map(rel);
  assert.deepEqual(withNul, [], 'write a NUL as the escape "\\0", never as a raw byte');
  // and the largest model in the tree must still be scanned and readable
  const formModel = FILES.find((f) => f.endsWith("form.model.js"));
  assert.ok(formModel, "form.model.js must be in the scanned set");
  const src = readFileSync(formModel, "utf8");
  assert.match(src, /Errors\./, "and its contents must actually be readable");
});

describe("every Errors.* thrown is a real error class", () => {
  test("no call constructs something that is not there", async () => {
    const Errors = (await import("../src/lib/errors.js")).default;
    const known = new Set(Object.keys(Errors));
    assert.ok(known.size >= 5, "the error module should export several classes");
    const missing = [];
    for (const [member, files] of membersUsed(/\bErrors\.([A-Za-z0-9_]+)/g)) {
      if (!known.has(member)) missing.push(`Errors.${member} (${[...files].join(", ")})`);
    }
    // `new Errors.Nope()` is a TypeError thrown from inside a catch block, which is the
    // worst place for one: it replaces the real failure with a confusing one
    assert.deepEqual(missing, []);
  });
});

describe("every RestResult.* is a real response shape", () => {
  test("no controller calls one that does not exist", async () => {
    const v2 = (await import("../src/models/restResult.model.v2.js")).default;
    const known = new Set(Object.getOwnPropertyNames(v2).filter((k) => typeof v2[k] === "function"));
    assert.deepEqual([...known].sort(), ["error", "list", "single"],
      "if this list changes the note above needs revisiting");
    const missing = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      // only the files that actually import the v2 shape - v1 has a different one
      if (!/restResult\.model\.v2/.test(src)) continue;
      for (const m of src.matchAll(/\bRestResult\.([A-Za-z0-9_]+)\s*\(/g)) {
        if (!known.has(m[1])) missing.push(`RestResult.${m[1]} (${rel(file)})`);
      }
    }
    assert.deepEqual(missing, []);
  });
});

describe("every logger call names a level the logger has", () => {
  // winston.config.syslog.levels : emerg, alert, crit, error, warning, notice, info, debug.
  // `warn` is NOT among them, however natural it looks.
  const LEVELS = new Set(Object.keys(winston.config.syslog.levels));
  // winston's own api, used for things other than writing a line
  const API = new Set(["log", "add", "remove", "clear", "close", "child", "profile", "startTimer", "configure", "on", "end", "level"]);

  test("no logger.warn, and nothing else invented either", () => {
    const bad = [];
    for (const [member, files] of membersUsed(/\blogger\.([a-zA-Z]+)\s*\(/g)) {
      if (!LEVELS.has(member) && !API.has(member)) bad.push(`logger.${member} (${[...files].join(", ")})`);
    }
    assert.deepEqual(bad, []);
  });

  test("and the test stub implements every level the source uses", () => {
    // a level missing from the stub is the same TypeError, only in the test run - which
    // would then be blamed on the test rather than on the call
    const stub = readFileSync(path.join(here, "__mocks__/logger.js"), "utf8");
    const used = [...membersUsed(/\blogger\.([a-zA-Z]+)\s*\(/g).keys()].filter((m) => LEVELS.has(m));
    assert.ok(used.length >= 4, `only ${used.length} levels used, expected the usual five`);
    const missing = used.filter((level) => !new RegExp(`\\b${level}\\s*:`).test(stub));
    assert.deepEqual(missing, []);
  });
});

describe("every environment variable the server reads is documented", () => {
  // help.yaml is the single source of truth for the settings page: the env editor builds
  // its whole list from that section, and the save endpoint refuses a name that is not in
  // it. So an undocumented variable is not merely undocumented - it cannot be seen or
  // edited at all, however carefully the rest of the plumbing was written.
  // FORMS_STAGING_PATH shipped that way: wired as a live, relocating setting and invisible.
  const INTERNAL = new Set([
    // the bootstrap knobs, deliberately not operator-facing
    "MANAGED_ENV_PATH",   // points at the store itself - chicken and egg
    "FORCE_DOTENV",       // development/test switch
  ]);

  test("nothing is read that help.yaml does not describe", async () => {
    const yaml = (await import("yaml")).default;
    const help = yaml.parse(readFileSync(path.join(serverRoot, "../docs/_data/help.yaml"), "utf8"));
    const section = Object.values(help).find((s) => s && s.link === "environment-variable");
    assert.ok(section, "the Environment Variables section must exist - config.controller.env needs it");
    const documented = new Set(section.items.map((i) => i.name));
    assert.ok(documented.size > 50, `only ${documented.size} variables documented`);

    const used = new Set();
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[["']([A-Z][A-Z0-9_]+)["']\])/g)) {
        used.add(m[1] || m[2]);
      }
    }
    assert.ok(used.size > 50, `only ${used.size} variables read`);
    const undocumented = [...used].filter((v) => !documented.has(v) && !INTERNAL.has(v)).sort();
    assert.deepEqual(undocumented, []);
  });
});
