'use strict';
import {
  replacePlaceholderInString,
  scanDependencies,
  checkDependencies,
  rootFieldName,
} from './placeholders.js';
import { SENTINELS, isEmptyValue } from './values.js';
import { validateField } from './validate.js';
import { buildFormOutput, listMarkers, canonicalJson } from './output.js';

/**
 * Stateless resolution of a form for a non-browser client (the MCP server).
 *
 * The caller hands in the values it has filled in so far ; this works out, in dependency
 * order, everything that follows from them : which fields are shown, the defaults, the
 * computed expression/query values and the options of every enum. It is the way a person
 * fills in a form - first what depends on nothing, then whatever became available - done
 * in one pass per call instead of the browser's reactive interval loop
 * (client/src/components/AppForm.vue startDynamicFieldsLoop), whose per-field semantics it
 * mirrors : the same readiness gate, the same "default on failure", the same result
 * handling per field type.
 *
 * Nothing here talks to a database, the expression endpoint or node:vm directly : the
 * caller passes `services`, which keeps the RBAC-bound lookups in one place (mcp/tools.js),
 * lets the browser supply its own sandbox, and makes this testable without them.
 *
 * Deliberate differences with the browser, both toward safety :
 *   - an `evalDefault` default is substituted in 'expression' mode (values become JS
 *     literals). The browser pastes them raw, which on a server would let a caller's value
 *     become code.
 *   - an enum's `__auto__` default is never turned into the first option : the caller has
 *     to choose, and the field is reported as needing input.
 */

const DYNAMIC_TYPES = ["expression", "enum", "html", "yaml", "list", "query"];
const VALUE_TYPES = ["expression", "html", "yaml", "list"];   // the expression yields the VALUE
const OPTION_TYPES = ["enum", "query"];                                // the expression yields the OPTIONS
export const DEFAULT_MAX_OPTIONS = 200;
// list rows resolved per launch, all nesting levels together : a row runs its subform's
// expressions and queries, so a huge list would multiply them
export const MAX_LIST_ROWS = 500;

/** The browser's type aliases (AppForm.vue initForm), on a copy - never on the loaded definition. */
export function normalizeFields(fields) {
  return (fields || []).filter((f) => f && f.name).map((f) => {
    const item = { ...f };
    if (item.type == "local") {
      item.hide = item.hide ?? true;
      item.output = item.output ?? false;
      item.type = "expression";
      item.runLocal = true;
    }
    if (item.type == "local_out") {
      item.hide = item.hide ?? true;
      item.type = "expression";
      item.runLocal = true;
    }
    if (item.type == "credential") {
      item.hide = item.hide ?? true;
      item.asCredential = true;
      item.type = "expression";
      item.runLocal = true;
    }
    if (item.type == "html") {
      item.runLocal = true;
    }
    return item;
  });
}

export function isDynamicField(f) {
  return DYNAMIC_TYPES.includes(f.type) && !!(f.expression ?? f.query ?? f.value ?? false);
}

function optionMatches(option, value, valueColumn) {
  if (option && value && typeof option === "object" && typeof value === "object") {
    if (valueColumn && valueColumn in option && valueColumn in value) return option[valueColumn] === value[valueColumn];
    return JSON.stringify(option) === JSON.stringify(value);
  }
  if (option && typeof option === "object") {
    const key = (valueColumn && valueColumn in option) ? valueColumn : Object.keys(option)[0];
    return option[key] === value;
  }
  return option === value;
}

