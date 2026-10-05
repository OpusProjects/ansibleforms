<script setup>
/******************************************************************/
/*                                                                */
/*  AppListField - list of rows, each row edited via a subform    */
/*  pane that replaces the main form (drilldown pattern).         */
/*  Arbitrarily deep nesting is supported by delegating the edit  */
/*  stack to the root page via `provide('formEditStack')`.        */
/*                                                                */
/*  @props:                                                       */
/*      field: Object         (the parent list field definition)  */
/*      subform: Object       (target subform definition)         */
/*      subforms: Array       (all subforms inlined by server)    */
/*      constants: Object     (form constants, pass-through)      */
/*      hasError: Boolean                                         */
/*      errors: Array                                             */
/*      help: String                                              */
/*      modelValue: Array     (v-model, list of row objects)      */
/*                                                                */
/*  @emits:                                                       */
/*      update:modelValue                                         */
/*                                                                */
/******************************************************************/

import { ref, computed, watch, inject } from 'vue';
import YAML from 'yaml';
import { toast } from 'vue-sonner';
import Helpers from '@/lib/Helpers';
import { listMarkers } from '@engine/output.js';

const props = defineProps({
  field: { type: Object, required: true },
  subform: { type: Object, default: null },
  subforms: { type: Array, default: () => [] },
  constants: { type: Object, default: () => ({}) },
  parentFormData: { type: Object, default: () => ({}) },
  hasError: { type: Boolean, default: false },
  errors: { type: Array, default: () => [] },
  help: { type: String, default: '' },
  modelValue: { type: Array, default: () => [] },
  showLoadButton: { type: Boolean, default: false },
  showDownloadButton: { type: Boolean, default: false },
  name: { type: String, default: 'list-field' },
});

const emit = defineEmits(['update:modelValue']);

const fileInputRef = ref(null);

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function handleFileLoad(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  // try/finally : the early returns below (wrong extension, unparsable file) used
  // to skip the reset at the end, so the <input type=file> kept the same value -
  // re-picking the SAME path fired no change event and the button was dead.
  try {
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
      toast.error('Please select a .yml or .yaml file');
      return;
    }
    try {
      const text = await file.text();
      const parsed = YAML.parse(text);
      if (parsed === null || parsed === undefined) {
        toast.error('Invalid YAML file - no data found');
        return;
      }
      const arrayData = Array.isArray(parsed) ? parsed : [parsed];
      if (!Array.isArray(parsed)) toast.info('Single object converted to array');

      // Apply modeling transformation: build __output__ for each row from raw fields
      // so the modeled structure is immediately visible without manual edit
      rows.value = Helpers.applySubformModeling(arrayData, props.subform?.fields, props.subforms || []);

      commit();
      toast.success(`Loaded ${arrayData.length} row(s) from ${file.name}`);
    } catch (e) {
      toast.error(`Failed to parse ${file.name}: ${e.message}`);
    }
  } finally {
    event.target.value = '';
  }
}

function handleDownload() {
  try {
    if (!rows.value || rows.value.length === 0) {
      toast.error('No data to download');
      return;
    }

    // Only keep keys that are declared subform fields — strip constants,
    // vars, __user__ and any other internals injected by AppForm.
    const subformFieldNames = (props.subform?.fields || []).map((f) => f.name);
    const cleanRows =
      subformFieldNames.length > 0
        ? rows.value.map((row) => {
            // `k in row` throws "Cannot use 'in' operator" on a scalar. That is
            // reachable: handleFileLoad stores whatever applySubformModeling returns,
            // and that helper passes non-object rows straight through - so loading a
            // YAML file holding a plain list ("- one") and pressing Download failed
            // with a TypeError message the user could make nothing of. A scalar row
            // has no named fields to filter, so it is kept as-is.
            if (!row || typeof row !== 'object') return row;
            const filtered = Object.fromEntries(subformFieldNames.filter((k) => k in row).map((k) => [k, row[k]]));
            return Helpers.stripInternalFields(filtered);
          })
        : Helpers.stripInternalFields(rows.value);

    const yamlContent = YAML.stringify(cleanRows);
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${props.name || 'list'}.yml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('List data downloaded as YAML');
  } catch (e) {
    toast.error(`Failed to download: ${e.message}`);
  }
}

