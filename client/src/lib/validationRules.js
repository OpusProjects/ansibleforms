// vuelidate rules built from the form engine shared with the server (@engine/validate.js).
//
// The rules themselves - what passes, what fails, the message - live in the engine, so the
// browser, the MCP server and the launch validation (LAUNCH_VALIDATION) can never
// disagree about them. This file only wraps each one the way AppForm and AppListField expect
// a vuelidate rule : keyed by its type, with `$params.type` and `$params.description` (what
// getErrorsToDisplay and the input components read) and the description as `$message`.
import { computed, unref } from 'vue';
import { helpers } from '@vuelidate/validators';
import { compileFieldRules } from '@engine/validate.js';

/**
 * @param {object[]} fields
 * @param {object} opts
 * @param {function} opts.getValue    (name) => the value of that field (for a message such as a file size)
 * @param {function} opts.getValues   () => the values cross-field rules read (validIf, in, sameAs, ...)
 * @param {function} [opts.resolve]   (text) => { value } : placeholder resolution ; the engine's when omitted
 * @param {function} [opts.warn]      (message) => void : a regex that cannot be used
 * @returns {object} { [fieldName]: { [ruleType]: vuelidate rule } }
 */
export function buildVuelidateRules(fields, { getValue, getValues, resolve, warn }) {
  const ctx = () => ({
    values: getValues() || {},
    fieldOptions: {},
    isReady: () => true,
    resolve,
    warn: (m) => console.warn(m),
  });
  const out = {};
  for (const field of fields || []) {
    const { rules, warnings } = compileFieldRules(field, fields);
    warnings.forEach((w) => warn?.(w));
    const fieldRules = {};
    for (const rule of rules) {
      const description = computed(() => rule.description(getValue(field.name), ctx()));
      fieldRules[rule.type] = helpers.withMessage(
        ({ $params }) => unref($params.description) ?? '',
        helpers.withParams({ type: rule.type, description }, (value) => rule.test(value, ctx())),
      );
    }
    out[field.name] = fieldRules;
  }
  return out;
}

export default { buildVuelidateRules };
