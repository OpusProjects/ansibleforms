'use strict';
import fs from 'fs';
import path from 'path';
import { resolveForm } from './formEngine/resolve.js';
import { readModelPath, buildLaunchPayload, buildFormOutput, canonicalJson } from './formEngine/output.js';

/**
 * Validate a launch that came in over the REST API against the form definition, with the
 * same engine and rules as the browser and the MCP server (LAUNCH_VALIDATION), and build the
 * extravars and credentials the server would submit for it.
 *
 * The browser sends `rawFormData` - the raw field values - next to the modelled extravars ;
 * those raw values are what the rules apply to. Three gaps are filled in :
 *   - password fields are never in rawFormData (form.vue getFilteredRawFormData) ; their
 *     value is read back from the extravars, at the field's model path ;
 *   - constant fields are not in it either ; the engine fills them from the form ;
 *   - a file is a serialised File there ({}) ; the upload itself arrives in `files` (the
 *     result of POST /api/v2/job/upload) and is verified against the upload folder.
 * A wizard sends its step drafts instead (`{ __wizard__: true, drafts, skipped }`) ; each
 * shown step is checked as a subform of its own, see validateWizardLaunch.
 *
 * Nothing here decides what happens with the result - Job.launch logs, refuses, or runs the
 * server-built payload.
 *
 * @returns {Promise<{ skipped?: string, ok?: boolean, errors?: object, warnings?: string[],
 *   payload?: { extravars: object, credentials: object } }>}
 */
export async function validateLaunch({ formConfig, formObj, user, rawFormData, extravars, files, uploadPath, services, allRows = false, verifyUntouched = false }) {
  if (Array.isArray(formObj?.wizard) && formObj.wizard.length > 0) {
    return validateWizardLaunch({ formConfig, formObj, user, rawFormData, extravars, services, allRows, verifyUntouched });
  }
  const values = { ...(rawFormData || {}) };
  for (const f of formObj?.fields || []) {
    if (f?.type !== 'password' || !f.name || f.name in values) continue;
    const at = [].concat(f.model || f.name)[0];
    const v = readModelPath(extravars || {}, at);
    if (v !== undefined) values[f.name] = v;
  }
  // a file field's value only ever comes from a verified upload : whatever the request put
  // in rawFormData for it (a serialised File is {}, a forged object names any path) is
  // dropped, so a required file without an upload is `missing`
  const uploads = verifyUploads(formObj, files, uploadPath);
  for (const f of formObj?.fields || []) {
    if (f?.type !== 'file' || !f.name) continue;
    const upload = uploads.verified[f.name];
    // what the browser's rules saw : a File, with a name and a size
    if (upload) values[f.name] = { ...upload, name: upload.originalname, size: upload.size };
    else delete values[f.name];
  }
  const res = await resolveForm({
    form: formObj,
    constants: formConfig?.constants || {},
    vars: formObj?.vars || {},
    user,
    values,
    services,
    subforms: formObj.subforms || [],
    allRows,
    verifyUntouched,
  });
  // an upload that did not check out is refused only when its field is shown
  const uploadErrors = uploads.errors.filter((e) => res._visibility[e.field]);
  const errors = {
    missing: res.missing,
    invalid: res.invalid,
    waiting: res.waiting,
    validationErrors: res.validationErrors,
    ...(Object.keys(res.rowErrors || {}).length ? { rowErrors: res.rowErrors } : {}),
    ...(uploadErrors.length ? { uploads: uploadErrors } : {}),
  };
  const passwordsVisible = res._passwordsVisible || [];
  if (!res.complete || uploadErrors.length) return { ok: false, errors, warnings: res.warnings, visibility: res._visibility, passwordsVisible };

  // through JSON, as the browser's payload travels : an empty field leaves no `undefined`
  // behind, so the job - and the comparison with the client's extravars - sees the same
  const built = buildLaunchPayload(res, formObj.subforms || [], { overrides: uploads.verified });
  const payload = JSON.parse(JSON.stringify(built));
  // the verbose flag is the one thing a browser adds to the output ; the controller has
  // already checked the user may use it
  if (extravars?.__verbose__) payload.extravars.__verbose__ = true;
  // the extravars keys of the verified uploads : the server writes them from the disk
  // (absolute path, its own destination), so a comparison with the browser's copy would
  // always differ - they were checked against the disk already
  const uploadKeys = Object.keys(uploads.verified)
    .map((n) => (formObj.fields || []).find((f) => f.name === n))
    .map((f) => String([].concat(f?.model || f?.name)[0]).split(/\s*\.\s*/)[0].replace(/\[[0-9]+\]$/, ''));
  return { ok: true, errors, warnings: res.warnings, payload, visibility: res._visibility, uploadKeys, passwordsVisible };
}

