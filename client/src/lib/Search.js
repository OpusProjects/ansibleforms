/******************************************************************/
/*                                                                */
/*  Header search                                                 */
/*                                                                */
/*  Finds forms and pages as the user types, like the search of   */
/*  a documentation site. It runs in the browser over a small     */
/*  index : an instance has at most a few hundred forms, so a     */
/*  plain substring match is instant and needs no library.        */
/*                                                                */
/*  Every query word must appear in an entry (title, section or   */
/*  one of its texts) ; the title weighs most, so a form named    */
/*  after the query comes before one that only mentions it.       */
/*                                                                */
/*  Nothing here returns html : highlight() splits a text into    */
/*  matched and unmatched parts, and the component renders them   */
/*  as text, so a form description can never inject markup.       */
/*                                                                */
/******************************************************************/

// how many results the dropdown shows, and how many texts under each one
const MAX_RESULTS = 20;
const MAX_SNIPPETS = 3;
// a long text (a form description) is cut around its first match, to about this length
const SNIPPET_LENGTH = 140;

/**
 * Splits a query into the lowercase words it is matched on.
 *
 * Args:
 *   query (string): what the user typed.
 *
 * Returns:
 *   string[]: the words, without empty ones ; empty for a blank query.
 */
function words(query) {
  return (query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Builds the searchable entries from the forms list and the pages the user may open.
 *
 * Args:
 *   forms (object[]): the forms of the forms list (name, description, categories, icon).
 *   pages (object[]): the pages, as { title, section, link, icon, keywords }.
 *
 * Returns:
 *   object[]: one entry per form and page, as { kind, title, section, path, to, icon, texts }.
 */
function buildIndex(forms, pages) {
  const entries = [];

  // ---------------------------------------------------------------
  // forms : the first category is the section, the description and
  // every category are the texts shown under a match
  // ---------------------------------------------------------------
  for (const form of forms || []) {
    if (!form?.name) continue;
    const categories = (form.categories || []).map((c) => String(c));
    entries.push({
      kind: 'form',
      title: form.name,
      section: categories[0] || '',
      // shown under the title, so readable rather than url-encoded ; `to` is what is opened
      path: '/form?form=' + form.name,
      to: { path: '/form', query: { form: form.name } },
      icon: form.icon || 'file-lines',
      texts: [form.description, ...categories].filter((x) => typeof x === 'string' && x.trim()),
    });
  }

  // ---------------------------------------------------------------
  // pages : the menu section they live in, and a few extra words a
  // user may search them by (e.g. "password" for the profile)
  // ---------------------------------------------------------------
  for (const page of pages || []) {
    entries.push({
      kind: 'page',
      title: page.title,
      section: page.section || '',
      path: page.link,
      to: page.link,
      icon: page.icon || 'file',
      texts: (page.keywords || []).filter(Boolean),
    });
  }
  return entries;
}

/**
 * Cuts a long text around its first match, so the match is visible in the dropdown.
 *
 * Args:
 *   text (string): the text to cut.
 *   terms (string[]): the query words.
 *
 * Returns:
 *   string: the text, or about SNIPPET_LENGTH characters of it with an ellipsis on the cut sides.
 */
function snippet(text, terms) {
  if (text.length <= SNIPPET_LENGTH) return text;
  const lower = text.toLowerCase();
  const first = Math.min(...terms.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  // start a little before the match, on a word boundary
  let start = Math.max(0, first - 30);
  if (start > 0) start = text.lastIndexOf(' ', start) + 1;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  return (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
}

/**
 * Finds the entries matching a query, best first.
 *
 * Args:
 *   entries (object[]): the index from buildIndex().
 *   query (string): what the user typed.
 *   limit (number): the most results to return.
 *
 * Returns:
 *   object[]: the matching entries, each with the texts that match as `snippets`.
 */
function search(entries, query, limit = MAX_RESULTS) {
  const terms = words(query);
  if (!terms.length) return [];
  const phrase = terms.join(' ');
  const results = [];

  for (const entry of entries) {
    const title = entry.title.toLowerCase();
    const section = entry.section.toLowerCase();
    const texts = entry.texts.map((x) => x.toLowerCase());

    // ---------------------------------------------------------------
    // every word must appear somewhere in the entry
    // ---------------------------------------------------------------
    const found = terms.every((w) => title.includes(w) || section.includes(w) || texts.some((x) => x.includes(w)));
    if (!found) continue;

    // ---------------------------------------------------------------
    // score : the whole query at the start of the title, then in it,
    // then each word in the title, the section and the texts
    // ---------------------------------------------------------------
    let score = 0;
    if (title.startsWith(phrase)) score += 100;
    else if (title.includes(phrase)) score += 60;
    for (const w of terms) {
      if (title.includes(w)) score += 20;
      if (section.includes(w)) score += 5;
      if (texts.some((x) => x.includes(w))) score += 3;
    }
    // a form before a page on a tie : the forms are what most users search for
    if (entry.kind === 'form') score += 1;

    const snippets = entry.texts
      .filter((x, i) => terms.some((w) => texts[i].includes(w)))
      .slice(0, MAX_SNIPPETS)
      .map((x) => snippet(x, terms));

    results.push({ ...entry, score, snippets });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/**
 * Splits a text into the parts that match the query and the parts that do not.
 *
 * Args:
 *   text (string): the text to mark.
 *   query (string): what the user typed.
 *
 * Returns:
 *   object[]: the parts in order, as { text, match } ; joined, they are the text again.
 */
function highlight(text, query) {
  const terms = words(query);
  if (!text || !terms.length) return [{ text: text || '', match: false }];

  // longest words first, so "ansibleforms" wins over "ansible" where both match
  const escaped = terms.sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: terms.includes(part.toLowerCase()) }));
}

export default { buildIndex, search, highlight, words };
