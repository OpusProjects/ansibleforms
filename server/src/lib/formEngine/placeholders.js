'use strict';
import { SENTINELS } from './values.js';

/**
 * Field placeholder handling for the server-side form engine (used by the MCP server).
 *
 * MIRROR of the browser implementation - keep the two in sync:
 *   getFieldValue, quoteContextAt,
 *   substituteExpressionPlaceholder,
 *   readPlaceholderPath              -> client/src/lib/Helpers.js
 *                                       (readPlaceholderPath = Helpers.replacePlaceholders,
 *                                        without its eval)
 *   replacePlaceholderInString       -> client/src/components/AppForm.vue
 *   scanDependencies                 -> AppForm.vue addDynamicFieldDependency /
 *                                       getPlaceholderMatches / findVariableDependencies
 *   checkDependencies                -> AppForm.vue checkDependencies
 *
 * Everything here is a pure function of its arguments : no Vue refs, no module state. The
 * reactive status map the browser keeps is replaced by an `isReady(name)` callback.
 */

const PLACEHOLDER = /\$\(([^)]+)\)/g;

/**
 * The value a field contributes to a placeholder or a dependency check.
 * A record picks `column` (falling back to its first key), an array of records is
 * flattened by that column, and the enum sentinels read as undefined.
 */
export function getFieldValue(field, column, keepArray) {
  let keys;
  let key;
  let wasArray = false;
  if (field) {
    if (Array.isArray(field)) {
      wasArray = true;
    } else {
      field = [].concat(field ?? []);
    }
    if (field.length > 0) {
      if (column != "*") {
        if (typeof field[0] === "object") {
          keys = Object.keys(field[0] || {});
          if (keys.length > 0) {
            key = (keys.includes(column)) ? column : keys[0];
            field = field.map((item) => ((item) ? ((item[key] == null) ? null : (item[key] ?? item)) : undefined));
          } else {
            field = (!keepArray) ? undefined : field;
          }
        }
      }
      if (field !== undefined) {
        field = (!wasArray || !keepArray) ? field[0] : field;
      }
    } else {
      field = (!keepArray) ? undefined : field;
    }
  }
  // loosely, as the browser always did : a one-element ['__auto__'] is no choice either
  if (SENTINELS.some((s) => field == s)) {
    field = undefined;
  }
  return field;
}

/**
 * Read `a.b[0].c` out of an object. Helpers.replacePlaceholders on the client does this
 * with eval ; a path is all it ever evaluates, so a plain walk gives the same answer.
 * A path with other characters is handed back as the literal placeholder, like the client.
 */
export function readPlaceholderPath(match, object) {
  if (!/^[a-zA-Z0-9_\-[\].]*$/.test(match)) return `$(${match})`;
  const parts = String(match).replaceAll('[', '.').replaceAll(']', '.').split('.').filter((x) => x !== '');
  let cur = object;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Which quote character, if any, encloses position `index` of a JS expression. */
export function quoteContextAt(expression, index) {
  let quote = null;
  for (let i = 0; i < index; i++) {
    const c = expression[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    }
  }
  return quote;
}

/**
 * A JS literal's text with a template literal's two active sequences - a backtick, which
 * closes it, and `${`, which runs code - written as unicode escapes (\u0060, \u0024{).
 *
 * A unicode escape needs no backslash of its own to be undone : it reads as the same
 * character in a '...', "..." or `...` literal whatever precedes it, so it is safe on text that
 * already carries escapes (the JSON literals spliced here) - where escaping with a backslash
 * (\`) would have to escape the backslashes first, and those are already escaped by JSON.
 *
 * @param {string} text  a JS literal's source (a JSON literal, or a string literal's body)
 * @returns {string} the same literal, inert inside a template literal
 */
export function templateInert(text) {
  return text.split('`').join('\\u0060').split('${').join('\\u0024{');
}

/**
 * Splice a resolved value into an expression at the first occurrence of its placeholder,
 * as a JS literal - see the long comment on the client version for the three cases.
 */
export function substituteExpressionPlaceholder(expression, placeholder, value, isSource = false, hardened = false) {
  if (expression == null) return expression;
  const at = expression.indexOf(placeholder);
  if (at < 0) return expression;
  const end = at + placeholder.length;
  const quote = quoteContextAt(expression, at);
  // quoteContextAt does not track template literals, so a value landing inside one could
  // close it with a backtick or run code with ${...}. Both are written as unicode escapes
  // (templateInert) : inert in a template literal, the same characters in any other JS string
  // literal, and a JSON literal only ever carries them inside its strings.
  const safe = (s) => (hardened ? templateInert(String(s)) : s);
  if (!quote) {
    const literal = isSource ? value : JSON.stringify(value);
    return expression.slice(0, at) + safe(literal) + expression.slice(end);
  }
  if (expression[at - 1] === quote && expression[end] === quote) {
    const literal = isSource ? value : JSON.stringify(value);
    return expression.slice(0, at - 1) + safe(literal) + expression.slice(end + 1);
  }
  let raw = value;
  if (isSource) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') raw = parsed;
    } catch { /* not JSON after all - splice the source in as text */ }
  }
  const body = JSON.stringify(String(raw)).slice(1, -1);
  const text = quote === "'" ? body.replace(/'/g, "\\'") : body;
  return expression.slice(0, at) + safe(text) + expression.slice(end);
}

