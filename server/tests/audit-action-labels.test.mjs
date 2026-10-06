// Every action the audit middleware can produce needs a readable label, in all the
// locales, or the audit page falls back to printing the raw string.
//
// That fallback is silent, which is exactly why this is a test rather than a convention:
// adding one mutating route adds one action, and nothing fails when its label is missing.
// The action vocabulary is bounded on purpose (actionFrom keeps only the resource segment
// for an unrouted path), so it CAN be enumerated from the route table - this derives it
// with the real actionFrom rather than restating a list that would drift.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..");
const clientLocales = path.join(here, "../../client/src/locales");
const LANGS = ["en", "de", "fr", "it", "es", "nl", "ca"];

// the REAL actionFrom and the REAL skip list, lifted from the middleware
const mwSrc = readFileSync(path.join(serverRoot, "src/lib/auditMiddleware.js"), "utf8");
const actionFrom = new Function(
  `${/function actionFrom\([\s\S]*?\n\}/.exec(mwSrc)[0]}; return actionFrom;`
)();
const SKIP = new Function(`return ${/const SKIP = (\[[^\]]*\]);/.exec(mwSrc)[1]};`)();

/** Every mutating action reachable through the v2 route table. */
function derivedActions() {
  const app = readFileSync(path.join(serverRoot, "src/app.js"), "utf8");
  const imports = Object.fromEntries(
    [...app.matchAll(/import\s+(\w+)\s+from\s+["']([^"']*routes\/v2\/[^"']+)["']/g)].map((m) => [m[1], m[2]])
  );
  const actions = new Set();
  for (const m of app.matchAll(/app\.use\(`(\/api\/v2\/[^`]*)`[^;]*?,\s*(\w+)\s*\)/g)) {
    const [, mount, routerVar] = m;
    // the middleware never sees these at all
    if (SKIP.some((re) => re.test(mount + "/"))) continue;
    const rel = imports[routerVar];
    if (!rel) continue;
    const file = path.resolve(serverRoot, "src", rel.replace(/^\.\.\//, "").replace(/^\.\//, ""));
    if (!existsSync(file)) continue;
    const routes = readFileSync(file, "utf8");
    for (const r of routes.matchAll(/router\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      actions.add(actionFrom(mount, r[2], r[1].toUpperCase(), true));
    }
  }
  return [...actions].sort();
}

/** The label keys defined under audit.actionLabels for one locale. */
function labelKeys(lang) {
  const t = readFileSync(path.join(clientLocales, `${lang}.js`), "utf8");
  const start = t.indexOf("actionLabels");
  assert.ok(start > -1, `${lang}.js has no actionLabels block`);
  let depth = 0, i = t.indexOf("{", start), end = i;
  for (; i < t.length; i++) {
    if (t[i] === "{") depth++;
    else if (t[i] === "}" && --depth === 0) { end = i; break; }
  }
  const block = t.slice(t.indexOf("{", start) + 1, end);
  return new Set([...block.matchAll(/(?:^|[,{])\s*['"]?([A-Za-z0-9_]+)['"]?\s*:/gm)].map((m) => m[1]));
}

/**
 * Actions written by an explicit Audit.log(...) call, not derived from a route.
 *
 * This is the SECOND source of audit actions, and the one this test originally missed.
 * The blanket middleware derives an action from the matched route; a controller that also
 * calls Audit.log itself adds its own, and nothing in the route table mentions it. That is
 * exactly how `user.password.update` shipped unlabelled - it was added alongside the
 * current-password check and the route-derived test could never see it. Found by reading
 * the actions in a real audit table, which is the only place both sources meet.
 */
function explicitActions() {
  const roots = ["src/controllers", "src/models", "src/lib"];
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        for (const m of readFileSync(full, "utf8").matchAll(/action:\s*'([a-z0-9._-]+)'/g)) found.add(m[1]);
      }
    }
  };
  for (const r of roots) walk(path.join(serverRoot, r));
  return [...found].sort();
}

describe("the audit action vocabulary", () => {
  const actions = derivedActions();

  test("the route table really was parsed, so these assertions are not vacuous", () => {
    assert.ok(actions.length > 40, `only derived ${actions.length} actions`);
    // a few that must always be there
    for (const a of ["user.create", "settings.update", "repository.delete"]) {
      assert.ok(actions.includes(a), `expected ${a} among the derived actions`);
    }
  });

  test("login and token really are skipped, not merely unlabelled", () => {
    // they are audited by the login controller instead, which is the only place that
    // knows the ATTEMPTED username
    assert.ok(SKIP.length >= 2);
    assert.ok(!actions.some((a) => a.startsWith("auth.")), "auth must not reach the middleware");
    assert.ok(!actions.some((a) => a.startsWith("token.")), "token must not reach the middleware");
  });

  test("explicit Audit.log calls were found, so the assertions below are not vacuous", () => {
    const e = explicitActions();
    assert.ok(e.length >= 8, `only found ${e.length} explicitly logged actions`);
    assert.ok(e.includes("user.password.update"), "expected the password-change action");
  });

  test.each(LANGS)("%s has a label for every action", (lang) => {
    const keys = labelKeys(lang);
    // BOTH sources: derived from the route table, and written by hand in a controller
    const all = [...new Set([...actions, ...explicitActions()])];
    const missing = all.filter((a) => !keys.has(a.replace(/[.-]/g, "_")));
    assert.deepEqual(missing, [],
      `${lang}.js is missing audit.actionLabels for: ${missing.join(", ")} ` +
      `(the key is the action with dots and hyphens replaced by underscores)`);
  });

  test("all the locales define exactly the same label keys", () => {
    const en = [...labelKeys("en")].sort();
    for (const lang of LANGS.slice(1)) {
      assert.deepEqual([...labelKeys(lang)].sort(), en, `${lang}.js has a different set of action labels than en.js`);
    }
  });
});
