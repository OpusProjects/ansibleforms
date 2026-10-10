<script setup>
/******************************************************************/
/*                                                                */
/*  The constants as a table : the designer's visual editor of    */
/*  its constants, beside their YAML, on the same text (saved     */
/*  with the designer's Save).                                    */
/*                                                                */
/*  @props:                                                       */
/*      modelValue: String - the constants' YAML (a map)          */
/*      readOnly: Boolean - shown, not editable                   */
/*  @emits:                                                       */
/*      update:modelValue - the YAML, rewritten from the table    */
/*                                                                */
/******************************************************************/
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { nextUid, stampUids } from '@/composables/useFormsConfig';
import { useYamlModel } from '@/composables/useYamlModel';
import {
  constantsToArray,
  arrayToConstants,
  flattenConstants,
  constantValueError,
  constantValueRows,
} from '@/config/constants';

const props = defineProps({
  modelValue: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

// ─── the YAML as rows ─────────────────────────────────────────────────────────
const { rows: constants, error } = useYamlModel(props, emit, {
  toRows(value) {
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(t('designer.visualNotAMap'));
    }
    const tree = constantsToArray(value || {});
    stampUids(tree, ['children']);
    return tree;
  },
  fromRows: arrayToConstants,
});

const locked = computed(() => props.readOnly || !!error.value);
const flatConstants = computed(() => flattenConstants(constants.value));

/**
 * Whether a row holds subkeys rather than a value.
 *
 * Args:
 *   row (object): the row.
 *
 * Returns:
 *   boolean: true when it has subkeys.
 */
function isParent(row) {
  return row.children && row.children.length > 0;
}

// ─── what would be lost or refused : said here, as the row is typed ──────────
// a row without a key is dropped from the YAML, value and all
const keylessRow = computed(() => {
  const list = flatConstants.value;
  for (let i = 0; i < list.length; i++) if (!(list[i].row.key || '').trim()) return i + 1;
  return null;
});

// two siblings with one key collapse into one
function findDuplicate(rows) {
  const seen = new Set();
  for (const row of rows) {
    const key = (row.key || '').trim();
    if (key) {
      if (seen.has(key)) return key;
      seen.add(key);
    }
    if (isParent(row)) {
      const duplicate = findDuplicate(row.children);
      if (duplicate) return duplicate;
    }
  }
  return null;
}
const duplicateKey = computed(() => findDuplicate(constants.value));

// a value meant as a list or a map that is no valid YAML would be stored as its text
function findInvalidValue(rows) {
  for (const row of rows) {
    if (!isParent(row)) {
      const message = constantValueError(row.value);
      if (message) return { key: (row.key || '').trim(), error: message };
    } else {
      const invalid = findInvalidValue(row.children);
      if (invalid) return invalid;
    }
  }
  return null;
}
const invalidValue = computed(() => findInvalidValue(constants.value));

// ─── editing ──────────────────────────────────────────────────────────────────
const newConstant = ref(null);

/**
 * Opens the New constant dialog on an empty constant.
 */
function addConstant() {
  newConstant.value = { _uid: nextUid(), key: '', value: '', children: [] };
}

/**
 * Adds the dialog's constant to the table (saved with the designer's Save).
 */
function createConstant() {
  constants.value.push(newConstant.value);
  newConstant.value = null;
}

/**
 * Adds an empty subkey under a row : the row then holds subkeys, not a value.
 *
 * Args:
 *   parent (object): the row.
 */
function addSubconstant(parent) {
  if (!parent.children) parent.children = [];
  parent.value = '';
  parent.children.push({ _uid: nextUid(), key: '', value: '', children: [] });
}

/**
 * Removes a row (and its subkeys).
 *
 * Args:
 *   target (object): the row.
 *   list (object[]): the list to look in, the whole table by default.
 *
 * Returns:
 *   boolean: true when it was found and removed.
 */
function removeConstant(target, list = constants.value) {
  const idx = list.indexOf(target);
  if (idx !== -1) {
    list.splice(idx, 1);
    return true;
  }
  return list.some((item) => item.children && removeConstant(target, item.children));
}

// the designer's toolbar adds a row (its + button)
defineExpose({ add: addConstant });
</script>
<template>
  <BsModal v-if="newConstant" size="lg" @close="newConstant = null">
    <template #title> <FaIcon icon="sliders-h" class="me-2" />{{ t('settings.settingsPage.newConstant') }} </template>
    <template #default>
      <BsInput :isFloating="false" v-model="newConstant.key" :label="t('settings.settingsPage.key')" />
      <label class="form-label fw-bold">{{ t('settings.settingsPage.value') }}</label>
      <textarea
        class="form-control"
        :rows="Math.max(3, constantValueRows(newConstant.value))"
        v-model="newConstant.value"
        :placeholder="t('settings.settingsPage.constantValuePlaceholder')"
      ></textarea>
    </template>
    <template #footer>
      <BsButton icon="plus" :disabled="!newConstant.key.trim()" @click="createConstant()">{{
        t('settings.settingsPage.addConstant')
      }}</BsButton>
    </template>
  </BsModal>
  <div class="af-visual-editor">
    <div v-if="error" class="alert alert-danger py-2 mb-3" role="alert">
      <FaIcon icon="triangle-exclamation" class="me-2" />{{ t('designer.visualYamlError') }} : {{ error }}
    </div>
    <div v-if="!error && keylessRow" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.constantKeyRequired', { row: keylessRow }) }}
    </div>
    <div v-if="!error && duplicateKey" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.duplicateConstantKey', { key: duplicateKey }) }}
    </div>
    <div v-if="!error && invalidValue" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.constantValueInvalid', invalidValue) }}
    </div>
    <div v-if="constants.length === 0" class="empty-state">
      <FaIcon icon="sliders-h" class="empty-state-icon" />
      <span>{{ t('settings.settingsPage.noConstants') }}</span>
    </div>
    <div v-else class="af-visual-table">
      <table class="table af-table config-table mb-0">
        <thead>
          <tr>
            <th>{{ t('settings.settingsPage.key') }}</th>
            <th>{{ t('settings.settingsPage.value') }}</th>
            <th class="af-row-menu-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in flatConstants" :key="entry.row._uid">
            <td>
              <div class="d-flex align-items-center" :style="{ paddingLeft: entry.depth * 1.5 + 'rem' }">
                <FaIcon
                  v-if="entry.depth > 0"
                  icon="level-up-alt"
                  class="text-muted fa-rotate-90 flex-shrink-0 me-2"
                  style="font-size: 0.75rem"
                />
                <input class="form-control form-control-sm" v-model="entry.row.key" :disabled="locked" />
              </div>
            </td>
            <td>
              <!-- a textarea : a list or a map is written as YAML, on several lines -->
              <textarea
                v-if="!isParent(entry.row)"
                class="form-control form-control-sm"
                :rows="constantValueRows(entry.row.value)"
                v-model="entry.row.value"
                :disabled="locked"
                :placeholder="t('settings.settingsPage.constantValuePlaceholder')"
              ></textarea>
              <span v-else class="text-muted fst-italic small">{{
                t('settings.settingsPage.subkeyCount', entry.row.children.length)
              }}</span>
            </td>
            <td class="bs-dt-row-actions">
              <!-- the row's menu, as every table's : add a subkey, then delete, last -->
              <div v-if="!locked" class="dropdown">
                <a
                  role="button"
                  class="bs-dt-row-menu px-2"
                  data-bs-toggle="dropdown"
                  data-bs-popper-config='{"strategy":"fixed"}'
                  @click.stop
                >
                  <FaIcon icon="ellipsis-vertical" />
                </a>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li>
                    <a class="dropdown-item" href="#" @click.prevent="addSubconstant(entry.row)">
                      <FaIcon icon="plus" class="me-2" />{{ t('settings.settingsPage.addSubconstant') }}
                    </a>
                  </li>
                  <li><hr class="dropdown-divider" /></li>
                  <li>
                    <a class="dropdown-item text-danger" href="#" @click.prevent="removeConstant(entry.row)">
                      <FaIcon icon="trash" class="me-2" />{{ t('common.delete') }}
                    </a>
                  </li>
                </ul>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<style scoped lang="scss">
/* the row's menu's column : narrow, its dots placed as every table's (bs-dt-row-actions) */
.af-row-menu-col {
  width: 3.5rem;
}
/* the table in a frame of the fields' grey, its header bar the tables' */
.af-visual-table {
  border: 1px solid var(--af-field-border);
  border-radius: 0.375rem;
  overflow: hidden;
}
</style>
