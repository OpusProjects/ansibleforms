<script setup>
import { ref, computed, onMounted } from 'vue';
import Profile from '@/lib/Profile';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { useFormsConfig } from '@/composables/useFormsConfig';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { flattenConstants, constantValueError, constantValueRows } from '@/config/constants';

const { t } = useI18n();
const authenticated = ref(false);
const { constants, load, save, isConstantsDirty, parseError, isTemplated, loadError, nextUid } = useFormsConfig();

// This page had no unsaved-changes guard at all : navigating away or reloading threw
// the whole edit away silently. See useUnsavedGuard.
useUnsavedGuard(isConstantsDirty, () => t('settings.common.unsavedChanges'));

const readOnly = computed(() => parseError.value || isTemplated.value || !!loadError.value);

const flatConstants = computed(() => flattenConstants(constants.value));

function isParent(row) {
  return row.children && row.children.length > 0;
}

// A value that is meant to be a list or a map but cannot be parsed would be
// stored as its own source text, which reads back as a string : refuse the save
// and say which key, rather than write something that silently is not a list.
function findInvalidConstantValue(arr) {
  for (const row of arr) {
    if (!(row.children && row.children.length > 0)) {
      const error = constantValueError(row.value);
      if (error) return { key: (row.key || '').trim(), error };
    }
    if (row.children && row.children.length > 0) {
      const invalid = findInvalidConstantValue(row.children);
      if (invalid) return invalid;
    }
  }
  return null;
}

function addConstant() {
  constants.value.push({ _uid: nextUid(), key: '', value: '', children: [] });
}

function addSubconstant(parentRow) {
  if (!parentRow.children) parentRow.children = [];
  // a constant either holds a value or holds subkeys : the tree is serialized
  // children-first, so a value left on a row that just gained subkeys would be
  // dropped on save. Clear it here so the table shows what will actually persist.
  parentRow.value = '';
  parentRow.children.push({ _uid: nextUid(), key: '', value: '', children: [] });
}

// A row without a key is dropped on serialize, value and all : returns the first
// such row (1-based, in table order) so the save can be refused instead of
// losing what the user typed.
function findKeylessConstant() {
  const rows = flatConstants.value;
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i].row.key || '').trim()) return i + 1;
  }
  return null;
}

// Sibling keys must be unique : the tree is rebuilt into a plain object, so two
// rows sharing a key at the same level would silently collapse into one.
function findDuplicateKey(arr) {
  const seen = new Set();
  for (const row of arr) {
    const key = (row.key || '').trim();
    if (key) {
      if (seen.has(key)) return key;
      seen.add(key);
    }
    if (row.children && row.children.length > 0) {
      const duplicate = findDuplicateKey(row.children);
      if (duplicate) return duplicate;
    }
  }
  return null;
}

function removeConstant(target, list) {
  if (!list) list = constants.value;
  const idx = list.indexOf(target);
  if (idx !== -1) {
    list.splice(idx, 1);
    return true;
  }
  for (const item of list) {
    if (item.children && removeConstant(target, item.children)) return true;
  }
  return false;
}

async function saveConstants() {
  const keyless = findKeylessConstant();
  if (keyless) {
    toast.warning(t('settings.settingsPage.constantKeyRequired', { row: keyless }));
    return;
  }
  const duplicate = findDuplicateKey(constants.value);
  if (duplicate) {
    toast.warning(t('settings.settingsPage.duplicateConstantKey', { key: duplicate }));
    return;
  }
  const invalid = findInvalidConstantValue(constants.value);
  if (invalid) {
    toast.warning(t('settings.settingsPage.constantValueInvalid', invalid));
    return;
  }
  await save(t('settings.settingsPage.constants'));
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="sliders-h"
        :title="t('settings.settingsPage.constants')"
        :description="t('settings.settingsPage.constantsDescription')"
      >
        <template #default>
          <div class="pt-2">
            <div v-if="loadError" class="alert alert-danger" role="alert">
              {{ t('settings.common.failedToLoad') }} : {{ loadError }}
            </div>
            <div v-if="constants.length === 0" class="empty-state">
              <FaIcon icon="sliders-h" class="empty-state-icon" />
              <span>{{ t('settings.settingsPage.noConstants') }}</span>
            </div>
            <table v-else class="table table-sm table-bordered mb-2 config-table">
              <thead>
                <tr>
                  <th>{{ t('settings.settingsPage.key') }}</th>
                  <th>{{ t('settings.settingsPage.value') }}</th>
                  <th class="col-action"></th>
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
                      <input class="form-control form-control-sm" v-model="entry.row.key" :disabled="readOnly" />
                    </div>
                  </td>
                  <td>
                    <!-- a textarea, not an input : a list is written as yaml, which
                         needs more than one line. It renders as a single row until the
                         value actually has one, so a plain constant looks unchanged. -->
                    <textarea
                      v-if="!isParent(entry.row)"
                      class="form-control form-control-sm"
                      :rows="constantValueRows(entry.row.value)"
                      v-model="entry.row.value"
                      :disabled="readOnly"
                      :placeholder="t('settings.settingsPage.constantValuePlaceholder')"
                    ></textarea>
                    <span v-else class="text-muted fst-italic small">{{
                      t('settings.settingsPage.subkeyCount', entry.row.children.length)
                    }}</span>
                  </td>
                  <td class="text-center">
                    <div v-if="!readOnly" class="d-flex justify-content-center gap-1">
                      <button
                        class="btn btn-sm btn-outline-secondary"
                        @click="addSubconstant(entry.row)"
                        :title="t('settings.settingsPage.addSubconstant')"
                      >
                        <FaIcon icon="plus" />
                      </button>
                      <button class="btn btn-sm btn-outline-danger" @click="removeConstant(entry.row)">
                        <FaIcon icon="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="d-flex justify-content-end mt-3">
              <BsButton icon="plus" colorClass="secondary" :disabled="readOnly" @click="addConstant()">{{
                t('settings.settingsPage.addConstant')
              }}</BsButton>
            </div>
          </div>
        </template>
        <template #actions>
          <BsButton
            icon="save"
            :colorClass="isConstantsDirty ? 'primary' : 'secondary'"
            :disabled="!isConstantsDirty || readOnly"
            @click="saveConstants()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
