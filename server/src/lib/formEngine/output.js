'use strict';
import { getFieldValue } from './placeholders.js';

/**
 * Turn raw field values into the extravars a browser submission sends.
 *
 * MIRROR of client/src/lib/Helpers.js buildFormOutput / deepClone and of
 * client/src/pages/form.vue submitForm + getFilteredRawFormData. Keep in sync.
 */

/**
 * The marker keys a `list` field sets on its rows (AppListField) : the configured names,
 * and `__inserted__` for new rows when rows can be deleted or updated but no insertMarker
 * is given - so a freshly added row stays removable. Empty string : no such marker.
 */
export function listMarkers(field) {
  const f = field || {};
  let insert = f.insertMarker || '';
  if (!insert && (f.allowDelete === false || f.deleteMarker || f.updateMarker)) insert = '__inserted__';
  return { insert, update: f.updateMarker || '', delete: f.deleteMarker || '' };
}

export function deepClone(o) {
  if (o === undefined) return o;
  try {
    return JSON.parse(JSON.stringify(o));
  } catch {
    return undefined;
  }
}

/**
 * @param {object[]} fields
 * @param {object} raw                 name -> raw value
 * @param {object} [opts]
 * @param {function} [opts.isVisible]  (field) => boolean
 * @param {object} [opts.overrides]    name -> value used instead of raw[name]
 * @param {object[]} [opts.subforms]   subform definitions, for list rows
 */
export function buildFormOutput(fields, raw, opts = {}) {
  const isVisible = opts.isVisible || (() => true);
  const overrides = opts.overrides || {};
  const subforms = opts.subforms || [];
  const subformByName = Object.fromEntries((subforms || []).map((s) => [s.name, s]));
  const fd = {};
  (fields || []).forEach((item) => {
    if (!item || !item.name) return;
    if (item.name === '__user__') return;
    if (item.name === '__parent__') return;
    if (item.output === false) return;
    if (!isVisible(item)) return;

    const outputObject =
      item.outputObject ||
      item.type === 'expression' ||
      item.type === 'file' ||
      item.type === 'list' ||
      item.type === 'yaml' ||
      item.type === 'datetime' ||
      false;

    let outputValue = (item.name in overrides) ? overrides[item.name] : deepClone(raw?.[item.name]);

    if (item.type === 'datetime' && item.dateType === 'month' && outputValue && typeof outputValue === 'object') {
      outputValue = {
        ...outputValue,
        month: typeof outputValue.month === 'number' ? outputValue.month + 1 : outputValue.month,
      };
    }

    if (!outputObject) {
      outputValue = getFieldValue(outputValue, item.valueColumn || '', true);
    }

    if (outputValue && typeof outputValue === 'object' && !Array.isArray(outputValue) && '__output__' in outputValue) {
      outputValue = outputValue.__output__;
    }

    if (item.type === 'list' && Array.isArray(outputValue)) {
      const sub = (typeof item.subform === 'string') ? subformByName[item.subform] : item.subform;
      if (sub && Array.isArray(sub.fields)) {
        // a row is rebuilt from its subform's fields ; the row-state markers are not fields,
        // so they are carried over - without them a soft-deleted row reached the playbook
        // looking exactly like a live one
        const markers = Object.values(listMarkers(item)).filter(Boolean);
        outputValue = outputValue.map((row) => {
          const out = buildFormOutput(sub.fields, row || {}, { subforms });
          for (const m of markers) if (row?.[m]) out[m] = row[m];
          return out;
        });
      }
    }

    const fieldmodel = [].concat(item.model || []);
    if (fieldmodel.length === 0) {
      fd[item.name] = deepClone(outputValue);
      return;
    }

    fieldmodel.forEach((f) => {
      f.split(/\s*\.\s*/).reduce((master, obj, level, arr) => {
        let arrsplit;
        if (level === arr.length - 1) {
          if (obj.match(/.*\[[0-9]+\]$/)) {
            arrsplit = obj.split(/\[([0-9]+)\]$/);
            if (master[arrsplit[0]] === undefined) master[arrsplit[0]] = [];
            if (master[arrsplit[0]][arrsplit[1]] === undefined) master[arrsplit[0]][arrsplit[1]] = {};
            master[arrsplit[0]][arrsplit[1]] = outputValue;
            return master[arrsplit[0]][arrsplit[1]];
          }
          if (master[obj] === undefined) {
            master[obj] = outputValue;
          } else if (typeof master[obj] !== 'object' || master[obj] === null || typeof outputValue !== 'object' || outputValue === null) {
            master[obj] = outputValue;
          } else {
            master[obj] = { ...master[obj], ...outputValue };
          }
          return master[obj];
        }
        if (obj.match(/.*\[[0-9]+\]$/)) {
          arrsplit = obj.split(/\[([0-9]+)\]$/);
          if (master[arrsplit[0]] === undefined) master[arrsplit[0]] = [];
          if (master[arrsplit[0]][arrsplit[1]] === undefined) master[arrsplit[0]][arrsplit[1]] = {};
          return master[arrsplit[0]][arrsplit[1]];
        }
        if (typeof master !== 'object' || master === null) return {};
        if (master[obj] === undefined) master[obj] = {};
        return master[obj];
      }, fd);
    });
  });
  return fd;
}