/**
 * Splice placeholder VALUES the browser resolved into an expression taken from the form
 * definition - the server half of a form-bound POST /api/v2/expression.
 *
 * The browser resolves `$(...)` with its live form state (it understands `$(a.b)`,
 * placeholderColumn, list rows) and sends what each placeholder became, keyed by the raw
 * text between the brackets. Only that data comes from the caller ; the expression text
 * never does. Every value is spliced as a JS literal, so it cannot become code :
 *
 *  - a key listed in `literals` is a value the browser splices as JSON source (an object,
 *    an array, a record path) - it is re-serialised here from the parsed body, so it is
 *    pure JSON data, never the caller's text
 *  - anything else goes through substituteExpressionPlaceholder as a value, like the browser
 *  - missing, null and the __undefined__/__null__ sentinels become undefined/null, as the
 *    browser's ignoreIncomplete handling does
 *
 * @param {string} expression  the field's expression, from the form definition
 * @param {object} values      raw placeholder text -> value
 * @param {string[]} literals  the keys to splice as JSON source
 */
export function spliceExpressionValues(expression, values, literals = []) {
  if (typeof expression !== 'string') return expression;
  const vals = values && typeof values === 'object' ? values : {};
  const asSource = new Set(Array.isArray(literals) ? literals : []);
  let value = expression.replace(/\n+/g, '');
  for (const match of [...value.matchAll(PLACEHOLDER)]) {
    const key = match[1];
    const v = Object.prototype.hasOwnProperty.call(vals, key) ? vals[key] : undefined;
    if (v === undefined || v === '__undefined__') {
      value = value.replace(match[0], () => '__undefined__');
    } else if (v === null || v === '__null__') {
      value = value.replace(match[0], () => '__null__');
    } else if (asSource.has(key)) {
      value = substituteExpressionPlaceholder(value, match[0], JSON.stringify(v), true, true);
    } else {
      value = substituteExpressionPlaceholder(value, match[0], v, false, true);
    }
  }
  value = value.replaceAll("'__undefined__'", "undefined");
  value = value.replaceAll("__undefined__", "undefined");
  value = value.replaceAll("'__null__'", "null");
  value = value.replaceAll("__null__", "null");
  return value;
}

function stringifyValue(fieldvalue) {
  if (typeof fieldvalue === 'object' || Array.isArray(fieldvalue)) {
    return JSON.stringify(fieldvalue);
  }
  return fieldvalue;
}

/**
 * Substitute every `$(...)` placeholder in `value`.
 *
 * @param {string} value
 * @param {object} ctx
 * @param {object} ctx.values        name -> current raw value (fields, constants, vars, __user__)
 * @param {object} ctx.fieldOptions  name -> { type, placeholderColumn }
 * @param {function} [ctx.isReady]   name -> boolean ; a field that is not ready yet cannot be
 *                                   substituted (the browser's "fixed/variable/default" test)
 * @param {boolean} ignoreIncomplete substitute unresolved placeholders as undefined
 * @param {'raw'|'expression'} mode  'expression' splices JS literals (safe inside an
 *                                   expression), 'raw' pastes text (queries, escaped later)
 * @returns {{hasPlaceholders: boolean, value: string|undefined, resolved: object, missing: string[]}}
 *   `value` is undefined when a placeholder could not be resolved ; `missing` names the
 *   fields responsible, `resolved` maps each raw placeholder text to what it became (raw
 *   mode) or to the value spliced in (expression mode), `literals` lists the keys an
 *   expression took as JSON source - what POST /api/v2/expression sends
 */
