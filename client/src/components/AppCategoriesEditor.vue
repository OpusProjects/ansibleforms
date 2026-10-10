<script setup>
/******************************************************************/
/*                                                                */
/*  The categories as a table : the designer's visual editor of   */
/*  its categories, beside their YAML, on the same text (saved    */
/*  with the designer's Save).                                    */
/*                                                                */
/*  @props:                                                       */
/*      modelValue: String - the categories' YAML (a list)        */
/*      readOnly: Boolean - shown, not editable                   */
/*  @emits:                                                       */
/*      update:modelValue - the YAML, rewritten from the table    */
/*                                                                */
/******************************************************************/
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_CATEGORY_ICON,
  nextUid,
  stampUids,
  normalizeCategories,
  buildCategories,
} from '@/composables/useFormsConfig';
import { useYamlModel } from '@/composables/useYamlModel';
import { availableIcons } from '@/config/icons';
import {
  isDefaultCategory,
  flattenCategories,
  canMoveUp,
  canMoveDown,
  canIndent,
  canOutdent,
  moveCategoryUp,
  moveCategoryDown,
  indentCategory,
  outdentCategory,
  movedCategoryPaths,
} from '@/config/categories';

const props = defineProps({
  modelValue: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

// ─── the YAML as rows ─────────────────────────────────────────────────────────
const { rows: categories, error } = useYamlModel(props, emit, {
  toRows(value) {
    if (value != null && !Array.isArray(value)) throw new Error(t('designer.visualNotAList'));
    const tree = normalizeCategories(value || []);
    stampUids(tree, ['items']);
    return tree;
  },
  fromRows: buildCategories,
});

const locked = computed(() => props.readOnly || !!error.value);
const flatCats = computed(() => flattenCategories(categories.value));

// the tree as it was first read : a category is addressed by its PATH, so a move or a rename
// leaves the forms pointing at the old path - said, not refused (reorganizing is the point)
const firstTree = ref(JSON.parse(JSON.stringify(categories.value)));
const movedPaths = computed(() => movedCategoryPaths(firstTree.value, categories.value));

// ─── what the server would refuse : said here, as the row is typed ───────────
// the schema's category name (server/schema/base_schema.json) : 2 to 50 characters, no slash ;
// 'u' counts code points, as ajv does
const categoryNameRegex = /^[^/]{2,50}$/u;

const invalidCategory = computed(() => {
  const list = flatCats.value;
  for (let i = 0; i < list.length; i++) {
    const name = (list[i].cat.name || '').trim();
    if (!categoryNameRegex.test(name)) return { row: i + 1, name };
  }
  return null;
});

// siblings share a path when they share a name : the menu cannot tell them apart
function findDuplicate(cats) {
  const seen = new Set();
  for (const cat of cats) {
    const name = (cat.name || '').trim();
    if (name) {
      if (seen.has(name)) return name;
      seen.add(name);
    }
    if (cat.items?.length) {
      const duplicate = findDuplicate(cat.items);
      if (duplicate) return duplicate;
    }
  }
  return null;
}
const duplicateCategory = computed(() => findDuplicate(categories.value));

// ─── editing ──────────────────────────────────────────────────────────────────
const newCategory = ref(null);

/**
 * Opens the New category dialog on an empty category with the default icon.
 */
function addCategory() {
  // the table cannot be edited (read only, or its YAML cannot be read) : nothing added
  if (locked.value) return;
  newCategory.value = { _uid: nextUid(), name: '', icon: DEFAULT_CATEGORY_ICON };
}

/**
 * Adds the dialog's category at the end of the tree (saved with the designer's Save).
 */
function createCategory() {
  categories.value.push(newCategory.value);
  newCategory.value = null;
}

/**
 * Adds an empty subcategory under a category.
 *
 * Args:
 *   parent (object): the category.
 */
function addSubcategory(parent) {
  if (!parent.items) parent.items = [];
  parent.items.push({ _uid: nextUid(), name: '', icon: DEFAULT_CATEGORY_ICON });
}

/**
 * Removes a category (and its subcategories) from the tree.
 *
 * Args:
 *   cat (object): the category.
 *   list (object[]): the list to look in, the whole tree by default.
 *
 * Returns:
 *   boolean: true when it was found and removed.
 */
function removeCategory(cat, list = categories.value) {
  const idx = list.indexOf(cat);
  if (idx >= 0) {
    list.splice(idx, 1);
    return true;
  }
  return list.some((item) => item.items && removeCategory(cat, item.items));
}

// the designer's toolbar adds a row (its + button)
defineExpose({ add: addCategory, locked });
</script>
<template>
  <BsModal v-if="newCategory" size="lg" @close="newCategory = null">
    <template #title> <FaIcon icon="sitemap" class="me-2" />{{ t('settings.settingsPage.newCategory') }} </template>
    <template #default>
      <BsInput :isFloating="false" v-model="newCategory.name" :label="t('settings.settingsPage.name')" />
      <label class="form-label fw-bold">{{ t('settings.settingsPage.icon') }}</label>
      <div class="input-group">
        <span class="input-group-text"><FaIcon :icon="newCategory.icon || 'question'" class="fa-fw" /></span>
        <select class="form-select" v-model="newCategory.icon">
          <option v-for="ic in availableIcons" :key="ic" :value="ic">{{ ic }}</option>
        </select>
      </div>
    </template>
    <template #footer>
      <BsButton icon="plus" :disabled="!newCategory.name.trim()" @click="createCategory()">{{
        t('settings.settingsPage.addCategory')
      }}</BsButton>
    </template>
  </BsModal>
  <div class="af-visual-editor">
    <!-- the YAML cannot be read as categories : said, and nothing editable until fixed there -->
    <div v-if="error" class="alert alert-danger py-2 mb-3" role="alert">
      <FaIcon icon="triangle-exclamation" class="me-2" />{{ t('designer.visualYamlError') }} : {{ error }}
    </div>
    <div v-if="!error && invalidCategory" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.invalidCategoryName', invalidCategory) }}
    </div>
    <div v-if="!error && duplicateCategory" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.duplicateCategoryName', { name: duplicateCategory }) }}
    </div>
    <div v-if="!error && movedPaths.length > 0" class="alert alert-warning py-2 mb-3" role="alert">
      {{ t('settings.settingsPage.categoryPathsChanged', { paths: movedPaths.join(', ') }) }}
    </div>
    <div v-if="categories.length === 0" class="empty-state">
      <FaIcon icon="sitemap" class="empty-state-icon" />
      <span>{{ t('settings.settingsPage.noCategories') }}</span>
    </div>
    <div v-else class="af-visual-table">
      <table class="table af-table config-table mb-0">
        <thead>
          <tr>
            <th>{{ t('settings.settingsPage.name') }}</th>
            <th>{{ t('settings.settingsPage.icon') }}</th>
            <th class="col-action-move"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in flatCats" :key="row.cat._uid">
            <td>
              <div class="d-flex align-items-center" :style="{ paddingLeft: row.depth * 1.5 + 'rem' }">
                <FaIcon
                  v-if="row.depth > 0"
                  icon="level-up-alt"
                  class="text-muted me-2 fa-rotate-90"
                  style="font-size: 0.75rem"
                />
                <input
                  class="form-control form-control-sm"
                  v-model="row.cat.name"
                  :disabled="isDefaultCategory(row.cat, row.depth) || locked"
                />
              </div>
            </td>
            <td>
              <div class="d-flex align-items-center gap-2">
                <FaIcon :icon="row.cat.icon || 'question'" class="text-muted" />
                <select
                  class="form-select form-select-sm"
                  v-model="row.cat.icon"
                  :disabled="isDefaultCategory(row.cat, row.depth) || locked"
                >
                  <!-- a hand-written icon not in the list : offered, so it stays visible -->
                  <option v-if="row.cat.icon && !availableIcons.includes(row.cat.icon)" :value="row.cat.icon">
                    {{ row.cat.icon }}
                  </option>
                  <option v-for="ic in availableIcons" :key="ic" :value="ic">{{ ic }}</option>
                </select>
              </div>
            </td>
            <td class="text-center align-middle">
              <!-- move up and down, indent under the row above and back out ; disabled rather
                   than hidden, so nothing shifts under the pointer as rows move -->
              <div
                v-if="!isDefaultCategory(row.cat, row.depth) && !locked"
                class="d-flex justify-content-center gap-1 cat-actions"
              >
                <div class="btn-group btn-group-sm" role="group">
                  <button
                    class="btn btn-outline-secondary"
                    :disabled="!canMoveUp(categories, row.cat)"
                    @click="moveCategoryUp(categories, row.cat)"
                    :title="t('settings.settingsPage.moveUp')"
                  >
                    <FaIcon icon="chevron-up" />
                  </button>
                  <button
                    class="btn btn-outline-secondary"
                    :disabled="!canMoveDown(categories, row.cat)"
                    @click="moveCategoryDown(categories, row.cat)"
                    :title="t('settings.settingsPage.moveDown')"
                  >
                    <FaIcon icon="chevron-down" />
                  </button>
                  <button
                    class="btn btn-outline-secondary"
                    :disabled="!canIndent(categories, row.cat)"
                    @click="indentCategory(categories, row.cat)"
                    :title="t('settings.settingsPage.indentCategory')"
                  >
                    <FaIcon icon="indent" />
                  </button>
                  <button
                    class="btn btn-outline-secondary"
                    :disabled="!canOutdent(categories, row.cat)"
                    @click="outdentCategory(categories, row.cat)"
                    :title="t('settings.settingsPage.outdentCategory')"
                  >
                    <FaIcon icon="outdent" />
                  </button>
                </div>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  @click="addSubcategory(row.cat)"
                  :title="t('settings.settingsPage.addSubcategory')"
                >
                  <FaIcon icon="plus" />
                </button>
                <button class="btn btn-sm btn-outline-danger" @click="removeCategory(row.cat)">
                  <FaIcon icon="trash" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
<style scoped lang="scss">
/* the table in a frame of the fields' grey, its header bar the tables' */
.af-visual-table {
  border: 1px solid var(--af-field-border);
  border-radius: 0.375rem;
  overflow: hidden;
}
/* six controls in a cell that cannot grow : their padding trimmed, not their size */
.cat-actions .btn {
  --bs-btn-padding-x: 0.4rem;
  white-space: nowrap;
}
/* a control that cannot apply reads as unclickable */
.cat-actions .btn:disabled {
  --bs-btn-disabled-color: var(--bs-secondary-color);
  --bs-btn-disabled-border-color: var(--bs-border-color);
  --bs-btn-disabled-opacity: 0.45;
}
</style>
