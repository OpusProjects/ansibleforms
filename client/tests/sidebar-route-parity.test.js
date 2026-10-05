// The sidebar's `permission:` must match the route's `beforeEnter` guard.
//
// This has shipped wrong twice: a link rendered for a user whose route guard then bounces
// them, or a page reachable by URL that the menu hides. Nothing fails when they diverge -
// each side is correct on its own - so it needs a test rather than a convention.
//
// Both sides are plain declarations, so the pairing can be derived instead of restated:
// the sidebar lists { link, permission } and the router lists { path, beforeEnter }, and
// each guard function tests exactly one `options?.<name>`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

const sidebarSrc = read('src/components/AppSidebar.vue');
const routerSrc = read('src/router/index.js');

/** link -> permission, from the sidebar's item declarations. */
function sidebarPermissions() {
  const out = {};
  for (const m of sidebarSrc.matchAll(/link:\s*['"]([^'"]+)['"]([^}]*)\}/g)) {
    const [, link, rest] = m;
    const perm = /permission:\s*'([^']+)'/.exec(rest);
    // documented default: a missing permission is treated as showSettings, the strictest
    out[link] = perm ? perm[1] : 'showSettings';
  }
  return out;
}

/** guard function name -> the single role option it tests. */
function guardOptions() {
  const out = {};
  for (const m of routerSrc.matchAll(/const\s+(\w+)\s*=\s*\(to,\s*from,\s*next\)\s*=>\s*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = m;
    const opts = [...body.matchAll(/options\?\.(\w+)/g)].map((x) => x[1]);
    if (opts.length) out[name] = [...new Set(opts)];
  }
  return out;
}

/** route path -> guard function name. */
function routeGuards() {
  const out = {};
  for (const m of routerSrc.matchAll(/path:\s*'([^']+)'[^}]*?beforeEnter:\s*(\w+)/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe('the sidebar and the router agree on who may see a page', () => {
  const sidebar = sidebarPermissions();
  const guards = guardOptions();
  const routes = routeGuards();

  it('all three were parsed, so these assertions are not vacuous', () => {
    expect(Object.keys(sidebar).length).toBeGreaterThan(15);
    expect(Object.keys(routes).length).toBeGreaterThan(15);
    // the guards that carry their own option, named in CLAUDE.md
    for (const g of ['allowBackupOps', 'allowScheduledJobs', 'allowStoredJobs']) {
      expect(Object.keys(guards)).toContain(g);
    }
  });

  it('every sidebar link points at a route that exists', () => {
    const missing = Object.keys(sidebar).filter((link) => !(link in routes));
    expect(missing).toEqual([]);
  });

  it('every sidebar permission matches its route guard', () => {
    const mismatched = [];
    for (const [link, permission] of Object.entries(sidebar)) {
      const guard = routes[link];
      if (!guard) continue;
      const opts = guards[guard];
      if (!opts) continue; // a guard that checks something other than a role option
      if (!opts.includes(permission)) {
        mismatched.push(`${link}: sidebar says '${permission}', ${guard} checks ${opts.join('/')}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