// ─── wizard forms ─────────────────────────────────────────────────────────────

/**
 * The model paths a wizard step's field writes, as form.vue builds them
 * (Helpers.buildWizardStepOutput) : under the step's defaultModel, unless a model starts
 * with "/" (written at the root).
 *
 * Args:
 *   field (object): the step's field.
 *   prefix (string): the step's defaultModel, trimmed of its dots ; '' for none.
 *
 * Returns:
 *   string|string[]: the model, in the shape the field declared it.
 */
export function stepModel(field, prefix) {
  const apply = (m) => {
    if (typeof m !== 'string') return m;
    if (m.startsWith('/')) return m.slice(1);
    return prefix ? `${prefix}.${m}` : m;
  };
  if (Array.isArray(field.model)) return field.model.map(apply);
  if (typeof field.model === 'string') return apply(field.model);
  return prefix ? `${prefix}.${field.name}` : field.name;
}

/**
 * Deep-merge `src` into `dst`, as the wizard combines its steps' output (Helpers.deepMerge) :
 * plain objects recurse, arrays and scalars overwrite.
 *
 * Args:
 *   dst (object): the output so far (mutated).
 *   src (object): a step's output.
 *
 * Returns:
 *   object: the merged output.
 */
function deepMerge(dst, src) {
  if (src == null || typeof src !== 'object' || Array.isArray(src)) return src;
  if (dst == null || typeof dst !== 'object' || Array.isArray(dst)) dst = {};
  for (const [k, v] of Object.entries(src)) {
    const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);
    dst[k] = plain(v) && plain(dst[k]) ? deepMerge(dst[k], v) : JSON.parse(JSON.stringify(v ?? null));
  }
  return dst;
}

/**
 * Whether a wizard step is shown, as form.vue evalWhen decides it : no `when`, shown ; else
 * every `$(path)` is replaced by the JSON of its value (read from `{ __parent__: drafts }`)
 * and the expression is run in the sandbox. A falsy result or an error hides the step.
 *
 * Args:
 *   when (string): the step's `when` expression.
 *   parent (object): the steps' values by step name.
 *   evalSandbox (function): the engine's sandbox.
 *
 * Returns:
 *   boolean: true when the step is shown.
 */
function stepShown(when, parent, evalSandbox) {
  if (!when || typeof when !== 'string') return true;
  try {
    const context = { __parent__: parent };
    const code = when.replace(/\$\(([^)]+)\)/g, (_, at) => {
      const v = readModelPath(context, at.trim());
      return v === undefined ? 'undefined' : JSON.stringify(v);
    });
    return !!evalSandbox(`(${code})`);
  } catch {
    return false;
  }
}

/**
 * Validate a wizard launch : every step the browser would submit is resolved against its
 * subform with the engine, and the extravars and credentials are rebuilt from the results.
 *
 * The browser sends `rawFormData` as `{ __wizard__: true, drafts: { step: values }, skipped:
 * { step: true } }`, the shape a stored wizard already has. A step is left out when it is
 * optional and skipped, or when its `when` is false ; every other step must be complete. A
 * step reads the others through `$(__parent__.<step>.<field>)` : the steps already checked
 * give their resolved values (defaults filled in), the others their draft. Password fields are not in the drafts ;
 * their value is read back from the extravars at the field's model path. File fields are
 * not supported in a wizard.
 *
 * Args:
 *   formConfig (object): the form's configuration (its constants).
 *   formObj (object): the wizard form, its subforms inlined.
 *   user (object): the launching user.
 *   rawFormData (object): the step drafts, as above.
 *   extravars (object): the extravars the client built.
 *   services (object): the engine's services (createFormServices).
 *   allRows (boolean): resolve every list row.
 *   verifyUntouched (boolean): check the rows the editor did not touch.
 *
 * Returns:
 *   Promise<object>: as validateLaunch : { ok, errors, payload } or { ok: false, reason }.
 */
