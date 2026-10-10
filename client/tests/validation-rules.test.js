// The browser's vuelidate rules, now built from the shared form engine
// (src/lib/validationRules.js over @engine/validate.js), against the golden fixtures - whose
// `validation` was captured by running the hand-written rules AppForm.vue held before 6.4.
// So this is the proof that moving the rules into the engine changed nothing in the browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ref, nextTick } from 'vue';
import { useVuelidate } from '@vuelidate/core';
import Helpers from '@/lib/Helpers.js';
import { buildVuelidateRules } from '@/lib/validationRules.js';
import { resolveForm } from '@engine/resolve.js'; // eslint-disable-line no-restricted-imports
import { loadFixtures } from '../../server/tests/golden/formEngine/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appForm = readFileSync(path.join(here, '../src/components/AppForm.vue'), 'utf8');
const cut = (a, b) => appForm.slice(appForm.indexOf(a), appForm.indexOf(b, appForm.indexOf(a)));
// AppForm's own placeholder resolver, as the rules get it there
const RESOLVER_SRC =
  cut('function stringifyValue(', '// in case of unexpected error') +
  cut('function replacePlaceholderInString(', '// replace placeholders\nfunction replacePlaceholders');

function browserResolver(form, fields) {
  const fieldOptions = ref(
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        { type: f.type, valueColumn: f.valueColumn || '', placeholderColumn: f.placeholderColumn || '' },
      ]),
    ),
  );
  const dynamicFieldStatus = ref(Object.fromEntries(fields.map((f) => [f.name, 'fixed'])));
  return new Function(
    'form',
    'fieldOptions',
    'dynamicFieldStatus',
    'Helpers',
    `${RESOLVER_SRC}\nreturn replacePlaceholderInString;`,
  )(form, fieldOptions, dynamicFieldStatus, Helpers);
}

async function browserValidation(fx) {
  const res = await resolveForm({
    form: structuredClone(fx.form),
    values: structuredClone(fx.values || {}),
    services: {
      evalSandbox: Helpers.evalSandbox,
      serverExpression: async (e) => fx.stubs?.expressions?.[e],
      query: async (f) => fx.stubs?.queries?.[f.name],
    },
  });
  const fields = structuredClone(fx.form.fields).map((f) => ({ ...f, label: f.label || f.name }));
  const form = ref({ ...res._values });
  const replacePlaceholderInString = browserResolver(form, fields);
  const warnings = [];
  const rules = {
    form: buildVuelidateRules(fields, {
      getValue: (n) => form.value[n],
      getValues: () => form.value,
      resolve: (t) => replacePlaceholderInString(t, false),
      warn: (w) => warnings.push(w),
    }),
  };
  const v$ = useVuelidate(rules, { form });
  return { res, v$, form, warnings };
}

const fixtures = loadFixtures(path.join(here, '../../server/tests/golden/formEngine/fixtures')).filter(
  (fx) => fx.expect.validation,
);

describe('vuelidate rules from the engine match the pre-6.4 browser rules', () => {
  it.each(fixtures.map((fx) => [fx.file, fx]))('%s', async (_file, fx) => {
    const { res, v$ } = await browserValidation(fx);
    v$.value.form.$touch();
    await nextTick();
    const validation = {};
    for (const f of fx.form.fields) {
      // what the browser renders : $message, falling back to $params.description
      const errs = v$.value.form[f.name]?.$errors || [];
      if (res._visibility[f.name] && !res.waiting.includes(f.name) && errs.length) {
        validation[f.name] = errs.map((e) => ({
          type: e.$params.type,
          description: String(e.$message || e.$params?.description || ''),
        }));
      }
    }
    expect(validation).toEqual(fx.expect.validation);
  });
});

describe('the contract with AppForm', () => {
  const fx = fixtures.find((f) => f.file === '16-validif.json');

  it('a validIf error is there before the field is touched, for getErrorsToDisplay', async () => {
    const { v$ } = await browserValidation(fx);
    await nextTick();
    const silent = v$.value.form.a.$silentErrors.map((e) => e.$params.type);
    expect(silent).toEqual(['validIf']);
    expect(v$.value.form.a.$errors).toEqual([]);
  });

  it('a rule follows the value it reads', async () => {
    const { v$, form } = await browserValidation(fx);
    expect(v$.value.form.a.$invalid).toBe(true);
    form.value.flag = true;
    await nextTick();
    expect(v$.value.form.a.$invalid).toBe(false);
  });

  it('an unusable regex is reported through warn', async () => {
    const { warnings } = await browserValidation(fixtures.find((f) => f.file === '15-regex.json'));
    expect(warnings).toEqual([expect.stringContaining("Field 'broken': the regex '^[a-z' is not valid")]);
  });
});
