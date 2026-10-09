<script setup>
/******************************************************************/
/*                                                                */
/*  The Columns button of a table : a checkbox per column, and    */
/*  named presets of hidden columns kept in this browser          */
/*  (localStorage, per table `name`). Shared by BsDataTable and   */
/*  the jobs page.                                                */
/*                                                                */
/*  @props:                                                       */
/*      columns: Array of { key, label }                          */
/*      hidden: Set - the hidden column keys                      */
/*      name: String - the presets' storage key ; no presets      */
/*            without it                                          */
/*      buttonClass: String - the button's classes                */
/*                                                                */
/*  @emits:                                                       */
/*      toggle: a column was ticked or unticked (its key)         */
/*      apply: a preset was chosen (the Set of hidden keys)       */
/*                                                                */
/******************************************************************/

import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  columns: { type: Array, required: true },
  hidden: { type: Object, default: () => new Set() },
  name: { type: String, default: null },
  buttonClass: { type: String, default: 'btn-sm btn-outline-secondary' },
});
const emit = defineEmits(['toggle', 'apply']);

const { t } = useI18n();

// A named set of hidden columns. Storage can be unavailable (private window, blocked site
// data) : the presets then simply do not persist, and the table works as before.
const presets = ref([]);
const presetNameInput = ref('');
const showPresetInput = ref(false);

function loadPresets() {
  if (!props.name) return;
  try {
    const raw = localStorage.getItem(`dt_presets_${props.name}`);
    const parsed = raw ? JSON.parse(raw) : [];
    presets.value = Array.isArray(parsed)
      ? parsed.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.hidden))
      : [];
  } catch (e) {
    presets.value = [];
  }
}

function savePresetsToStorage() {
  if (!props.name) return;
  try {
    localStorage.setItem(`dt_presets_${props.name}`, JSON.stringify(presets.value));
  } catch (e) {
    /* not persisted */
  }
}

function savePreset() {
  const name = presetNameInput.value.trim();
  if (!name) return;
  const hidden = [...props.hidden];
  const idx = presets.value.findIndex((p) => p.name === name);
  if (idx >= 0) presets.value[idx] = { name, hidden };
  else presets.value.push({ name, hidden });
  savePresetsToStorage();
  presetNameInput.value = '';
  showPresetInput.value = false;
}

function deletePreset(name) {
  presets.value = presets.value.filter((p) => p.name !== name);
  savePresetsToStorage();
}

onMounted(loadPresets);
</script>
<template>
  <div class="dropdown">
    <button
      class="btn dropdown-toggle"
      :class="buttonClass"
      type="button"
      data-bs-toggle="dropdown"
      data-bs-auto-close="outside"
    >
      <font-awesome-icon icon="table-columns" class="me-1" />{{ t('dataTable.columns') }}
    </button>
    <ul class="dropdown-menu dropdown-menu-end" style="min-width: 220px">
      <li v-for="col in columns" :key="'cp-' + col.key" class="dropdown-item">
        <label class="form-check mb-0 d-flex align-items-center gap-2" style="cursor: pointer">
          <input
            type="checkbox"
            class="form-check-input"
            :checked="!hidden.has(col.key)"
            @change="emit('toggle', col.key)"
          />
          {{ col.label }}
        </label>
      </li>
      <!-- Presets -->
      <template v-if="name">
        <li><hr class="dropdown-divider my-1" /></li>
        <li class="px-3 py-1 bs-cp-presets-header">{{ t('dataTable.presets') }}</li>
        <li v-for="preset in presets" :key="'preset-' + preset.name" class="px-2 py-1 d-flex align-items-center gap-1">
          <button
            class="btn btn-sm btn-link text-start p-0 flex-grow-1 text-truncate text-body text-decoration-none"
            :title="preset.name"
            @click.stop="emit('apply', new Set(preset.hidden))"
          >
            <font-awesome-icon icon="table-columns" class="me-1 text-muted" />{{ preset.name }}
          </button>
          <button
            class="btn btn-link p-0 text-danger"
            :title="t('dataTable.presetDelete')"
            @click.stop="deletePreset(preset.name)"
          >
            <font-awesome-icon icon="times" />
          </button>
        </li>
        <li v-if="!presets.length" class="px-3 py-1 text-muted small">{{ t('dataTable.presetsEmpty') }}</li>
        <li class="px-2 py-1">
          <div v-if="showPresetInput" class="d-flex gap-1" @click.stop>
            <input
              v-model="presetNameInput"
              class="form-control form-control-sm"
              :placeholder="t('dataTable.presetNamePlaceholder')"
              @keyup.enter="savePreset"
              @keyup.escape="showPresetInput = false"
            />
            <button class="btn btn-sm btn-primary px-2" :title="t('dataTable.presetSave')" @click.stop="savePreset">
              <font-awesome-icon icon="check" />
            </button>
            <button class="btn btn-sm btn-outline-secondary px-2" @click.stop="showPresetInput = false">
              <font-awesome-icon icon="times" />
            </button>
          </div>
          <button v-else class="btn btn-sm btn-outline-secondary w-100" @click.stop="showPresetInput = true">
            <font-awesome-icon icon="floppy-disk" class="me-1" />{{ t('dataTable.presetSaveAs') }}
          </button>
        </li>
      </template>
    </ul>
  </div>
</template>
<style scoped>
/* open, the button is filled : its label stays white (the theme forces the outline button's
   text to its colour with !important, which made it vanish into the fill) */
.dropdown > .btn.btn-outline-primary.show,
.dropdown > .btn.btn-outline-primary:active {
  color: #fff !important;
  background-color: var(--bs-primary);
  border-color: var(--bs-primary);
}
.bs-cp-presets-header {
  font-size: 0.78em;
  color: var(--bs-secondary-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