// Local rows state synchronised with v-model.
const rows = ref(Array.isArray(props.modelValue) ? [...props.modelValue] : []);

watch(
  () => props.modelValue,
  (v) => {
    rows.value = Array.isArray(v) ? [...v] : [];
  },
  { deep: true },
);

function commit() {
  emit('update:modelValue', [...rows.value]);
}

// Markers (row state tracking). The names come from the
// form engine (@engine listMarkers), which is also what puts them in the extravars : if
// `allowDelete: false` or a delete/update marker is configured but no `insertMarker`,
// freshly added rows get `__inserted__` so they stay removable.
const markers = computed(() => listMarkers(props.field));
const insertMarker = computed(() => markers.value.insert);
const updateMarker = computed(() => markers.value.update);
const deleteMarker = computed(() => markers.value.delete);

// a marker goes on the row AND on its modelled output, so a `$(list)` placeholder - which
// reads `__output__` - sees the same row state as the playbook
function withMarker(row, marker, on = true) {
  const copy = { ...row };
  if (copy.__output__ && typeof copy.__output__ === 'object') copy.__output__ = { ...copy.__output__ };
  for (const target of [copy, copy.__output__].filter(Boolean)) {
    if (on) target[marker] = true;
    else delete target[marker];
  }
  return copy;
}
const allowInsert = computed(() => props.field.allowInsert !== false);
const allowDelete = computed(() => props.field.allowDelete !== false);

// Visible rows with their original index preserved.
const visibleRows = computed(() => rows.value.map((row, index) => ({ row, index })));

// Resolve the list of columns to display. Authors can pick a subset via
// `field.columns` (array of field-name strings). Unknown names are kept so
// authors can expose arbitrary data keys that aren't declared subform fields
// - the cell renderer falls back to a generic stringifier for those.
const columns = computed(() => {
  const subfields = props.subform?.fields || [];
  const byName = Object.fromEntries(subfields.map((f) => [f.name, f]));
  if (Array.isArray(props.field.columns) && props.field.columns.length > 0) {
    return props.field.columns.map((name) => byName[name] || { name, label: name, _unknown: true });
  }
  return subfields.filter((f) => !f.hide && f.type !== 'local' && f.type !== 'local_out');
});

// Cell rendering descriptor. Returns `{ kind, value }` where kind is one of:
//   'blank'  - empty string (rendered as nothing)
//   'null'   - null/undefined (rendered as italic 'null' badge)
//   'bool'   - checkbox-like icon
//   'count'  - array length (N items)
//   'object' - object literal (rendered as italic '{object}' badge)
//   'text'   - plain string
function cellData(row, f) {
  const v = row?.[f.name];
  if (v === undefined || v === null) return { kind: 'null' };
  if (v === '') return { kind: 'blank' };
  const type = f._unknown ? undefined : f.type;
  if (type === 'checkbox' || typeof v === 'boolean') {
    return { kind: 'bool', value: !!v };
  }
  if (type === 'list' || Array.isArray(v)) {
    if (Array.isArray(v)) {
      if (v.length === 0) return { kind: 'count', value: '0 items' };
      if (v.every((x) => x == null || typeof x !== 'object')) {
        return {
          kind: 'text',
          value: v
            .filter((x) => x != null)
            .map(String)
            .join(', '),
        };
      }
      return { kind: 'count', value: `${v.length} item${v.length === 1 ? '' : 's'}` };
    }
    return { kind: 'null' };
  }
  if (type === 'password') {
    return { kind: 'text', value: '•'.repeat(String(v).length) };
  }
  if (typeof v === 'object') {
    if (f.valueColumn && v[f.valueColumn] != null) {
      return { kind: 'text', value: String(v[f.valueColumn]) };
    }
    return { kind: 'object' };
  }
  return { kind: 'text', value: String(v) };
}

