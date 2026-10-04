// Every environment variable must be claimed by exactly one tab on the settings page.
//
// This test exists because the 'Other' catch-all was removed. While it was there, a
// variable matching no group still appeared - untidily, but editable. Without it the
// grouping is exhaustive by assumption, and a variable that matches nothing is simply not
// rendered: no tab shows it, no warning is logged, and the only way to set it is to edit
// persistent/.env by hand. Adding a variable to help.yaml and forgetting to add it to a
// group here is a one-line mistake with a completely silent outcome.
//
// help.yaml is the single source of truth for which variables exist (Helpers.envAllowedOptions
// and the whole tab rendering read it), so it is the right side to enumerate from. Both
// sides are read as the REAL files rather than restated here, or the test would only be
// checking a copy of itself against another copy.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');

/** Every environment variable documented in help.yaml. */
function documentedVariables() {
  const doc = yaml.parse(readFileSync(path.join(repoRoot, 'server/help.yaml'), 'utf8'));
  const section = doc.find((s) => s.link === 'environment-variable');
  expect(section, 'the environment-variable section moved in help.yaml').toBeTruthy();
  return section.items.map((i) => i.name);
}

/** The group table as the page actually declares it, parsed from the source. */
function envGroups() {
  const src = readFileSync(path.join(repoRoot, 'client/src/pages/admin/settings.vue'), 'utf8');
  const block = /const envGroupOrder = \[([\s\S]*?)\n\];/.exec(src);
  expect(block, 'envGroupOrder moved or changed shape').toBeTruthy();
  const list = (chunk, key) => {
    const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(chunk);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  // chunk on the key: boundaries - the entries close with `] },` on one line, so matching
  // a balanced brace is more trouble than slicing between keys
  const marks = [...block[1].matchAll(/key:\s*'([^']+)'/g)];
  return marks.map((m, i) => {
    const chunk = block[1].slice(m.index, i + 1 < marks.length ? marks[i + 1].index : undefined);
    return { key: m[1], exact: list(chunk, 'exact'), prefix: list(chunk, 'prefix') };
  });
}

/** The exclusion regex, read from the page rather than restated. */
function ownedElsewhere() {
  const src = readFileSync(path.join(repoRoot, 'client/src/pages/admin/settings.vue'), 'utf8');
  const m = /const OWNED_ELSEWHERE = \/(.+?)\/;/.exec(src);
  expect(m, 'OWNED_ELSEWHERE moved').toBeTruthy();
  return new RegExp(m[1]);
}

const groupsOf = (groups, name) =>
  groups.filter((g) => g.exact.includes(name) || g.prefix.some((p) => name.startsWith(p))).map((g) => g.key);

describe('the environment settings tabs', () => {
  const variables = documentedVariables();
  const groups = envGroups();
  const owned = ownedElsewhere();

  it('parsed both sides, so the assertions below are not vacuous', () => {
    expect(variables.length).toBeGreaterThan(50);
    expect(groups.length).toBeGreaterThan(8);
    expect(groups.every((g) => g.exact.length || g.prefix.length)).toBe(true);
  });

  it('has no Other catch-all left', () => {
    const src = readFileSync(path.join(repoRoot, 'client/src/pages/admin/settings.vue'), 'utf8');
    expect(src).not.toContain('envGroupOther');
    expect(groups.map((g) => g.key)).not.toContain('other');
  });

  it('shows every documented variable on some tab', () => {
    const orphans = variables.filter((n) => !owned.test(n) && groupsOf(groups, n).length === 0);
    expect(
      orphans,
      'these match no tab, so they are not rendered anywhere and cannot be edited from the UI: ' +
        orphans.join(', ')
    ).toEqual([]);
  });

  it('claims each variable exactly once, so none is hidden by an earlier tab', () => {
    // the first matching group wins and marks the name as taken, so a second claim is
    // dead configuration that silently never applies
    const doubled = variables
      .filter((n) => !owned.test(n))
      .map((n) => ({ n, keys: groupsOf(groups, n) }))
      .filter((x) => x.keys.length > 1);
    expect(
      doubled,
      'claimed by more than one tab: ' + doubled.map((x) => `${x.n} (${x.keys.join(', ')})`).join('; ')
    ).toEqual([]);
  });

  it('keeps the two former Other variables with the feature they serve', () => {
    expect(groupsOf(groups, 'FORMS_STAGING_PATH')).toEqual(['formsConfig']);
    expect(groupsOf(groups, 'BACKUP_COMMAND_TIMEOUT_SECONDS')).toEqual(['backups']);
  });

  it('does not claim a variable that belongs to another page', () => {
    // VAULT_* have their own page, BASE_URL is reported on Status - claiming either here
    // would put an uneditable or duplicated field back on this page
    for (const n of variables.filter((x) => owned.test(x))) {
      expect(groupsOf(groups, n), `${n} is owned elsewhere but claimed by a tab`).toEqual([]);
    }
  });
});
