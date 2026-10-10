// Shared constant helpers used by the settings constants page (via
// useFormsConfig) and the designer's constant add/edit modals. Keep these pure
// so both can import the same round-trip logic instead of duplicating it.
import YAML from 'yaml';

// A LIST is shown as yaml, the way it is written in config.yaml, because that is
// the only form of it a person can read and edit in a box: `[{"name":"a"},...]`
// on one line is what a list of objects used to look like here.
// A MAP stays empty: the tree renders it as subkey rows, and a value left on a
// row that has children is dropped on save.
export function constantValueDisplay(v) {
  if (isPlainObject(v)) return '';
  if (Array.isArray(v)) return YAML.stringify(v).replace(/\n+$/, '');
  return String(v ?? '');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Text that is meant to BE a structure rather than to describe one. A flow list
// or map (`[1, 2]`, `{a: 1}`), a block list (`- one`), or anything spanning more
// than one line - a block list or map cannot be written on a single line.
function looksStructured(trimmed) {
  return /^[[{]/.test(trimmed) || /^-(\s|$)/.test(trimmed) || trimmed.includes('\n');
}

// The value as it will be stored. Structured text is parsed as YAML, which is a
// superset of the JSON this used to accept, so `[1, 2]` keeps working and a
// block list or a list of objects now works too.
//
// The parse result is only taken when it is a LIST or a MAP. A multi-line plain
// string parses as yaml perfectly well - into a single folded line - so taking
// every result would silently rewrite the one kind of value a person types into
// a textarea on purpose.
export function coerceConstantValue(raw) {
  const v = String(raw ?? '');
  const trimmed = v.trim();
  if (looksStructured(trimmed)) {
    try {
      const parsed = YAML.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch {
      /* unparsable : keep the text, and see constantValueError */
    }
    return v;
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (String(Number(v)) === v && Number.isFinite(Number(v))) return Number(v);
  return v;
}

// How tall the value box has to be. One row for a plain value, so a constant
// that holds a word still looks like the single-line input it used to be, and
// enough rows to read a list without scrolling - to a limit, because a long list
// must not push every other row off the screen.
export function constantValueRows(value) {
  const lines = String(value ?? '').split('\n').length;
  return lines > 1 ? Math.min(Math.max(lines, 3), 12) : 1;
}

// Why a structured value could not be read, or null when the text is fine.
//
// Without this a broken list is stored as its own SOURCE TEXT: the config saves,
// the constant resolves, and `$(SERVERS)` quietly hands a form the string
// "- one\n- two" instead of two items. The editors refuse the save instead.
// Text that is not structured at all is never an error - it is just a string.
export function constantValueError(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!looksStructured(trimmed)) return null;
  try {
    YAML.parse(trimmed);
    return null;
  } catch (e) {
    return e?.message || String(e);
  }
}

// Recursively convert a constants object to an editable tree of rows.
// Each row: { key, value, _orig, _display, children }
// - leaf (non-object value): value is the display string, children is empty
// - parent (plain-object value): value is '', children holds sub-rows
export function constantsToArray(obj) {
  if (!obj || !isPlainObject(obj)) return [];
  return Object.entries(obj).map(([k, v]) => {
    if (isPlainObject(v)) {
      return { key: k, value: '', _orig: v, _display: '', children: constantsToArray(v) };
    }
    const value = constantValueDisplay(v);
    return { key: k, value, _orig: v, _display: value, children: [] };
  });
}

// Rebuild the constants object from the editable tree.
// Keys are trimmed : a form references a constant as `$(MY_KEY)`, so a stray
// space would store a key nothing can ever resolve. Callers are expected to
// refuse a keyless row before getting here (it would be dropped, value and all).
export function arrayToConstants(arr) {
  const obj = {};
  for (const row of arr) {
    const key = String(row.key ?? '').trim();
    if (!key) continue;
    if (row.children && row.children.length > 0) {
      obj[key] = arrayToConstants(row.children);
      continue;
    }
    // Untouched leaf : write the original value back verbatim (keeps 1.10, quoted
    // numbers, ... exactly as they were). Never for a row that WAS a parent : its
    // children have all been deleted, so restoring the original object would
    // resurrect the whole subtree the user just removed.
    if (row._orig !== undefined && !isPlainObject(row._orig) && row.value === row._display) {
      obj[key] = row._orig;
      continue;
    }
    // a map with no keys (an empty map, or a parent whose subkeys were all deleted) and no value
    // typed : a map still - an empty one, never the subtree back, never an empty string
    if (isPlainObject(row._orig) && String(row.value ?? '') === '') {
      obj[key] = {};
      continue;
    }
    obj[key] = coerceConstantValue(row.value);
  }
  return obj;
}

// Flatten a constants tree into a list with depth for display purposes.
// Each entry holds { row, depth } where row is the ORIGINAL object (not a
// copy), so mutations and reference-based lookups (indexOf) work correctly.
export function flattenConstants(arr, depth = 0) {
  const result = [];
  for (const row of arr) {
    result.push({ row, depth });
    if (row.children && row.children.length > 0) {
      result.push(...flattenConstants(row.children, depth + 1));
    }
  }
  return result;
}
