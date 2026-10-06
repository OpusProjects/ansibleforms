/******************************************************************/
/*                                                                */
/*  Plural forms of the UI languages                              */
/*                                                                */
/*  A counted text ("1 file", "7 files") is one translation with  */
/*  its forms separated by " | ", and t(key, count) picks one.    */
/*  vue-i18n's own rule only knows English-like languages, so     */
/*  each locale gets a rule from the browser's Intl.PluralRules : */
/*                                                                */
/*    en, de, nl, es, it, ca, pt   2 forms : one | other          */
/*    fr                           2 forms, and 0 is singular     */
/*    pl                           3 forms : one | few | many     */
/*                                 (1 plik, 2 pliki, 5 plików)    */
/*    ja, zh                       1 form : no plural             */
/*                                                                */
/*  A translation lists the forms whole counts can take, in the   */
/*  order below. A rare form it leaves out (French and Spanish    */
/*  "many", for a million) falls back to its last form.           */
/*                                                                */
/******************************************************************/

// the order the forms are written in, as the plural categories of Unicode CLDR
const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

// whole counts up to this cover every form a count in the UI takes ; the "many" of the
// romance languages starts at a million and is left to the fallback
const SAMPLE = 1000;

// the Intl locale of a UI language code, where the bare code means another variant :
// 'pt' alone is Brazilian Portuguese, which also makes 0 singular
const INTL_LOCALE = { pt: 'pt-PT' };

/**
 * Lists the plural forms a language's whole counts take, in the order translations write them.
 *
 * Args:
 *   code (string): the UI language code (en, pl, ja, ...).
 *
 * Returns:
 *   string[]: the forms, e.g. ['one', 'other'] for English, ['one', 'few', 'many'] for Polish.
 */
export function pluralForms(code) {
  const rules = new Intl.PluralRules(INTL_LOCALE[code] || code);
  const used = new Set();
  for (let n = 0; n <= SAMPLE; n++) used.add(rules.select(n));
  return ORDER.filter((form) => used.has(form));
}

/**
 * Builds the vue-i18n plural rule of a language.
 *
 * Args:
 *   code (string): the UI language code.
 *
 * Returns:
 *   function: (choice, choicesLength) => the index of the form to show.
 */
export function pluralRule(code) {
  const rules = new Intl.PluralRules(INTL_LOCALE[code] || code);
  const forms = pluralForms(code);
  return (choice, choicesLength) => {
    const index = forms.indexOf(rules.select(Math.abs(choice)));
    // a form the translation does not list, or a translation with fewer forms : the last one
    return Math.min(index === -1 ? forms.length - 1 : index, choicesLength - 1);
  };
}

/**
 * Builds the plural rules of all the loaded languages, for createI18n.
 *
 * Args:
 *   codes (string[]): the language codes.
 *
 * Returns:
 *   object: the rules keyed by language code.
 */
export function pluralRules(codes) {
  return Object.fromEntries(codes.map((code) => [code, pluralRule(code)]));
}
