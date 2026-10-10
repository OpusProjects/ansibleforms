// The icon catalogue offered by the category picker and the designer's icon pickers.
//
// Two properties, both of which failed silently before this test existed:
//
//  1. Every name must RESOLVE through the library plugins/index.js builds. A name that does
//     not resolve renders as nothing at all - an empty cell in the picker and an invisible
//     category icon - and no warning is produced.
//  2. No two entries may render the SAME glyph. FontAwesome keeps every FA5 name as an
//     ALIAS of its FA6/7 replacement, and `library.add(fas)` registers the aliases too, so
//     `cog` and `gear` both resolve and both draw an identical cog. Six such pairs were in
//     the list (cog/gear, cogs/gears, file-alt/file-lines, check-circle/circle-check,
//     exclamation-triangle/triangle-exclamation, info-circle/circle-info) - the picker
//     showed twelve entries that were six icons, with only the name to tell them apart.
//
// This is the trap CLAUDE.md documents for the sidebar: compare the FULL rendered path, not
// a prefix and not the name. Resolution goes through the REAL library rather than the
// package's named exports - keying the exports by `iconName` does not see aliases at all
// (the export `faCog` carries iconName 'gear'), which produces a confidently wrong list of
// "unresolvable" icons.
import { describe, test, expect } from 'vitest';
import { library, findIconDefinition } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { far } from '@fortawesome/free-regular-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';
import { availableIcons } from '../src/config/icons.js';

// exactly what src/plugins/index.js does
library.add(fas, far, fab);

/** The full rendered geometry of an icon : width, height and the complete path data. */
const glyphOf = (def) => {
  const d = Array.isArray(def.icon[4]) ? def.icon[4].join('|') : def.icon[4];
  return `${def.icon[0]}x${def.icon[1]}:${d}`;
};

describe('the icon catalogue', () => {
  test('the catalogue is actually populated, so the rest is not vacuous', () => {
    expect(availableIcons.length).toBeGreaterThan(50);
  });

  test('no name is listed twice', () => {
    const seen = new Set();
    const dupes = availableIcons.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    expect(dupes, `duplicated names: ${dupes.join(', ')}`).toEqual([]);
  });

  test('every icon resolves in the solid set, or it renders as nothing', () => {
    const missing = availableIcons.filter((n) => !findIconDefinition({ prefix: 'fas', iconName: n }));
    expect(missing, `these do not resolve and would render as an empty box: ${missing.join(', ')}`).toEqual([]);
  });

  test('no two entries render the same glyph', () => {
    const byGlyph = new Map();
    for (const name of availableIcons) {
      const def = findIconDefinition({ prefix: 'fas', iconName: name });
      if (!def) continue; // reported by the test above
      const key = glyphOf(def);
      if (!byGlyph.has(key)) byGlyph.set(key, []);
      byGlyph.get(key).push(name);
    }
    const identical = [...byGlyph.values()].filter((g) => g.length > 1);
    expect(
      identical,
      'these render identically - FontAwesome aliases, keep only the canonical name: ' +
        identical.map((g) => g.join(' == ')).join(' ; '),
    ).toEqual([]);
  });

  test('the alias trap is real, so the check above is worth having', () => {
    // if this ever stops holding, FontAwesome dropped its aliases and the test above is
    // no longer pinning anything
    const cog = findIconDefinition({ prefix: 'fas', iconName: 'cog' });
    const gear = findIconDefinition({ prefix: 'fas', iconName: 'gear' });
    expect(cog, 'expected the FA5 alias to still resolve').toBeTruthy();
    expect(glyphOf(cog)).toBe(glyphOf(gear));
    // and the catalogue must list only one of them
    expect(availableIcons.includes('cog') && availableIcons.includes('gear')).toBe(false);
  });
});
