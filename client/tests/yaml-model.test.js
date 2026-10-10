import { describe, it, expect } from 'vitest';
import { reactive, nextTick } from 'vue';
import { useYamlModel } from '../src/composables/useYamlModel.js';

// a list of names, as the categories editor reads one : rows of { name }
const options = {
  toRows(value) {
    if (value != null && !Array.isArray(value)) throw new Error('not a list');
    return (value || []).map((v) => ({ name: v.name }));
  },
  fromRows: (rows) => rows.map((r) => ({ name: r.name })),
};

function setup(text) {
  const props = reactive({ modelValue: text });
  const emitted = [];
  const emit = (event, value) => {
    emitted.push(value);
    props.modelValue = value;
  };
  const model = useYamlModel(props, emit, options);
  return { props, emitted, ...model };
}

describe('useYamlModel', () => {
  it('reads the text into rows, and writes nothing until a row changes', async () => {
    const { rows, emitted } = setup('# the list\n- name: a\n- name: b\n');
    await nextTick();
    expect(rows.value.map((r) => r.name)).toEqual(['a', 'b']);
    expect(emitted).toEqual([]);
  });

  it('writes the text back when a row changes', async () => {
    const { rows, emitted } = setup('- name: a\n');
    rows.value[0].name = 'z';
    await nextTick();
    expect(emitted.at(-1)).toBe('- name: z\n');
  });

  it('gives the text back as it was written when a row is edited back', async () => {
    const original = '# the list\n- name: a\n';
    const { rows, emitted } = setup(original);
    rows.value[0].name = 'z';
    await nextTick();
    rows.value[0].name = 'a';
    await nextTick();
    expect(emitted.at(-1)).toBe(original);
  });

  it('reads a text changed from outside, even back to what it last wrote', async () => {
    const { props, rows } = setup('- name: a\n');
    rows.value[0].name = 'z';
    await nextTick();
    props.modelValue = '- name: q\n';
    await nextTick();
    expect(rows.value[0].name).toBe('q');
    props.modelValue = '- name: z\n';
    await nextTick();
    expect(rows.value[0].name).toBe('z');
  });

  it('says why a text cannot be read, and writes nothing', async () => {
    const { error, emitted } = setup('name: not a list\n');
    await nextTick();
    expect(error.value).toBe('not a list');
    expect(emitted).toEqual([]);
  });
});