export function replacePlaceholderInString(value, ctx, ignoreIncomplete = false, mode = 'raw') {
  const values = ctx?.values || {};
  const fieldOptions = ctx?.fieldOptions || {};
  const isReady = ctx?.isReady || (() => true);
  const resolved = {};
  const literals = [];
  const missing = [];
  let hasPlaceholders = false;
  if (typeof value !== "string") {
    return { hasPlaceholders: false, value, resolved, literals, missing };
  }
  value = value.replace(/\n+/g, '');
  const matches = [...value.matchAll(PLACEHOLDER)];
  for (const match of matches) {
    const foundmatch = match[0];
    let foundfield = match[1];
    let column = "";
    const tmpArr = /([^.]+)\.(.+)/.exec(foundfield);
    if (tmpArr && tmpArr.length > 0) {
      foundfield = tmpArr[1];
      column = tmpArr[2];
    } else if (foundfield in fieldOptions) {
      column = fieldOptions[foundfield].placeholderColumn || "";
    }
    foundfield = foundfield.replace(/\[[0-9]*\]/, '');
    let fieldvalue;
    let ready = false;
    let isObjectLiteral = false;

    if (Object.prototype.hasOwnProperty.call(values, foundfield)) {
      const opts = fieldOptions[foundfield];
      const raw = values[foundfield];
      if (opts && (["expression", "list", "constant"].includes(opts.type) || column.includes(".")) && (typeof raw == "object")) {
        if (opts.type === 'list' && Array.isArray(raw)) {
          fieldvalue = JSON.stringify(raw.map((row) => row?.__output__ ?? row));
        } else {
          fieldvalue = JSON.stringify(readPlaceholderPath(match[1], values));
        }
        isObjectLiteral = true;
        if (mode !== 'expression' && typeof fieldvalue == "string") {
          fieldvalue = fieldvalue.replace(/^"+/, '').replace(/"+$/, '');
        }
      } else {
        fieldvalue = getFieldValue(raw, column, true);
      }
      ready = isReady(foundfield);
    }
    if ((ready && fieldvalue !== undefined) || (ignoreIncomplete && value !== undefined)) {
      if (fieldvalue === undefined) fieldvalue = "__undefined__";
      if (fieldvalue === null) fieldvalue = "__null__";
      if (mode === 'expression' && fieldvalue !== "__undefined__" && fieldvalue !== "__null__") {
        value = substituteExpressionPlaceholder(value, foundmatch, fieldvalue, isObjectLiteral);
        resolved[match[1]] = isObjectLiteral ? JSON.parse(fieldvalue) : fieldvalue;
        if (isObjectLiteral && !literals.includes(match[1])) literals.push(match[1]);
      } else {
        fieldvalue = stringifyValue(fieldvalue);
        resolved[match[1]] = fieldvalue;
        value = value?.replace(foundmatch, () => fieldvalue);
      }
    } else {
      if (!missing.includes(foundfield)) missing.push(foundfield);
      value = undefined;
    }
    hasPlaceholders = true;
  }
  if (value !== undefined && /\$\(([^)]+)\)/.test(value)) {
    value = undefined;
  }
  if (value != undefined) {
    value = value.replaceAll("'__undefined__'", "undefined");
    value = value.replaceAll("__undefined__", "undefined");
    value = value.replaceAll("'__null__'", "null");
    value = value.replaceAll("__null__", "null");
  }
  return { hasPlaceholders, value, resolved, literals, missing };
}

/** The field a placeholder or dependency name is rooted at : `a.b` -> `a`, `x[0]` -> `x`. */
export function rootFieldName(name) {
  let found = String(name);
  const tmpArr = /([^.]+)\..+/.exec(found);
  if (tmpArr && tmpArr.length > 0) found = tmpArr[1];
  return found.replace(/\[[0-9]*\]/, '');
}

/**
 * Build the field dependency graph : which fields each field reads, through `$()` in its
 * expression/query/default and through its `dependencies:` block.
 *
 * @param {object[]} fields      the form's field definitions
 * @param {string[]} knownNames  names that exist without being fields (constants, vars, __user__)
 * @param {object} [extraDeps]    field -> names it depends on beyond its own text (a list
 *                                reads the parent through its subform's $(__parent__.x)) ;
 *                                part of the graph BEFORE the cycle detection runs
 * @returns {{dependsOn: object, dependents: object, cycles: string[], warnings: string[]}}
 */