export async function validateWizardLaunch({ formConfig, formObj, user, rawFormData, extravars, services, allRows = false, verifyUntouched = false }) {
  if (!rawFormData || rawFormData.__wizard__ !== true || !rawFormData.drafts || typeof rawFormData.drafts !== 'object') {
    return { ok: false, reason: 'a wizard launch must send its step drafts ({ __wizard__: true, drafts })' };
  }
  const drafts = rawFormData.drafts;
  const skipped = (rawFormData.skipped && typeof rawFormData.skipped === 'object') ? rawFormData.skipped : {};
  const subforms = formObj.subforms || [];
  const vars = formObj.vars || {};
  const steps = formObj.wizard.filter((raw) => raw && !raw.summary).map((raw) => ({
    name: raw.name || raw.subform,
    subformName: raw.subform,
    sub: subforms.find((s) => s?.name === raw.subform),
    prefix: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim().replace(/^\.+|\.+$/g, '') : '',
    when: raw.when || '',
    optional: raw.optional === true,
  }));
  // what a step reads as __parent__ : the varsFiles data, then every step's values
  const parent = { ...vars };
  for (const step of steps) {
    const draft = drafts[step.name];
    parent[step.name] = (draft && typeof draft === 'object' && !Array.isArray(draft)) ? draft : {};
  }

  let merged = {};
  const credentials = {};
  // the steps' errors in one set, each name as `<step>.<field>`
  const errors = { missing: [], invalid: [], waiting: [], validationErrors: {} };
  const rowErrors = {};
  const warnings = [];
  const passwordsVisible = [];
  let complete = true;
  for (const step of steps) {
    if (!step.sub || !Array.isArray(step.sub.fields)) continue;
    if (step.optional && skipped[step.name]) continue;
    if (!stepShown(step.when, parent, services.evalSandbox)) continue;

    // the step's own values : the draft, without what the client may not choose
    const values = { ...parent[step.name] };
    for (const f of step.sub.fields) {
      if (!f?.name) continue;
      if (f.type === 'constant' || f.type === 'file') delete values[f.name];
      if (f.type === 'password') {
        delete values[f.name];
        const v = readModelPath(extravars || {}, [].concat(stepModel(f, step.prefix))[0]);
        if (v !== undefined) values[f.name] = v;
      }
    }
    const { [step.name]: _self, ...others } = parent; // eslint-disable-line no-unused-vars
    const res = await resolveForm({
      form: { ...step.sub, name: step.name },
      constants: formConfig?.constants || {},
      vars,
      user,
      values,
      services: typeof services.forSubform === 'function' ? services.forSubform(step.subformName) : services,
      subforms,
      parent: { ...others, [step.name]: values },
      allRows,
      verifyUntouched,
    });
    warnings.push(...(res.warnings || []));
    passwordsVisible.push(...(res._passwordsVisible || []));
    // the later steps read this one's resolved values (its defaults filled in), not its draft
    const { __parent__, __user__, ...resolved } = res._values || {}; // eslint-disable-line no-unused-vars
    parent[step.name] = resolved;
    if (!res.complete) {
      complete = false;
      const at = (n) => `${step.name}.${n}`;
      errors.missing.push(...(res.missing || []).map(at));
      errors.invalid.push(...(res.invalid || []).map(at));
      errors.waiting.push(...(res.waiting || []).map(at));
      for (const [n, errs] of Object.entries(res.validationErrors || {})) errors.validationErrors[at(n)] = errs;
      for (const [n, rows] of Object.entries(res.rowErrors || {})) rowErrors[at(n)] = rows;
      continue;
    }
    const wrapped = res._fields.map((f) => ({ ...f, model: stepModel(f, step.prefix) }));
    const output = buildFormOutput(wrapped, res._values, {
      isVisible: (f) => !!res._visibility[f.name],
      subforms,
    });
    merged = deepMerge(merged, output);
    for (const f of res._fields) if (f.asCredential === true) credentials[f.name] = res._values[f.name];
  }
  if (Object.keys(rowErrors).length) errors.rowErrors = rowErrors;
  if (!complete) return { ok: false, errors, warnings, passwordsVisible };

  const payload = JSON.parse(JSON.stringify({ extravars: merged, credentials }));
  if (extravars?.__verbose__) payload.extravars.__verbose__ = true;
  return { ok: true, errors, warnings, payload, uploadKeys: [], passwordsVisible };
}

