// Counted texts ("1 file", "7 files") in every language (lib/Plural.js).
//
// They used to be a number followed by a translated word, chosen between two forms with
// `n === 1 ? singular : plural` - an English rule. Polish needs three forms (1 plik, 2 pliki,
// 5 plików), French makes 0 singular, and Japanese and Chinese have no plural at all. A counted
// text is now one translation with its forms separated by " | ", and the language's own rule
// from Intl.PluralRules picks the form.
import { describe, it, expect } from 'vitest';
import { createI18n } from 'vue-i18n';
import { pluralForms, pluralRules } from '@/lib/Plural';

const LANGS = ['en', 'de', 'fr', 'it', 'es', 'nl', 'ca', 'pl', 'pt', 'ja', 'zh'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const messages = {};
for (const lang of LANGS) messages[lang] = (await import(`../src/locales/${lang}.js`)).default;
const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(messages[l])]));

// the counted texts : the English translations written with plural forms
const PLURAL_KEYS = Object.keys(flat.en).filter((k) => typeof flat.en[k] === 'string' && flat.en[k].includes(' | '));
const forms = (value) => value.split(' | ').length;

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
  pluralRules: pluralRules(LANGS),
});
function t(lang, ...args) {
  i18n.global.locale.value = lang;
  return i18n.global.t(...args);
}

describe('the plural forms of each language', () => {
  it('follow the language, not English', () => {
    expect(pluralForms('en')).toEqual(['one', 'other']);
    expect(pluralForms('fr')).toEqual(['one', 'other']);
    expect(pluralForms('pt')).toEqual(['one', 'other']);
    expect(pluralForms('pl')).toEqual(['one', 'few', 'many']);
    expect(pluralForms('ja')).toEqual(['other']);
    expect(pluralForms('zh')).toEqual(['other']);
  });
});

describe('the counted texts', () => {
  it('were found, so these checks are not vacuous', () => {
    expect(PLURAL_KEYS).toEqual(
      expect.arrayContaining([
        'admin.backups.fileCount',
        'settings.settingsPage.subkeyCount',
        'form.itemCount',
        'form.unevaluated',
        'designer.importDone',
        'designer.importSkipped',
      ]),
    );
  });

  it.each(LANGS)('%s writes each one with all its forms, or with one form for all counts', (lang) => {
    const wanted = pluralForms(lang).length;
    const wrong = PLURAL_KEYS.filter((k) => ![1, wanted].includes(forms(flat[lang][k]))).map(
      (k) => `${k}: ${forms(flat[lang][k])} forms, ${lang} needs ${wanted}`,
    );
    expect(wrong).toEqual([]);
  });

  it.each(LANGS)('%s has no " | " in a text that is not counted', (lang) => {
    const stray = Object.keys(flat[lang]).filter(
      (k) => typeof flat[lang][k] === 'string' && flat[lang][k].includes(' | ') && !PLURAL_KEYS.includes(k),
    );
    expect(stray).toEqual([]);
  });
});

describe('a counted text shows the right form', () => {
  it('in English, including 0', () => {
    expect(t('en', 'admin.backups.fileCount', 0)).toBe('0 files');
    expect(t('en', 'admin.backups.fileCount', 1)).toBe('1 file');
    expect(t('en', 'admin.backups.fileCount', 7)).toBe('7 files');
  });

  it('in Polish, with its three forms', () => {
    const files = (n) => t('pl', 'admin.backups.fileCount', n);
    expect(files(1)).toBe('1 plik');
    expect(files(3)).toBe('3 pliki');
    expect(files(5)).toBe('5 plików');
    expect(files(12)).toBe('12 plików');
    expect(files(22)).toBe('22 pliki');
    expect(files(0)).toBe('0 plików');
  });

  it('in French, where 0 is singular', () => {
    expect(t('fr', 'admin.backups.fileCount', 0)).toBe('0 fichier');
    expect(t('fr', 'admin.backups.fileCount', 2)).toBe('2 fichiers');
  });

  it('in Japanese, with its one form', () => {
    expect(t('ja', 'admin.backups.fileCount', 1)).toBe('1 個のファイル');
    expect(t('ja', 'admin.backups.fileCount', 7)).toBe('7 個のファイル');
  });

  it('with other values next to the count', () => {
    expect(t('en', 'designer.importDone', { file: 'a.yaml' }, 1)).toBe('Imported 1 form into a.yaml');
    expect(t('pl', 'designer.importDone', { file: 'a.yaml' }, 4)).toBe('Zaimportowano 4 formularze do a.yaml');
    expect(t('en', 'form.unevaluated', { fields: 'host' }, 1)).toBe('host is unevaluated...');
    expect(t('en', 'form.unevaluated', { fields: 'host, port' }, 2)).toBe('host, port are unevaluated...');
  });
});