// Injected by the page-level orchestrator (see pages/form.vue). Provides
// push/pop operations for the tab stack. If missing (e.g. designer preview),
// fall back to no-op so the field still renders.
const editStack = inject('formEditStack', null);

function openEditor({ row, index }) {
  if (!editStack || !props.subform) return;
  const isAdd = index == null;
  // Tab title is always the parent list-field label (e.g. "People",
  // "Addresses") - short and consistent. The Add/Edit distinction is
  // shown as a subtitle inside the subform pane. Authors can override
  // via the field's `titleAdd` / `titleEdit` properties.
  const title = props.field.label || props.field.name || props.subform.description || props.subform.name;
  const subtitle = isAdd
    ? Helpers.resolveTitlePlaceholders(props.field.titleAdd || `Add ${title}`, props.parentFormData)
    : Helpers.resolveTitlePlaceholders(props.field.titleEdit || `Edit ${title}`, props.parentFormData);
  editStack.push({
    title,
    subtitle,
    subform: props.subform,
    row: row ? (({ __output__: _, ...rest }) => rest)(row) : defaultRow(),
    // De parentFormData bevat de wizard context -> hier gebruiken we de veilige kloon!
    parentData: Helpers.safeDeepClone(props.parentFormData),

    onSave: (value) => applySave(value, index),
  });
}

function defaultRow() {
  // Return an empty row. AppForm applies field defaults itself via
  // initiateDefaults() -> getDefaultValue(), which honours placeholder
  // resolution and `evalDefault` (yielding an empty field when the
  // expression's dependencies aren't ready, exactly like a top-level
  // form). Pre-filling raw `f.default` here would make AppForm treat
  // the value as user-supplied initialData and bypass that pipeline,
  // causing literal expressions like `$(otherfield) + 1` to appear
  // verbatim in the field instead of being evaluated (or left empty).
  return {};
}

function applySave(value, index) {
  const isAdd = index == null;

  if (isAdd) {
    if (insertMarker.value) value = withMarker(value, insertMarker.value);
    rows.value.push(value);
  } else {
    const existing = rows.value[index] || {};
    if (insertMarker.value && existing[insertMarker.value]) {
      value = withMarker(value, insertMarker.value);
    } else if (updateMarker.value) {
      value = withMarker(value, updateMarker.value);
    }
    rows.value.splice(index, 1, value);
  }

  // 1. Emit the updated rows to the parent v-model
  commit();

  // 2. THE WIZARD BYPASS: If we have parentFormData, write the update
  //    DIRECTLY into the central form object of the wizard.
  if (props.parentFormData && props.field && props.field.name) {
    // Ensure the array in the wizard state is directly overwritten with our new rows
    // eslint-disable-next-line vue/no-mutating-props -- parentFormData is handed over as a shared, writable wizard state object on purpose
    props.parentFormData[props.field.name] = [...rows.value];
  }

  // 3. Force the local ref to recompute for the visibleRows
  rows.value = [...rows.value];
}

function removeItem(index) {
  const row = rows.value[index];
  if (!row) return;
  if (insertMarker.value && row[insertMarker.value]) {
    rows.value.splice(index, 1);
  } else if (deleteMarker.value) {
    rows.value.splice(index, 1, withMarker(row, deleteMarker.value));
  } else {
    rows.value.splice(index, 1);
  }
  commit();
}

function undoRemove(index) {
  const row = rows.value[index];
  if (!row || !deleteMarker.value) return;
  rows.value.splice(index, 1, withMarker(row, deleteMarker.value, false));
  commit();
}

function isDeleted(row) {
  return deleteMarker.value && row[deleteMarker.value];
}

// When deletion is disabled, you can still delete rows you added in this
// session (i.e. rows carrying the insertMarker).
function canDelete(row) {
  if (allowDelete.value) return true;
  if (insertMarker.value && row && row[insertMarker.value]) return true;
  return false;
}
</script>

