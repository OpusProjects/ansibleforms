// Whether croner will accept a cron expression, and why not when it will not.
//
// This lives here rather than inside BsCron because TWO places need the same answer and
// they used to disagree:
//
//   - the editor, which shows an inline reason and a next-run preview ;
//   - the SAVE validator on the repositories and schedules pages, which used
//     to be a hand written regex in config/settings.js.
//
// A regex cannot express "the start of a range must not exceed its end", so `0 0 * * 5-1`
// passed the save validator while croner refuses it - cron.service.js then logged
// 'Invalid cron expression' and returned, so the row saved and the job was never
// registered. Nothing said so: the repository simply stopped syncing. The editor DID
// report it, but only as text next to the field, which never blocked the save.
// (Measured: fuzzing ~198k expressions against croner, the inverted range was the only
// shape the regex let through.)
//
// The regex also went the other way. croner resolves month and weekday NAMES before
// parsing, and this module does the same so the preview can describe `0 8 * * MON` - but
// the regex only accepted digits, so the editor drew a valid description and next-run
// badges for an expression it then refused to save.
//
// One implementation, used by both, is what keeps that from coming back. The server
// applies the real thing (lib/cronValidate.js constructs an actual Cron), so this is the
// early, explanatory answer rather than the authority.

// croner replaces month and weekday names with numbers before parsing, but only when the
// field is at least 3 characters long, so '0 0 * * MON' and '0 0 * JAN *' are valid.
export const MONTH_ALPHA = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const DOW_ALPHA = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function normalizeNames(expr, field) {
  if (expr.length < 3) return expr;
  if (field === 'month') {
    return MONTH_ALPHA.reduce((acc, n, i) => acc.replace(new RegExp(n, 'gi'), String(i + 1)), expr);
  }
  if (field === 'dow') {
    // croner maps a trailing '-sun' to 7 first, so 'mon-sun' stays ascending
    return DOW_ALPHA.reduce((acc, n, i) => acc.replace(new RegExp(n, 'gi'), String(i)), expr.replace(/-sun/gi, '-7'));
  }
  return expr;
}

// The five scheduling fields of a 5- or 6-field expression, with month and weekday names
// resolved so every matcher only ever sees digits.
export function normalizeParts(all) {
  const p = all.length === 6 ? all.slice(1) : all;
  return [p[0], p[1], p[2], normalizeNames(p[3], 'month'), normalizeNames(p[4], 'dow')];
}

// Per-field bounds, mirroring croner's CronPattern. It throws on a value outside these
// bounds ("Invalid value for day: 31"), on an inverted range ("From value is larger than
// to value") and on a step larger than the field itself ("steps cannot be greater than
// maximum value of part").
export const FIELD_SPECS = {
  second: { label: 'second', min: 0, max: 59, maxStep: 60 },
  minute: { label: 'minute', min: 0, max: 59, maxStep: 60 },
  hour: { label: 'hour', min: 0, max: 23, maxStep: 24 },
  dom: { label: 'dayOfMonth', min: 1, max: 31, maxStep: 31 },
  month: { label: 'month', min: 1, max: 12, maxStep: 12 },
  dow: { label: 'dayOfWeek', min: 0, max: 7, maxStep: 7 },
};

export const FIELD_ORDER = ['minute', 'hour', 'dom', 'month', 'dow'];

// Constructs croner accepts but the editor cannot reproduce: the nearest weekday modifier
// ('15W'), '?' as a wildcard, '@daily' nicknames and the optional 7th year field. Saying
// so beats rendering a confident wrong preview - and refusing to SAVE them is the same
// stance the old regex took, so this is not a new restriction.
//
// '?' and '@' can never occur inside a month or weekday NAME, so they are tested against
// the raw expression. 'W' can: a single /[w?@]/i over the whole string reported '0 8 * *
// WED' and '0 8 * * mon-wed' as unsupported - no description, no badges, a red border -
// for an expression croner runs happily. Only Wednesday was affected, which is why it
// survived. Tested per field AFTER normalizeNames has resolved the names to digits, so
// any remaining 'w' really is the modifier.
const UNSUPPORTED_SYMBOL = /[?@]/;
const NEAREST_WEEKDAY = /w/i;