/**
 * The uploads a launch refers to, checked against the upload folder : the path must be a
 * file inside it. Path, name and size come from the disk, never from the request ; only the
 * descriptive original name, mime type and encoding are the client's.
 *
 * @returns {{ verified: object, errors: {field, reason}[] }}
 */
export function verifyUploads(formObj, files, uploadPath) {
  const verified = {};
  const errors = [];
  const root = path.resolve(uploadPath || '');
  for (const f of formObj?.fields || []) {
    if (f?.type !== 'file' || !f.name) continue;
    const upload = files?.[f.name];
    if (!upload || typeof upload !== 'object') continue;
    if (!uploadPath || typeof upload.path !== 'string' || !upload.path) {
      errors.push({ field: f.name, reason: 'the upload has no path' });
      continue;
    }
    const resolved = path.resolve(upload.path);
    if (!resolved.startsWith(root + path.sep)) {
      errors.push({ field: f.name, reason: 'the upload is not in the upload folder' });
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      stat = null;
    }
    if (!stat?.isFile()) {
      errors.push({ field: f.name, reason: 'the uploaded file does not exist' });
      continue;
    }
    verified[f.name] = {
      fieldname: 'file',
      originalname: String(upload.originalname ?? path.basename(resolved)),
      encoding: String(upload.encoding ?? ''),
      mimetype: String(upload.mimetype ?? ''),
      destination: path.dirname(resolved),
      filename: path.basename(resolved),
      path: resolved,
      size: stat.size,
    };
  }
  return { verified, errors };
}

/**
 * The top-level keys whose value differs between the client's extravars and the server's.
 * `__verbose__` and reserved `__x__` keys are not form output, so they are left out, and so
 * are the `ignore` keys (verified uploads).
 */
export function compareExtravars(client, server, ignore = []) {
  const isOutputKey = (k) => !/^__.*__$/.test(k) && !ignore.includes(k);
  const keys = new Set([...Object.keys(client || {}), ...Object.keys(server || {})].filter(isOutputKey));
  return [...keys].filter((k) => canonicalJson(client?.[k]) !== canonicalJson(server?.[k])).sort();
}

/**
 * A log line about a refused (or would-be refused) launch : field names and rule types
 * only - never a value, a description could hold one through a placeholder.
 */
export function describeLaunchErrors(errors) {
  const parts = [];
  if (errors?.missing?.length) parts.push(`missing : ${errors.missing.join(', ')}`);
  const rules = Object.entries(errors?.validationErrors || {}).map(([n, errs]) => `${n} (${errs.map((e) => e.type).join(', ')})`);
  if (rules.length) parts.push(`failing rules : ${rules.join(', ')}`);
  const rows = describeRowErrors(errors?.rowErrors);
  if (rows.length) parts.push(`failing rows : ${rows.join(', ')}`);
  const other = (errors?.invalid || [])
    .filter((n) => !(n in (errors?.validationErrors || {})) && !(n in (errors?.rowErrors || {})));
  if (other.length) parts.push(`invalid : ${other.join(', ')}`);
  if (errors?.waiting?.length) parts.push(`not resolvable : ${errors.waiting.join(', ')}`);
  if (errors?.uploads?.length) parts.push(`uploads : ${errors.uploads.map((u) => `${u.field} (${u.reason})`).join(', ')}`);
  return parts.join(' ; ');
}

/** `list[2].field (rule)` for every failing row, nested lists included - names and rule types only. */
export function describeRowErrors(rowErrors, prefix = '') {
  const out = [];
  for (const [list, rows] of Object.entries(rowErrors || {})) {
    for (const row of rows) {
      // a yaml field with a subform is one row, without an index
      const at = row.index === null || row.index === undefined ? `${prefix}${list}` : `${prefix}${list}[${row.index}]`;
      for (const n of row.missing || []) out.push(`${at}.${n} (missing)`);
      for (const [n, errs] of Object.entries(row.validationErrors || {})) out.push(`${at}.${n} (${errs.map((e) => e.type).join(', ')})`);
      for (const n of (row.invalid || []).filter((x) => !(x in (row.validationErrors || {})) && !(x in (row.rowErrors || {})))) out.push(`${at}.${n} (invalid)`);
      for (const n of row.waiting || []) out.push(`${at}.${n} (not resolvable)`);
      out.push(...describeRowErrors(row.rowErrors, `${at}.`));
    }
  }
  return out;
}

export default { validateLaunch, describeRowErrors, verifyUploads, compareExtravars, describeLaunchErrors };
