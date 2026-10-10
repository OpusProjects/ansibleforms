'use strict';
import Form from '../models/form.model.js';

/**
 * Who may run what through the query endpoints.
 *
 * A query is bound to a form field : an ordinary user cannot send SQL of their own to a
 * configured database, with the stored credential's privileges. Only a settings user may
 * run a raw query.
 */

// Which characters a value has to be protected against depends on the ENGINE, and this
// product talks to five of them (query.model.js dispatches on the credential's db_type).
//
//  - mysql/mariadb treat a backslash as an escape character, so `x\` pasted before the
//    author's closing quote would swallow it. Doubling it is REQUIRED there.
//  - postgres (standard_conforming_strings, the default since 9.1), mssql and oracle do
//    NOT. Doubling a backslash there is not a safety measure, it is data corruption -
//    `DOMAIN\user` and `C:\path` are exactly the values this product carries around.
//  - mongodb is not SQL at all : mongodb.js JSON.parses the query, so a value has to be
//    escaped for a JSON string body. Doubling a single quote did nothing there while an
//    embedded double quote broke the document outright.
//
// Listed by the engines that DO NOT need the backslash doubled, never by the ones that do,
// so anything unknown or absent gets the strictest rules. That is the direction to fail in:
// over-escaping is a wrong value, under-escaping is an injection - and it matches
// query.model.js's own `cred.db_type || "mysql"` default. (query.model.js refuses an
// unrecognised type outright, so this is belt and braces, but this function is the one
// place that decides and it should not depend on that.)
const BACKSLASH_IS_LITERAL = new Set(['postgres', 'mssql', 'oracle']);
const JSON_DIALECTS = new Set(['mongodb']);

/**
 * Escape a value being substituted into a query string literal.
 *
 * The placeholders are pasted into the query text, and there is no position-independent
 * way to parameterise `$(x)` when it may appear anywhere - inside an IN list, a LIKE
 * pattern, a column list - so the value is escaped instead. Doubling the quote is the SQL
 * standard; the backslash is engine-specific, see above.
 *
 * This makes a QUOTED placeholder safe, which is the documented form. An unquoted one
 * (`LIMIT $(n)`) is still substituted as text, so quote your placeholders.
 *
 * @param {string} [dialect] the datasource's db_type, as query.model.js resolved it
 */