/**
 * @param {object} args
 * @param {object} args.form           the form (or subform) definition, as Form.load returns it
 * @param {object} [args.constants]    config constants
 * @param {object} [args.vars]         varsFiles data (form.vars)
 * @param {object} [args.user]         the authenticated user, injected as __user__
 * @param {object} [args.parent]       parent form values, injected as __parent__ (subforms)
 * @param {object} [args.values]       the caller's raw field values
 * @param {string} [args.only]         resolve just this field and what it depends on
 * @param {number} [args.maxOptions]   cap on the options returned per field
 * @param {object} args.services
 * @param {function} args.services.serverExpression  (expression, field) => Promise<result>
 * @param {function} args.services.query             (field, resolvedPlaceholders) => Promise<result>
 * @param {function} args.services.evalSandbox       (code) => result, for runLocal and evalDefault
 * @param {function} [args.services.forSubform]      (subformName) => services for a list row's queries
 * @param {object[]} [args.subforms]  every subform of the root form (Form.load inlines them) ;
 *                                    defaults to form.subforms
 * @param {boolean} [args.allRows]    resolve every (non-deleted) list row, not only the rows
 *                                    the browser's row editor touched - for the MCP server,
 *                                    whose caller sends plain rows
 * @param {boolean} [args.verifyUntouched]  a row the editor did not touch passes as sent only
 *                                    when it is one the list's own source (default, expression
 *                                    or query, evaluated here) produces - otherwise it is
 *                                    resolved and validated. For the launch validation : a
 *                                    REST caller cannot slip a plain row past the checks, a
 *                                    browser's untouched rows still pass unchanged
 */