/**
 * Why croner would refuse `expr` for this field, or null when it fits.
 *
 * `params.field` carries the field's LABEL KEY ('dayOfMonth'), not translated text, so
 * this module stays free of vue-i18n - see cronErrorMessage.
 */
export function fieldError(expr, field) {
  const spec = FIELD_SPECS[field];
  for (const part of normalizeNames(expr, field).split(',')) {
    let token = part;
    let nth = null;
    if (field === 'dow') {
      // nth ('1#2') and last ('5L') weekday of the month are modifiers on the
      // value, not part of it
      if (token.includes('#')) {
        // croner ignores an empty nth, so '1#' is just '1'
        nth = token.split('#')[1] || null;
        token = token.split('#')[0];
      } else if (/L$/i.test(token)) {
        nth = 'L';
        token = token.slice(0, -1);
      }
      if (nth !== null && !/^(?:[1-5]|L)$/i.test(nth)) return { key: 'invalid' };
    } else if (field === 'dom' && /L/i.test(token)) {
      // croner strips every 'L' from the day-of-month field and matches the last day
      // of the month in addition to whatever remains
      token = token.replace(/L/gi, '');
      if (token === '') continue; // 'L' on its own
    }
    if (token === '*') continue;
    let range = token;
    if (token.includes('/')) {
      const bits = token.split('/');
      const step = Number(bits[1]);
      if (bits.length !== 2 || !/^\d+$/.test(bits[1]) || step < 1 || step > spec.maxStep) {
        return { key: 'invalidStepSize', params: { field: spec.label, value: part, max: spec.maxStep } };
      }
      range = bits[0];
      if (range !== '*' && !range.includes('-')) return { key: 'invalidStep' };
    }
    if (range === '*') continue;
    const bounds = range.includes('-') ? range.split('-') : [range];
    if (bounds.length > 2 || bounds.some((b) => !/^\d+$/.test(b))) return { key: 'invalid' };
    if (bounds.some((b) => Number(b) < spec.min || Number(b) > spec.max)) {
      return { key: 'invalidValue', params: { field: spec.label, value: part, min: spec.min, max: spec.max } };
    }
    if (bounds.length === 2 && Number(bounds[0]) > Number(bounds[1])) {
      return { key: 'invalidRange', params: { field: spec.label, value: part } };
    }
  }
  return null;
}

/**
 * Why the whole expression would be refused, or null when it is fine.
 * An EMPTY expression is not an error here - "no schedule" is a legitimate value on every
 * page that uses this, and `required` is a separate rule.
 */
export function cronError(expression) {
  const v = String(expression ?? '').trim();
  if (!v) return null;
  if (UNSUPPORTED_SYMBOL.test(v)) return { key: 'unsupported' };
  const parts = v.split(/\s+/);
  // croner reads 6 fields as a leading seconds field and 7 as seconds plus a trailing
  // year, which this editor does not model
  if (parts.length === 7) return { key: 'unsupported' };
  if (parts.length !== 5 && parts.length !== 6) return { key: 'invalid' };
  const fields = parts.length === 6 ? ['second', ...FIELD_ORDER] : FIELD_ORDER;
  // per field, and only once the names are digits (see NEAREST_WEEKDAY)
  for (let i = 0; i < parts.length; i++) {
    if (NEAREST_WEEKDAY.test(normalizeNames(parts[i], fields[i]))) return { key: 'unsupported' };
  }
  for (let i = 0; i < parts.length; i++) {
    const err = fieldError(parts[i], fields[i]);
    if (err) return err;
  }
  return null;
}

/** Render a cronError() result with the caller's translator. '' when there is no error. */
export function cronErrorMessage(t, err) {
  if (!err) return '';
  if (!err.params) return t(`settings.cron.${err.key}`);
  // params.field is a label KEY, translated here rather than inside the pure part
  const params = { ...err.params };
  if (params.field) params.field = t(`settings.cron.${params.field}`);
  return t(`settings.cron.${err.key}`, params);
}

/** The message for an expression, or '' when it is acceptable. */
export function cronValidationMessage(t, expression) {
  return cronErrorMessage(t, cronError(expression));
}
