'use strict';

/**
 * What the chat knows about a form, derived from the live definition (MCP get_form) - no
 * per-form configuration besides `enableForChat`.
 */

// computed, display, secret and upload fields are never answered by the operator
const SKIP_TYPES = new Set(['expression', 'html', 'password', 'file', 'local', 'local_out', 'credential']);
// a field behind this dependency asks for stored credentials, which AnsibleForms keeps to itself
const CREDENTIAL_DEPENDENCY = 'CREDENTIALS.';
const SUMMARY_FIELDS = 4;

const WORD = /[a-z0-9]+/g;
const FILLER = new Set(['a', 'an', 'the', 'for', 'of', 'on', 'in', 'to', 'me', 'my', 'can', 'you', 'please', 'with',
  'and', 'or', 'i', 'want', 'need', 'make', 'create', 'take', 'new', 'run', 'do', 'some', 'what', 'which', 'is', 'are']);

function answerable(field) {
  if (!field?.name || SKIP_TYPES.has(field.type) || field.hide) return false;
  return !(field.dependencies || []).some((d) => String(d?.name || '').startsWith(CREDENTIAL_DEPENDENCY));
}

/**
 * A field that names a target the operator must supply : every choice, and a required free
 * text without a default (a resource the form is about to create). Deliberately strict - it
 * also catches schedule fields, which costs one question and never a wrong target.
 */
function operatorChoice(field) {
  if (field.type === 'enum' || field.type === 'query') return true;
  return !!field.required && field.type === 'text' && (field.default === undefined || field.default === '');
}

function help(field) {
  const regex = field.regex && typeof field.regex === 'object' ? field.regex.description : null;
  return [field.help, field.placeholder, regex].filter(Boolean).map((s) => String(s).trim()).join(' ');
}

/** the chat's view of one form : slots, targets, list slots, switches, help */
export function describeForm(form) {
  const slots = [];
  const operatorSlots = [];
  const listSlots = [];
  const switchSlots = [];
  const slotHelp = {};
  const summaryFields = [];
  for (const field of form?.fields || []) {
    if (!answerable(field)) continue;
    slots.push(field.name);
    if (operatorChoice(field)) operatorSlots.push(field.name);
    if (field.multiple) listSlots.push(field.name);
    if (field.type === 'checkbox') switchSlots.push(field.name);
    const h = help(field);
    if (h) slotHelp[field.name] = h;
    if (summaryFields.length < SUMMARY_FIELDS && field.required && !field.multiple && !field.dependencies) {
      summaryFields.push({ name: field.name, label: field.label || field.name });
    }
  }
  return {
    form: form?.name,
    slots, operatorSlots, listSlots, switchSlots, slotHelp, summaryFields,
  };
}

/** share of the best phrase's words that appear in the query */
export function score(query, phrases) {
  const words = new Set((String(query).toLowerCase().match(WORD) || []).filter((w) => !FILLER.has(w)));
  let best = 0;
  for (const phrase of phrases) {
    const tokens = (String(phrase || '').toLowerCase().match(WORD) || []).filter((w) => !FILLER.has(w));
    if (tokens.length) best = Math.max(best, tokens.filter((t) => words.has(t)).length / tokens.length);
  }
  return Math.round(best * 100) / 100;
}

/** the forms of this user flagged for the chat - the only ones it may touch */
export async function chatForms(handlers) {
  const { forms } = await handlers.listForms();
  return (forms || []).filter((f) => f.enableForChat === true);
}

export default { describeForm, score, chatForms };