export async function resolveForm({
  form,
  constants = {},
  vars = {},
  user = undefined,
  parent = undefined,
  values = {},
  only = undefined,
  maxOptions = DEFAULT_MAX_OPTIONS,
  services,
  subforms = undefined,
  allRows = false,
  verifyUntouched = false,
  // internal : the rows still allowed across the nested resolutions of one launch
  rowBudget = { left: MAX_LIST_ROWS },
}) {
  if (typeof services?.evalSandbox !== 'function') {
    throw new Error('resolveForm needs services.evalSandbox (node: formEngine/node/sandbox.js)');
  }
  const { evalSandbox } = services;
  const fields = normalizeFields(form?.fields);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  const input = (values && typeof values === 'object' && !Array.isArray(values)) ? values : {};
  const warnings = [];

  if (only && !byName[only]) {
    throw new Error(`Field '${only}' does not exist on form '${form?.name}'`);
  }

  // everything a placeholder can read that is not a field
  const vals = {};
  const fieldOptions = {};
  for (const [k, v] of Object.entries(constants || {})) { vals[k] = v; fieldOptions[k] = { type: "constant" }; }
  for (const [k, v] of Object.entries(vars || {})) { vals[k] = v; fieldOptions[k] = { type: "constant" }; }
  if (user !== undefined) { vals.__user__ = user; fieldOptions.__user__ = { type: "expression" }; }
  if (parent && typeof parent === 'object' && Object.keys(parent).length > 0) {
    vals.__parent__ = parent;
    fieldOptions.__parent__ = { type: "constant" };
  }
  const knownNames = Object.keys(vals);
  for (const f of fields) {
    fieldOptions[f.name] = {
      type: f.type,
      valueColumn: f.valueColumn || "",
      placeholderColumn: f.placeholderColumn || "",
      evalDefault: f.evalDefault ?? false,
    };
    // a field shadows a same-named constant, as in the browser
    delete vals[f.name];
  }

  const allSubforms = subforms ?? form?.subforms ?? [];
  const subformOf = (f) => (typeof f.subform === 'string'
    ? allSubforms.find((x) => x?.name === f.subform) : f.subform);
  const hasRows = (f) => f.type === 'list' || (f.type === 'yaml' && !!f.subform);
  // a list's rows read the parent through $(__parent__.x) : the list waits for those fields,
  // so its rows are resolved against settled parent values. They go into the graph before
  // its cycle detection, so a parent field that reads the list back is seen as a cycle.
  const parentReads = {};
  for (const f of fields) {
    const sub = hasRows(f) ? subformOf(f) : null;
    if (!sub) continue;
    parentReads[f.name] = [...new Set([...JSON.stringify(sub.fields || []).matchAll(/\$\(__parent__\.([A-Za-z0-9_-]+)/g)]
      .map((m) => m[1]).filter((n) => byName[n] && n !== f.name))];
  }
  const graph = scanDependencies(fields, knownNames, parentReads);
  warnings.push(...graph.warnings);
  const cycle = new Set(graph.cycles);

  // which fields to evaluate : all, or the upstream closure of `only`
  let scope = new Set(fields.map((f) => f.name));
  if (only) {
    scope = new Set([only]);
    const stack = [only];
    while (stack.length) {
      for (const d of graph.dependsOn[stack.pop()] || []) {
        if (!scope.has(d)) { scope.add(d); stack.push(d); }
      }
    }
  }

  const st = {};
  for (const f of fields) st[f.name] = { status: scope.has(f.name) ? 'pending' : 'skipped' };

  const has = (name) => Object.prototype.hasOwnProperty.call(input, name);
  const valueComputed = (f) => isDynamicField(f) && VALUE_TYPES.includes(f.type)
    && !(has(f.name) && (f.editable || f.type === 'list'));
  // `__auto__` on a choice field means "the browser picks" : here the caller picks, always
  const needsInput = (f, value) => !valueComputed(f)
    && ((OPTION_TYPES.includes(f.type) && value === '__auto__') || (!!f.required && isEmptyValue(value, f.type)));

  // a field its dependents may read : shown and evaluated, with its value filled in if required
  const settled = (name) => {
    const s = st[name];
    if (!s) return true;
    if (s.status === 'hidden' || s.status === 'error') return true;
    if (s.status === 'resolved') return !s.needsInput;
    return false;
  };
  const ctx = {
    values: vals,
    fieldOptions,
    isReady: (name) => {
      const s = st[name];
      return !s || s.status === 'resolved' || s.status === 'error';
    },
    secretNames: fields.filter((f) => f.type === 'password').map((f) => f.name),
  };
  const hasValue = (name) => st[name]?.status === 'resolved' || st[name]?.status === 'error';
  // a `dependencies: [{ name, isValid }]` check : the browser's !v$.form[name].$invalid. A
  // hidden field is neither valid nor invalid there (dependencyOk is false), so both
  // isValid: true and isValid: false fail on it - undefined equals neither.
  const validityUsed = {};
  const isValid = (name) => {
    if (st[name]?.status === 'hidden') return undefined;
    if (!hasValue(name) || !byName[name]) return false;
    const ok = validateField(byName[name], vals[name], ctx, fields).errors.length === 0;
    validityUsed[name] = ok;
    return ok;
  };

  function computeDefault(f) {
    if (f.default === undefined) return undefined;
    const evalDefault = fieldOptions[f.name].evalDefault;
    const r = replacePlaceholderInString(f.default, ctx, false, evalDefault ? 'expression' : 'raw');
    if (r.value === undefined) return undefined;
    if (!evalDefault) return r.value;
    try {
      return evalSandbox(r.value);
    } catch (err) {
      warnings.push(`'${f.name}' : evaluating the default failed : ${err.message}`);
      return undefined;
    }
  }

  /**
   * Turn a choice into what the browser's select holds : the selected option RECORD(S).
   *
   * A caller may send the valueColumn value ("bb8") or a partial record ({name: "vol1"})
   * instead of the whole option. Expressions and queries downstream read other columns of
   * that record ($(cluster.management_ip)), so the bare value must be looked up in the
   * options and replaced by the full record - otherwise it reaches them as a string, and a
   * query resolves "bb8" as a host name. A value that matches no option is flagged, and the
   * form is not complete while it is (the browser's select cannot hold such a value).
   */
  function applyChoice(f, s, patch, inputValue) {
    // `__all__` on a multiple select picks every option (BsInputSelectAdvancedTable)
    if (patch.value === '__all__' && f.multiple) {
      patch.value = [...(s.options || [])];
      return;
    }
    const options = s.options || [];
    const vc = f.valueColumn || "";
    const pick = (v) => {
      if (v === undefined || v === null || SENTINELS.includes(v)) return { v, ok: true };
      let hit = options.find((o) => optionMatches(o, v, vc));
      // a scalar on a field without valueColumn : the column the user sees (previewColumn),
      // then the listed columns, then - only if unambiguous - any column holding it.
      // Without this, "bb8" was compared with the record's FIRST key (management_ip).
      if (hit === undefined && (typeof v !== 'object')) {
        const isRec = (o) => o && typeof o === 'object';
        for (const k of [...new Set([f.previewColumn, ...(f.columns || [])].filter(Boolean))]) {
          hit = options.find((o) => isRec(o) && o[k] === v);
          if (hit !== undefined) break;
        }
        if (hit === undefined) {
          const any = options.filter((o) => isRec(o) && Object.values(o).includes(v));
          if (any.length === 1) hit = any[0];
        }
      }
      // a partial record : the option whose columns agree on every key that was sent
      if (hit === undefined && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
        hit = options.find((o) => o && typeof o === 'object'
          && Object.keys(v).every((k) => JSON.stringify(o[k]) === JSON.stringify(v[k])));
      }
      return hit !== undefined ? { v: hit, ok: true } : { v, ok: false };
    };
    let ok = true;
    if (Array.isArray(patch.value)) {
      patch.value = patch.value.map((v) => { const p = pick(v); ok = ok && p.ok; return p.v; });
    } else {
      const p = pick(patch.value);
      ok = p.ok;
      patch.value = p.v;
    }
    if (!ok && has(f.name) && !isEmptyValue(inputValue, f.type)) {
      warnings.push(`'${f.name}' : the given value is not one of the available options`);
      patch.notInOptions = true;
    }
  }

  function finish(f, patch) {
    const s = st[f.name];
    Object.assign(s, patch);
    s.needsInput = s.status === 'resolved' && needsInput(f, s.value);
    vals[f.name] = s.value;
  }

  /** a dynamic field's expression or query, run : { ok, result } or { ok: false, missing | error } */
  async function runSource(f) {
    const isExpression = !!f.expression;
    const r = replacePlaceholderInString(
      isExpression ? f.expression : f.query, ctx, !!f.ignoreIncomplete, isExpression ? 'expression' : 'raw');
    if (r.value === undefined) return { ok: false, missing: r.missing };
    try {
      if (isExpression && f.runLocal) {
        const code = (r.value.at(0) == "{" && r.value.at(-1) == "}") ? `Object.assign(${r.value})` : r.value;
        return { ok: true, result: evalSandbox(code) };
      }
      if (isExpression) return { ok: true, result: await services.serverExpression(r.value, f) };
      return { ok: true, result: await services.query(f, r.resolved) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * The rows a list (or the object a yaml+subform field) holds when nobody edited it : its
   * default, else its expression or query - as the browser fills it. null when that cannot
   * be evaluated : then no untouched row counts as the source's.
   */
  async function sourceRowsOf(f, dflt) {
    if (dflt !== undefined) return [].concat(dflt);
    if (!f.expression && !f.query) return [];
    const src = await runSource(f);
    return src.ok ? [].concat(src.result ?? []) : null;
  }

  async function evaluate(f) {
    const dflt = computeDefault(f);
    const s = st[f.name];
    s.default = dflt;
    const inputValue = has(f.name) ? input[f.name] : undefined;

    if (verifyUntouched && (f.type === 'list' || (f.type === 'yaml' && f.subform)) && has(f.name)) {
      s.sourceRows = await sourceRowsOf(f, dflt);
    }

    if (!isDynamicField(f)) {
      let value = has(f.name) ? inputValue : dflt;
      if (value === undefined && f.type === 'checkbox') value = false;
      if (value === undefined && f.type === 'list') value = [];
      const patch = { status: 'resolved', value, source: has(f.name) ? 'input' : 'default' };
      if (f.type === 'enum' && Array.isArray(f.values)) {
        s.options = f.values;
        applyChoice(f, s, patch, inputValue);
      }
      return finish(f, patch);
    }

    // a static `value:` on an expression/yaml field
    if (!f.expression && !f.query) {
      const value = (f.type === 'expression' || f.type === 'yaml') ? f.value : (has(f.name) ? inputValue : dflt);
      return finish(f, { status: 'resolved', value, source: 'computed' });
    }

    const computesValue = valueComputed(f);
    if (VALUE_TYPES.includes(f.type) && !computesValue) {
      // editable expression / edited list : the caller's value stands
      return finish(f, { status: 'resolved', value: inputValue, source: 'input' });
    }
    const optionValue = () => (has(f.name) ? inputValue : dflt);
    const fallback = () => (computesValue ? dflt : optionValue());

    const isExpression = !!f.expression;
    const src = await runSource(f);
    if (!src.ok && src.missing) {
      warnings.push(`'${f.name}' could not be evaluated : a field it refers to never produced a value (${src.missing.join(', ')})`);
      return finish(f, { status: 'error', error: `unresolved placeholder(s) : ${src.missing.join(', ')}`, value: fallback(), source: 'default' });
    }
    if (!src.ok) {
      return finish(f, { status: 'error', error: src.error, value: fallback(), source: 'default' });
    }
    const result = src.result;

    const patch = { status: 'resolved', source: 'computed' };
    if (isExpression) {
      if (['html', 'expression', 'yaml'].includes(f.type)) patch.value = result;
      if (f.type === 'enum') s.options = [].concat(result ?? []);
      if (f.type === 'list') patch.value = (dflt ? [].concat(dflt) : [].concat(result ?? []));
      if (result == undefined && dflt != undefined && f.type === 'expression') {
        patch.value = dflt;
        patch.source = 'default';
      }
    } else {
      if (f.type === 'query' || f.type === 'enum') s.options = [].concat(result ?? []);
      else if (f.type === 'list') patch.value = [].concat(result ?? []);
      else patch.value = result;
    }
    if (OPTION_TYPES.includes(f.type)) {
      patch.value = optionValue();
      patch.source = has(f.name) ? 'input' : 'default';
      applyChoice(f, s, patch, inputValue);
    }
    return finish(f, patch);
  }

  /**
   * The rows of a list field, each through its subform - as the browser's row editor does,
   * with the parent's values as __parent__. Only rows the user added or edited are resolved
   * (they carry __output__ from the editor, or an insert/update marker) : a row the list's
   * own expression produced is sent as it is, in the browser too. With `allRows` (the MCP
   * server) every row is resolved : an agent's rows never went through an editor. A row marked deleted is
   * kept as it is. Server-computed row fields win ; the markers stay ; __output__ is rebuilt.
   *
   * A `yaml` field with a subform is ONE such row : an object the browser edits through the
   * same subform editor, output through its __output__. It is resolved the same way ; its
   * failures are reported with `index: null`.
   */
  // password fields shown in the resolved rows (`acls[1].token`) - a relaunch needs to know
  const rowPasswordsVisible = [];

  async function resolveRows(f) {
    const s = st[f.name];
    const sub = subformOf(f);
    if (s.status !== 'resolved' || !sub || !Array.isArray(sub.fields)) return;
    const single = f.type === 'yaml';
    const value = vals[f.name];
    if (single ? !(value && typeof value === 'object' && !Array.isArray(value)) : !Array.isArray(value)) return;
    const m = single ? { insert: '', update: '', delete: '' } : listMarkers(f);
    const markerKeys = [m.insert, m.update, m.delete].filter(Boolean);
    const strip = (row) => {
      const out = {};
      for (const [k, v] of Object.entries(row || {})) if (k !== '__output__' && !markerKeys.includes(k)) out[k] = v;
      return canonicalJson(out);
    };
    const sourceKeys = verifyUntouched && Array.isArray(s.sourceRows) ? new Set(s.sourceRows.map(strip)) : null;
    const editorTouched = (row) => '__output__' in row || (m.insert && row[m.insert]) || (m.update && row[m.update]);
    // a row to resolve : any the editor touched ; with allRows, every one ; with
    // verifyUntouched, an untouched one that the list's own source does not produce
    const touched = (row) => row && typeof row === 'object' && !(m.delete && row[m.delete])
      && (allRows || editorTouched(row) || (verifyUntouched && !(sourceKeys && sourceKeys.has(strip(row)))));
    const rows = single ? [value] : value;
    const todo = rows.filter(touched).length;
    if (todo > rowBudget.left) {
      rowBudget.left = 0;
      s.error = `too many list rows to resolve (more than ${MAX_LIST_ROWS} in one launch)`;
      s.rowsRefused = true;
      return;
    }
    rowBudget.left -= todo;
    const { __user__, ...parentValues } = vals; // eslint-disable-line no-unused-vars
    const rowServices = typeof services.forSubform === 'function' ? services.forSubform(sub.name) : services;
    const failing = [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!touched(row)) { out.push(row); continue; }
      const input = {};
      for (const [k, v] of Object.entries(row)) if (k !== '__output__' && !markerKeys.includes(k)) input[k] = v;
      const res = await resolveForm({
        form: sub, constants, vars, user, parent: parentValues, values: input,
        services: rowServices, subforms: allSubforms, rowBudget, allRows, verifyUntouched,
      });
      const resolved = {};
      for (const sf of sub.fields || []) if (sf?.name) resolved[sf.name] = res._values[sf.name];
      const output = buildFormOutput(sub.fields, resolved, { subforms: allSubforms });
      for (const k of markerKeys) if (row[k]) { resolved[k] = row[k]; output[k] = row[k]; }
      resolved.__output__ = output;
      out.push(resolved);
      if (!res.complete) {
        failing.push({
          index: single ? null : i,
          ...(res.missing.length ? { missing: res.missing } : {}),
          ...(res.invalid.length ? { invalid: res.invalid } : {}),
          ...(res.waiting.length ? { waiting: res.waiting } : {}),
          ...(Object.keys(res.validationErrors).length ? { validationErrors: res.validationErrors } : {}),
          ...(Object.keys(res.rowErrors).length ? { rowErrors: res.rowErrors } : {}),
        });
      }
      for (const pw of res._passwordsVisible || []) rowPasswordsVisible.push(`${f.name}${single ? '' : `[${i}]`}.${pw}`);
      for (const w of res.warnings) {
        const tagged = `${f.name}${single ? '' : `[${i}]`} : ${w}`;
        if (!warnings.includes(tagged)) warnings.push(tagged);
      }
    }
    vals[f.name] = single ? out[0] : out;
    s.value = vals[f.name];
    if (failing.length) s.rows = failing;
  }

  // dependency-ordered fill : whatever can be evaluated now, then whatever that unlocked
  const pending = () => fields.filter((f) => st[f.name].status === 'pending');
  const visibilityDeps = (f) => (f.dependencies || [])
    .map((d) => rootFieldName(d?.name?.startsWith('!') ? d.name.slice(1) : d?.name))
    .filter((n) => byName[n]);
  let released = false;
  for (let guard = 0; guard < fields.length * 3 + 10; guard++) {
    let progress = false;
    for (const f of pending()) {
      const exempt = released && (f.ignoreIncomplete || cycle.has(f.name));
      if (f.dependencies) {
        if (!exempt && !visibilityDeps(f).every(settled)) continue;
        if (!checkDependencies(f, vals, fieldOptions, isValid)) {
          st[f.name] = { status: 'hidden', value: undefined, source: 'hidden' };
          vals[f.name] = undefined;
          progress = true;
          continue;
        }
      }
      if (!exempt && !(graph.dependsOn[f.name] || []).every(settled)) continue;
      await evaluate(f);
      if (hasRows(f)) await resolveRows(f);
      progress = true;
    }
    if (progress) { released = false; continue; }
    // stuck : let ignoreIncomplete and cyclic fields go with what there is, once
    if (!released && pending().some((f) => f.ignoreIncomplete || cycle.has(f.name))) {
      released = true;
      continue;
    }
    break;
  }
  for (const f of pending()) {
    st[f.name] = {
      status: 'waiting',
      waitingFor: [...new Set([...(graph.dependsOn[f.name] || []), ...visibilityDeps(f)])].filter((n) => !settled(n)),
    };
  }

  // validation, on the settled values : every shown field that has a value (a waiting
  // field is reported as waiting, not as invalid)
  for (const f of fields) {
    const s = st[f.name];
    if (!hasValue(f.name)) continue;
    const v = validateField(f, vals[f.name], ctx, fields);
    s.validationErrors = v.errors;
    for (const w of v.warnings) if (!warnings.includes(w)) warnings.push(w);
    if (f.name in validityUsed && validityUsed[f.name] !== (v.errors.length === 0)) {
      warnings.push(`'${f.name}' : its validity changed after a field depending on it was shown or hidden (a validation that depends back on it) ; visibility may differ from the browser`);
    }
  }

  // report
  const out = [];
  for (const f of fields) {
    const s = st[f.name];
    if (s.status === 'skipped') continue;
    const r = {
      name: f.name,
      label: f.label || f.name,
      type: f.type,
      required: !!f.required,
      visible: s.status !== 'hidden',
      status: s.status,
      source: s.source,
    };
    if (s.status === 'resolved' || s.status === 'error') {
      r.value = (f.type === 'password' && s.value) ? '********' : s.value;
      r.needsInput = !!s.needsInput;
    }
    if (s.default !== undefined) r.default = f.type === 'password' ? '********' : s.default;
    if (s.options) {
      r.optionCount = s.options.length;
      r.options = s.options.slice(0, maxOptions);
      if (s.options.length > maxOptions) r.optionsTruncated = true;
    }
    if (s.notInOptions) r.notInOptions = true;
    if (s.validationErrors?.length) r.validationErrors = s.validationErrors;
    if (s.rows?.length) r.rows = s.rows;
    if (s.error) r.error = s.error;
    if (s.waitingFor) r.waitingFor = s.waitingFor;
    out.push(r);
  }
  const missing = out.filter((r) => r.needsInput).map((r) => r.name);
  // a required field that is simply empty is `missing` ; `invalid` is what a value breaks
  const invalid = out.filter((r) => r.visible
    && (r.notInOptions || (r.validationErrors?.length && !r.needsInput) || r.rows?.length
      || st[r.name]?.rowsRefused)).map((r) => r.name);
  const waiting = out.filter((r) => r.status === 'waiting').map((r) => r.name);
  const validationErrors = Object.fromEntries(out
    .filter((r) => r.visible && r.validationErrors?.length && !r.needsInput)
    .map((r) => [r.name, r.validationErrors]));
  return {
    form: form?.name,
    complete: missing.length === 0 && waiting.length === 0 && invalid.length === 0,
    missing,
    waiting,
    invalid,
    validationErrors,
    // failing list rows, per list field : [{ index, missing, invalid, waiting, validationErrors }]
    rowErrors: Object.fromEntries(out.filter((r) => r.visible && r.rows?.length).map((r) => [r.name, r.rows])),
    fields: out,
    warnings,
    // internal : the raw values and visibility the launch builds its extravars from
    _values: { ...vals },
    _visibility: Object.fromEntries(fields.map((f) => [f.name, st[f.name].status !== 'hidden'])),
    _fields: fields,
    // the password fields that are shown (not hidden by their dependencies), rows included
    _passwordsVisible: [
      ...fields.filter((f) => f.type === 'password' && st[f.name].status !== 'hidden' && st[f.name].status !== 'skipped').map((f) => f.name),
      ...rowPasswordsVisible,
    ],
  };
}

export default { resolveForm, normalizeFields, isDynamicField, DEFAULT_MAX_OPTIONS };