/**
 * Read a value back out of modelled extravars, at a `model` path as buildFormOutput writes it
 * (`a.b.c`, `list[2].name`). Undefined when any step is missing.
 */
export function readModelPath(obj, modelPath) {
  let cur = obj;
  for (const part of String(modelPath).split(/\s*\.\s*/)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const m = part.match(/^(.*)\[([0-9]+)\]$/);
    cur = m ? cur[m[1]]?.[m[2]] : cur[part];
  }
  return cur;
}

/**
 * The extravars and credentials a launch submits for a resolved form (resolveForm's result),
 * exactly as form.vue submitForm builds them : buildFormOutput over the visible fields, with
 * `overrides` for the uploaded files, and the credentials read from that output.
 */
export function buildLaunchPayload(res, subforms = [], { overrides = {} } = {}) {
  const extravars = buildFormOutput(res._fields, res._values, {
    isVisible: (f) => !!res._visibility[f.name],
    overrides,
    subforms: subforms || [],
  });
  return { extravars, credentials: collectCredentials(res._fields, extravars) };
}

/** form.vue submitForm : credentials come from the MODELLED output of asCredential fields. */
export function collectCredentials(fields, extravars) {
  const credentials = {};
  (fields || []).filter((f) => f?.asCredential === true).forEach((f) => {
    credentials[f.name] = extravars?.[f.name];
  });
  return credentials;
}

/** form.vue getFilteredRawFormData : the values kept for a relaunch. */
export function filterRawFormData(fields, values, subforms = []) {
  const out = {};
  (fields || []).forEach((field) => {
    const name = field?.name;
    if (!name || !(name in (values || {}))) return;
    if (field.type === 'constant' || field.type === 'password') return;
    if (name === 'server' || name === 'database' || name === 'metadata') return;
    if (field.type === 'list') out[name] = stripRowPasswords(field, values[name], subforms);
    // a yaml field with a subform is one such row
    else if (field.type === 'yaml' && field.subform && values[name] && typeof values[name] === 'object' && !Array.isArray(values[name])) {
      out[name] = stripRowPasswords(field, [values[name]], subforms)[0];
    } else out[name] = values[name];
  });
  return out;
}

function subformFor(field, subforms) {
  return (typeof field?.subform === 'string') ? (subforms || []).find((s) => s?.name === field.subform) : field?.subform;
}