export function scanDependencies(fields, knownNames = [], extraDeps = {}) {
  const names = (fields || []).filter((f) => f?.name).map((f) => f.name);
  const dependsOn = {};
  const dependents = {};
  const warnings = [];
  const add = (field, found) => {
    const root = rootFieldName(found);
    if (names.includes(root)) {
      (dependsOn[field] ||= []);
      if (!dependsOn[field].includes(root)) dependsOn[field].push(root);
      (dependents[root] ||= []);
      if (!dependents[root].includes(field)) dependents[root].push(field);
      if (root === field) warnings.push(`'${field}' has a self reference`);
    } else if (!knownNames.includes(root)) {
      warnings.push(`'${field}' has a reference to unknown field '${root}'`);
    }
  };
  const scan = (field, s) => {
    if (!s || typeof s !== 'string') return;
    for (const m of s.matchAll(PLACEHOLDER)) add(field, m[1]);
  };
  for (const item of fields || []) {
    if (!item?.name) continue;
    scan(item.name, item.expression ?? item.query);
    scan(item.name, item.default);
    for (const dep of item.dependencies || []) {
      if (!dep?.name) continue;
      add(item.name, dep.name.startsWith('!') ? dep.name.slice(1) : dep.name);
    }
  }
  for (const [field, deps] of Object.entries(extraDeps || {})) {
    for (const d of deps || []) if (names.includes(d) && d !== field) add(field, d);
  }
  // cycle detection on the transitive closure, in a scratch copy (see the client comment
  // on why the graph itself must stay one-hop)
  const cycles = [];
  for (const start of Object.keys(dependsOn)) {
    const seen = new Set();
    const stack = [...dependsOn[start]];
    while (stack.length) {
      const n = stack.pop();
      if (n === start) { cycles.push(start); break; }
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(dependsOn[n] || []));
    }
  }
  for (const c of cycles) {
    if (!warnings.some((w) => w.startsWith(`'${c}' has a self reference`))) {
      warnings.push(`'${c}' is part of a circular reference`);
    }
  }
  return { dependsOn, dependents, cycles, warnings };
}

/**
 * Whether a field's `dependencies:` block lets it be shown.
 *
 * @param {object} field
 * @param {object} values        name -> raw value
 * @param {object} fieldOptions  name -> { valueColumn }
 * @param {function} isValid     name -> boolean, stands in for the browser's vuelidate state
 * @returns {boolean}
 */
export function checkDependencies(field, values, fieldOptions = {}, isValid = () => true) {
  if (!("dependencies" in field)) return true;
  const dependencyFn = field.dependencyFn || "and";
  const isAnd = (dependencyFn == "and" || dependencyFn == "nand");
  const isOr = (dependencyFn == "or" || dependencyFn == "nor");
  let result = isAnd;
  for (const item of field.dependencies || []) {
    let value;
    let column = "";
    const inversed = item.name.startsWith("!");
    let fieldname = inversed ? item.name.slice(1) : item.name;
    const tmpArr = /(.+)\.(.+)/.exec(fieldname);
    if (tmpArr && tmpArr.length > 0) {
      fieldname = tmpArr[1];
      column = tmpArr[2];
    } else if (fieldname in fieldOptions) {
      column = fieldOptions[fieldname].valueColumn || "";
    }
    if (column) {
      value = getFieldValue(values[fieldname], column, false);
    } else {
      value = values[fieldname];
    }
    let tmp;
    if (item.isValid != undefined) {
      tmp = item.isValid == isValid(fieldname);
    } else {
      tmp = item.values?.includes(value);
    }
    if (isAnd && ((!inversed && !tmp) || (inversed && tmp))) {
      result = false;
      break;
    }
    if (isOr && ((!inversed && tmp) || (inversed && !tmp))) {
      result = true;
      break;
    }
  }
  if (dependencyFn == "nand" || dependencyFn == "nor") result = !result;
  return result;
}

export default {
  getFieldValue,
  readPlaceholderPath,
  quoteContextAt,
  substituteExpressionPlaceholder,
  spliceExpressionValues,
  replacePlaceholderInString,
  rootFieldName,
  scanDependencies,
  checkDependencies,
};
