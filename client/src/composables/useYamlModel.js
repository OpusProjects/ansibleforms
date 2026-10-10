import { ref, watch } from 'vue';
import YAML from 'yaml';

/******************************************************************/
/*                                                                */
/*  A YAML text edited as a tree of rows : the designer's visual  */
/*  editors (categories, constants), beside its YAML editor, on   */
/*  the same text.                                                */
/*                                                                */
/*  The text is read into rows when it changes from outside (the  */
/*  YAML tab, a revert) ; the rows are written back to the text   */
/*  when they change in what they hold - not their order of keys, */
/*  their quoting or their comments, so opening the visual tab    */
/*  changes nothing.                                              */
/*                                                                */
/******************************************************************/

/**
 * A YAML text (a v-model) edited as rows.
 *
 * Args:
 *   props (object): the component's props, its modelValue the YAML text.
 *   emit (function): the component's emit, for update:modelValue.
 *   options (object): { toRows(value) -> rows, fromRows(rows) -> value } - the parsed YAML
 *     into editable rows, and back. toRows throws when the value is not of the expected shape.
 *
 * Returns:
 *   object: { rows, error } - the rows (a ref, edited in place), and the reason the text
 *     cannot be edited here ('' when it can).
 */
export function useYamlModel(props, emit, { toRows, fromRows }) {
  const rows = ref([]);
  const error = ref('');
  // what the rows held when last read or written, and the text last written : to tell an edit
  // from a reload, and our own text coming back from the parent from a new one
  let lastValue = '';
  let lastText = null;

  // the text into rows : an error (unparsable, the wrong shape) leaves the rows as they were
  function read(text) {
    try {
      const parsed = text && text.trim() ? YAML.parse(text) : null;
      rows.value = toRows(parsed);
      lastValue = JSON.stringify(fromRows(rows.value));
      error.value = '';
    } catch (e) {
      error.value = e?.message || String(e);
    }
  }

  watch(
    () => props.modelValue,
    (text) => {
      if (text === lastText) return;
      read(text || '');
    },
    { immediate: true },
  );

  // the rows edited : written back when what they hold changed
  watch(
    rows,
    () => {
      if (error.value) return;
      const value = fromRows(rows.value);
      const json = JSON.stringify(value);
      if (json === lastValue) return;
      lastValue = json;
      lastText = YAML.stringify(value);
      emit('update:modelValue', lastText);
    },
    { deep: true },
  );

  return { rows, error };
}

export default useYamlModel;