<template>
  <div>
    <!-- Missing subform placeholder -->
    <div v-if="!subform" class="alert alert-danger">
      Subform <code>{{ field.subform }}</code> referenced by field <code>{{ field.name }}</code> was not found.
    </div>

    <template v-else>
      <!-- Load/Download buttons -->
      <div v-if="showLoadButton || showDownloadButton" class="mb-2 d-flex gap-2">
        <BsButton v-if="showLoadButton" cssClass="btn-sm" icon="file-import" @click="triggerFileInput">
          Load YAML
        </BsButton>
        <BsButton
          v-if="showDownloadButton"
          cssClass="btn-sm"
          icon="download"
          @click="handleDownload"
          :disabled="!rows || rows.length === 0"
        >
          Download
        </BsButton>
        <input
          v-if="showLoadButton"
          ref="fileInputRef"
          type="file"
          accept=".yml,.yaml"
          @change="handleFileLoad"
          style="display: none"
        />
      </div>
      <div class="form-control" :class="{ 'is-invalid': hasError }">
        <table class="table table-bordered mb-0">
          <thead>
            <tr>
              <th style="width: 6rem">Actions</th>
              <th v-for="col in columns" :key="'list-th-' + col.name" class="bg-primary-subtle">
                {{ col.label || col.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ row, index } in visibleRows"
              :key="'list-row-' + index"
              :class="{ 'list-row-deleted': isDeleted(row) }"
            >
              <td>
                <template v-if="isDeleted(row)">
                  <span class="me-2 text-secondary"><font-awesome-icon icon="pencil-alt" /></span>
                  <span class="me-2 text-success" role="button" @click="undoRemove(index)"
                    ><font-awesome-icon icon="undo"
                  /></span>
                </template>
                <template v-else>
                  <span role="button" class="me-2 text-orange" @click="openEditor({ row, index })"
                    ><font-awesome-icon icon="pencil-alt"
                  /></span>
                  <span
                    role="button"
                    class="me-2"
                    :class="canDelete(row) ? 'text-danger' : 'text-secondary'"
                    @click="canDelete(row) && removeItem(index)"
                    ><font-awesome-icon icon="times"
                  /></span>
                </template>
              </td>
              <td v-for="col in columns" :key="'list-td-' + col.name + '-' + index" :class="col.bodyClass">
                <template v-if="cellData(row, col).kind === 'blank'"></template>
                <template v-else-if="cellData(row, col).kind === 'null'">
                  <span class="badge bg-secondary-subtle text-body-secondary">null</span>
                </template>
                <template v-else-if="cellData(row, col).kind === 'bool'">
                  <font-awesome-icon :icon="cellData(row, col).value ? ['far', 'check-square'] : ['far', 'square']" />
                </template>
                <template v-else-if="cellData(row, col).kind === 'count'">
                  <span class="badge bg-secondary-subtle text-body-secondary">{{ cellData(row, col).value }}</span>
                </template>
                <template v-else-if="cellData(row, col).kind === 'object'">
                  <span class="badge bg-secondary-subtle text-body-secondary">object</span>
                </template>
                <template v-else>{{ cellData(row, col).value }}</template>
              </td>
            </tr>
            <tr v-if="allowInsert">
              <td>
                <span role="button" class="me-2 text-success" @click="openEditor({ row: null, index: null })"
                  ><font-awesome-icon icon="plus-square"
                /></span>
              </td>
              <td v-for="col in columns" :key="'list-add-' + col.name" class="bg-secondary-subtle"></td>
            </tr>
            <tr v-if="!allowInsert && rows.length === 0">
              <td :colspan="columns.length + 1" class="text-muted">No items</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="hasError && errors.length > 0" class="invalid-feedback">
        {{ errors[0].$message || errors[0].$params?.description || errors[0] }}
      </div>
      <div class="form-text" v-if="help">{{ help }}</div>
    </template>
  </div>
</template>

<style scoped>
/* Soft-deleted rows: muted text with strikethrough on data cells.
   The first cell (actions column) keeps normal styling so the undo icon
   stays clearly tappable. */
.list-row-deleted > td {
  color: var(--bs-secondary-color);
  background-color: var(--bs-secondary-bg-subtle);
  text-decoration: line-through;
  text-decoration-color: var(--bs-secondary);
}
.list-row-deleted > td:first-child {
  text-decoration: none;
}
</style>
