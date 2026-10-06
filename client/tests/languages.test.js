// The UI languages (config/languages.js) : the menus list them in alphabetical order of
// their name, and the settings page offers the same codes for DEFAULT_LANGUAGE.
//
// The header and the profile page show the list as it is declared, so a language added at
// the end (as Catalan and Portuguese first were) breaks the order without anything failing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { languages, fallbackLanguage } from '@/config/languages';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the UI languages', () => {
  it('are in alphabetical order of their name', () => {
    const labels = languages.map((l) => l.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('fall back to English, not to the first of the list', () => {
    expect(fallbackLanguage.code).toBe('en');
  });

  it('are the codes DEFAULT_LANGUAGE allows, in the same order', () => {
    const help = readFileSync(path.join(here, '..', '..', 'server', 'help.yaml'), 'utf8');
    const allowed = /name: DEFAULT_LANGUAGE[\s\S]*?allowed: ([^\n]+)/
      .exec(help)[1]
      .split(',')
      .map((c) => c.trim());
    expect(allowed).toEqual(languages.map((l) => l.code));
  });
});
