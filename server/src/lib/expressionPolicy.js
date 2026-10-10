'use strict';
import Form from '../models/form.model.js';
import { QueryPolicyError, authoritativeValues, findFieldOwner } from './queryPolicy.js';
import { spliceExpressionValues } from './formEngine/placeholders.js';

/**
 * Who may evaluate what through POST /api/v2/expression.
 *
 * The endpoint used to evaluate whatever expression text the body contained, for any
 * authenticated user. A server expression can call every fn.* helper with the server's
 * reach - fn.fnCredentials returns a stored credential with its password - so any user
 * could read any credential or secret store reference without a form ever offering it.
 *
 * It is now bound to the form, exactly like the query endpoint (see queryPolicy.js): the
 * client sends formName + fieldName + the values its placeholders resolved to, and the
 * server takes the EXPRESSION TEXT from the definition, loaded with the caller's own roles.
 * What a form's expression does is the architect's decision and keeps working unchanged ;
 * the caller only supplies data.
 *
 * A raw expression in the body is still accepted from a user with showSettings or
 * showDesigner : they write the forms and can already put any expression in one.
 */

// the field types the browser evaluates itself (AppForm's aliases) - never on the server
const LOCAL_TYPES = new Set(['local', 'local_out', 'credential', 'html']);

/**
 * Decide what expression actually runs for a request, and refuse the ones that may not.
 *
 * @returns {Promise<{expression: string, noLog: boolean}>}
 * @throws {QueryPolicyError} 403 for a raw expression without the rights, 404 when the
 *         form or field cannot be resolved
 */
export async function resolveExpression(req) {
  const user = req?.user?.user || {};
  const body = req?.body || {};
  const noLog = req?.query?.noLog == "true";
  const mayRunRaw = !!(user.options?.showSettings || user.options?.showDesigner);

  // a designer previewing an unsaved form has no definition to bind to yet - and may write
  // any expression into one anyway - so their raw text is evaluated as it always was
  if (mayRunRaw && typeof body.expression === 'string') {
    return { expression: body.expression, noLog };
  }
  if (body.formName && body.fieldName) {
    const resolved = await resolveFormExpression({
      user,
      formName: body.formName,
      subformName: body.subformName,
      fieldName: body.fieldName,
      values: body.values,
      literals: body.literals,
    });
    return { expression: resolved.expression, noLog: noLog || resolved.noLog };
  }
  if (!mayRunRaw) {
    throw new QueryPolicyError(403, 'noAccess',
      'A raw expression may only be run by a user with settings or designer access. Send formName and fieldName to run an expression defined on a form.');
  }
  return { expression: body.expression, noLog };
}

/**
 * The form-bound half of resolveExpression. Same rules as resolveFormQuery : the text comes
 * from the definition loaded with the caller's roles, constants, varsFiles and __user__ come
 * from the configuration and the token, only field values come from the caller.
 */
export async function resolveFormExpression({ user, formName, subformName, fieldName, values, literals, formConfig }) {
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
  if (!field || !field.expression || field.runLocal || LOCAL_TYPES.has(field.type)) {
    throw new QueryPolicyError(404, `Field '${fieldName}' has no server expression on form '${owner.name}'`);
  }
  const expression = field.expression;
  const fixed = { ...(loaded?.constants || {}), ...(owner?.vars || {}) };
  const asSource = new Set(Array.isArray(literals) ? literals.map(String) : []);

  // constants and varsFiles data : the configuration's value, spliced the way the browser
  // splices a constant - an object (or a path into one) as JSON, a scalar as a value
  const vals = authoritativeValues(expression, values, loaded, owner);
  for (const match of String(expression).matchAll(/\$\(([^)]+)\)/g)) {
    const name = match[1];
    const root = name.split(/[.[]/)[0];
    if (root === '__user__') {
      // who is asking is the token's answer, never the body's
      const path = name.slice(root.length).replace(/^\./, '');
      vals[name] = path ? readUserPath(user, path) : user;
      asSource.add(name);
    } else if (Object.prototype.hasOwnProperty.call(fixed, root)) {
      if (fixed[root] !== null && typeof fixed[root] === 'object') asSource.add(name);
      else asSource.delete(name);
    }
  }
  return { expression: spliceExpressionValues(expression, vals, [...asSource]), noLog: !!field.noLog };
}

function readUserPath(user, path) {
  let cur = user;
  for (const part of path.replaceAll('[', '.').replaceAll(']', '.').split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

export default { resolveExpression, resolveFormExpression };