export function escapeSqlValue(value, dialect = 'mysql') {
  if (value === null || value === undefined) return '';
  // A non-finite number has no SQL literal: String(NaN) is 'NaN', which MySQL parses as
  // an IDENTIFIER, so `WHERE n = $(n)` became `WHERE n = NaN` - "Unknown column 'NaN'".
  // Treated as absent, like null. Not reachable over HTTP (JSON has no NaN or Infinity
  // literal - stringify emits null and parse rejects the word) but this function is the
  // one place that decides what a value becomes, so it should not depend on that.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  // an object/array placeholder is used as json in a query, matching the client's own
  // stringifyValue - escape the result, it is still going into a string literal
  const text = (typeof value === 'object') ? JSON.stringify(value) : String(value);
  const type = String(dialect || 'mysql').toLowerCase();
  if (JSON_DIALECTS.has(type)) {
    // the body of a JSON string, without its surrounding quotes : this covers the
    // backslash, the double quote and the control characters in one go
    return JSON.stringify(text).slice(1, -1);
  }
  if (BACKSLASH_IS_LITERAL.has(type)) return text.replace(/'/g, "''");
  // the backslash first, or the doubling would escape the quotes we just doubled
  return text.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Substitute `$(name)` from the supplied values, escaped. An unknown name is left alone.
 *
 * `values` is keyed by the RAW placeholder text, not by field name : the client resolves
 * every placeholder itself (AppForm.replacePlaceholderInString) and sends the result under
 * the exact key that appears between the brackets. That is what makes the documented forms
 * work - `$(city.name)` dot notation, `$(myarray[0].name)` paths, and `placeholderColumn`,
 * which turns a bare `$(city)` into that record's chosen column. Re-deriving any of that
 * from a flat field map here would be a second implementation of a rich, undocumented
 * resolver, and it silently got all three wrong.
 *
 * @param {string} [dialect] passed through to escapeSqlValue
 */
export function substitute(template, values, dialect = 'mysql') {
  const out = String(template).replace(/\$\(([^)]+)\)/g, (whole, name) => {
    // A name we have nothing for is left alone, so a typo shows up as itself rather than
    // as a silent empty string. A key that IS present but holds null/undefined is a
    // resolved value and substitutes.
    if (!values || !Object.prototype.hasOwnProperty.call(values, name)) return whole;
    return escapeSqlValue(values[name], dialect);
  });
  // The client's own sentinels for a placeholder that resolved to nothing, kept identical
  // here so an `ignoreIncomplete` field behaves the same whichever side substitutes.
  return out
    .replaceAll("'__undefined__'", 'undefined')
    .replaceAll('__undefined__', 'undefined')
    .replaceAll("'__null__'", 'null')
    .replaceAll('__null__', 'null');
}

/** An error carrying the status the caller should answer with. */
export class QueryPolicyError extends Error {
  constructor(statusCode, message, detail) {
    super(message);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

// Read `a.b[0].c` out of an object without eval, mirroring Helpers.replacePlaceholders on
// the client. Only ever applied to config constants and varsFiles data, which are plain
// yaml - never to a request body.
function readPath(root, expr) {
  const parts = String(expr).replaceAll('[', '.').replaceAll(']', '.').split('.').filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

// The name a placeholder is rooted at : `city.name` -> `city`, `rows[0].id` -> `rows`.
function rootOf(name) {
  return String(name).split(/[.[]/)[0];
}

/**
 * The values a form-bound query may be substituted with.
 *
 * The client resolves the placeholders and sends what it resolved, which is right for
 * FIELD values - they are the user's own input, and the server has no runtime form state.
 * It is NOT right for constants: `constants:` in config.yaml exists precisely so a value
 * is fixed by the configuration rather than chosen by the caller, and a query like
 * `WHERE tenant = '$(TENANT_ID)'` is a scoping rule. Taking that from the body let a
 * caller pick their own tenant.
 *
 * So every placeholder whose ROOT names a constant (or a varsFiles key, injected the same
 * way) is resolved here from the loaded configuration, and the body's value for it is
 * discarded. Constants win over a same-named field, matching the client, where the
 * constants block is applied after the fields.
 */
export function authoritativeValues(template, clientValues, formConfig, formObj) {
  const values = { ...(clientValues && typeof clientValues === 'object' ? clientValues : {}) };
  const fixed = { ...(formConfig?.constants || {}), ...(formObj?.vars || {}) };
  if (Object.keys(fixed).length === 0) return values;
  for (const match of String(template).matchAll(/\$\(([^)]+)\)/g)) {
    const name = match[1];
    const root = rootOf(name);
    if (!Object.prototype.hasOwnProperty.call(fixed, root)) continue;
    values[name] = readPath(fixed, name);
  }
  return values;
}

/**
 * Find the field a request is asking about.
 *
 * A subform is not reachable as a form of its own : the schema forbids it from carrying
 * `roles` at all, so checkFormRole denies it to every non-admin and Form.load THROWS
 * AccessDeniedError for it. The client renders wizard steps and list rows with the subform
 * as its `currentForm`, so sending that name straight through answered 500 on every query
 * field inside a wizard or a list row - for everyone except an admin, who short-circuits
 * the role check and so never saw it.
 *
 * The caller therefore names the ROOT form, which carries the roles, and the subform
 * separately. Authorization is the root form's, which is exactly the rule Form.load
 * already documents for inlining subforms: they are only reachable through a form's own
 * field tree.
 */
export function findFieldOwner(formConfig, formObj, subformName) {
  if (!subformName) return formObj;
  // Form.load inlines every referenced subform (recursively, so nested ones are in here
  // too) when a single form is requested
  const sub = (formObj.subforms || []).find((s) => s && s.name === subformName);
  return sub || null;
}

/**
 * Decide what query actually runs for a request, and refuse the ones that may not.
 *
 * Form-bound (formName + fieldName): the query TEXT comes from the form definition,
 * loaded with the CALLER's own roles, so a form they may not see cannot be reached and
 * the body cannot choose the SQL or the datasource. `subformName` selects a subform
 * inlined into that form.
 *
 * Raw (a `query` in the body): allowed only with showSettings. The designer previews
 * queries that way while authoring, and that user can already rewrite the whole config.
 *
 * @returns {Promise<{query: string, config: string, jq: string, values: object|null}>}
 *   `query` is the TEMPLATE when it came from a form ; substitution is deferred to
 *   Query.findAll, which is the only layer that knows each datasource's engine and so
 *   the only one that can escape correctly. `values` is null for a raw query.
 * @throws {QueryPolicyError} 403 when a raw query is not allowed, 404 when the form or
 *         field cannot be resolved, 400 when no datasource ends up selected.
 */
export async function resolveQuery(req) {
  const user = req?.user?.user || {};
  const body = req?.body || {};

  let query = body.query;
  let config = body.config;
  let jq = body.jq || '';
  let values = null;

  if (body.formName && body.fieldName) {
    return resolveFormQuery({
      user,
      formName: body.formName,
      subformName: body.subformName,
      fieldName: body.fieldName,
      values: body.values,
    });
  } else if (!user.options?.showSettings) {
    throw new QueryPolicyError(403, 'noAccess',
      'A raw query may only be run by a user with settings access. Send formName and fieldName to run a query defined on a form.');
  }

  if (!config) {
    throw new QueryPolicyError(400, 'missingDbConfig');
  }
  return { query, config, jq, values };
}

/**
 * The form-bound half of resolveQuery, callable without an http request (the MCP server
 * uses it). Same rules : the query text, datasource and jq come from the form definition
 * loaded with the caller's roles, constants/varsFiles placeholders are taken from the
 * configuration, only field values come from the caller.
 *
 * @param {object} args
 * @param {object} args.user          the authenticated user (req.user.user)
 * @param {string} args.formName      the ROOT form, which carries the roles
 * @param {string} [args.subformName] a subform inlined into that form
 * @param {string} args.fieldName
 * @param {object} [args.values]      resolved placeholder values, keyed by raw placeholder text
 * @param {object} [args.formConfig]  an already loaded Form.load(user.roles, formName) result
 * @returns {Promise<{query: string, config: string, jq: string, values: object}>}
 */
export async function resolveFormQuery({ user, formName, subformName, fieldName, values, formConfig }) {
  const loaded = formConfig || await Form.load((user || {}).roles, formName);
  const formObj = loaded?.forms?.[0];
  if (!formObj) {
    throw new QueryPolicyError(404, `Form '${formName}' not found or you do not have access to it`);
  }
  const owner = findFieldOwner(loaded, formObj, subformName);
  if (!owner) {
    throw new QueryPolicyError(404, `Subform '${subformName}' is not part of form '${formName}'`);
  }
  const field = (owner.fields || []).find(f => f.name === fieldName);
  if (!field || !field.query) {
    throw new QueryPolicyError(404, `Field '${fieldName}' has no query on form '${owner.name}'`);
  }
  const query = field.query;
  const config = field.dbConfig;
  if (!config) {
    throw new QueryPolicyError(400, 'missingDbConfig');
  }
  return {
    query,
    config,
    jq: field.jq || '',
    values: authoritativeValues(query, values, loaded, owner),
  };
}

export default { escapeSqlValue, substitute, resolveQuery, resolveFormQuery, QueryPolicyError };