function deleteAtPath(obj, modelPath) {
  const parts = String(modelPath).split(/\s*\.\s*/);
  const last = parts.pop();
  const parent = parts.length ? readModelPath(obj, parts.join('.')) : obj;
  if (!parent || typeof parent !== 'object') return;
  const m = last.match(/^(.*)\[([0-9]+)\]$/);
  if (m) {
    const arr = parent[m[1]];
    if (Array.isArray(arr) && arr[m[2]] !== undefined) arr[m[2]] = undefined;
  } else {
    delete parent[last];
  }
}

/** modelled rows (a row's __output__, or a nested list inside it) without their passwords */
function stripOutputPasswords(sub, outRows, subforms) {
  if (!Array.isArray(outRows)) return;
  for (const out of outRows) {
    if (!out || typeof out !== 'object') continue;
    for (const f of sub?.fields || []) {
      if (!f?.name) continue;
      const paths = [].concat(f.model || f.name);
      if (f.type === 'password') paths.forEach((p) => deleteAtPath(out, p));
      else if (f.type === 'list') paths.forEach((p) => stripOutputPasswords(subformFor(f, subforms), readModelPath(out, p), subforms));
    }
  }
}

/**
 * List rows as they are stored for a relaunch : without the values of their password
 * fields - the top-level filter only knew the form's own fields, so a password inside a
 * list row was stored in raw_form_data. Nested lists and each row's __output__ included.
 */
function stripRowPasswords(field, rows, subforms) {
  const sub = subformFor(field, subforms);
  if (!sub || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    for (const f of sub.fields || []) {
      if (!f?.name) continue;
      if (f.type === 'password') delete copy[f.name];
      else if (f.type === 'list') copy[f.name] = stripRowPasswords(f, copy[f.name], subforms);
    }
    if (copy.__output__ && typeof copy.__output__ === 'object') {
      copy.__output__ = deepClone(copy.__output__);
      stripOutputPasswords(sub, [copy.__output__], subforms);
    }
    return copy;
  });
}

/**
 * A copy of `data` with the values of password-typed fields replaced by a mask, for display
 * only. MIRROR of client/src/lib/Helpers.js maskPasswordsForDisplay.
 */
export function maskPasswords(data, fields, subforms = []) {
  if (data == null || !Array.isArray(fields)) return data;
  const cloned = deepClone(data);
  if (cloned == null) return data;
  const subformByName = Object.fromEntries((subforms || []).map((s) => [s.name, s]));
  const MASK = '********';
  const setAtPath = (target, p, value) => {
    const parts = String(p).split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return;
      cur = cur[parts[i]];
    }
    if (cur && typeof cur === 'object') {
      const last = parts[parts.length - 1];
      if (last in cur && cur[last] != null && cur[last] !== '') cur[last] = value;
    }
  };
  const getAtPath = (target, p) => {
    let cur = target;
    for (const part of String(p).split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  };
  const walk = (target, fieldDefs) => {
    if (!target || typeof target !== 'object' || !Array.isArray(fieldDefs)) return;
    for (const f of fieldDefs) {
      if (!f || !f.name || f.output === false) continue;
      const paths = [].concat(f.model || f.name);
      const sub = (typeof f.subform === 'string') ? subformByName[f.subform] : f.subform;
      if (f.type === 'password') {
        for (const p of paths) setAtPath(target, p, MASK);
      } else if (f.type === 'list' && sub && Array.isArray(sub.fields)) {
        for (const p of paths) {
          const arr = getAtPath(target, p);
          if (Array.isArray(arr)) arr.forEach((row) => walk(row, sub.fields));
        }
      } else if (f.type === 'yaml' && sub && Array.isArray(sub.fields)) {
        for (const p of paths) {
          const obj = getAtPath(target, p);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) walk(obj, sub.fields);
        }
      }
    }
  };
  walk(cloned, fields);
  return cloned;
}

/** JSON with object keys sorted at every level, so equal data always hashes the same. */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export default { listMarkers, deepClone, buildFormOutput, buildLaunchPayload, readModelPath, collectCredentials, filterRawFormData, maskPasswords, canonicalJson };
