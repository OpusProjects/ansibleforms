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

// where the dialog's category goes : after a row (its menu's Add category), else at the end
const insertAfter = ref(null);

/**
 * Opens the New category dialog on an empty category with the default icon.
 *
 * Args:
 *   after (object): { cat } - the category it goes after, at that one's level (its menu's Add
 *     category) ; none, the end of the tree (the toolbar's +).
 */
function addCategory(after = null) {
  // the table cannot be edited (read only, or its YAML cannot be read) : nothing added
  if (locked.value) return;
  insertAfter.value = after && after.cat ? after.cat : null;
  newCategory.value = { _uid: nextUid(), name: '', icon: DEFAULT_CATEGORY_ICON };
}

/**
 * The list a category is in : the tree's, or a parent category's items.
 *
 * Args:
 *   target (object): the category.
 *   list (object[]): the list to look in, the whole tree by default.
 *
 * Returns:
 *   object[]|null: its list, or null when it is not in the tree.
 */
function listOf(target, list = categories.value) {
  if (list.includes(target)) return list;
  for (const item of list) {
    const found = item.items && listOf(target, item.items);
    if (found) return found;
  }
  return null;
}

/**
 * Adds the dialog's category (saved with the designer's Save) : right after the category its
 * menu was opened on, or at the end of the tree.
 */
function createCategory() {
  const after = insertAfter.value;
  const list = after ? listOf(after) : null;
  if (list) list.splice(list.indexOf(after) + 1, 0, newCategory.value);
  else categories.value.push(newCategory.value);
  newCategory.value = null;
  insertAfter.value = null;
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
        t('designer.addCategory')
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
            <th class="af-row-menu-col"></th>
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
            <td class="bs-dt-row-actions">
              <!-- the row's menu, as every table's : add a category after it or under it, move it
                   (a move that cannot apply greyed), then delete, last -->
              <div v-if="!isDefaultCategory(row.cat, row.depth) && !locked" class="dropdown">
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
                    <a class="dropdown-item" href="#" @click.prevent="addCategory({ cat: row.cat })">
                      <FaIcon icon="plus" class="me-2" />{{ t('designer.addCategory') }}
                    </a>
                  </li>
                  <li>
                    <a class="dropdown-item" href="#" @click.prevent="addSubcategory(row.cat)">
                      <FaIcon icon="level-up-alt" class="me-2 fa-rotate-90" />{{ t('designer.addSubcategory') }}
                    </a>
                  </li>
                  <li><hr class="dropdown-divider" /></li>
                  <li>
                    <a
                      class="dropdown-item"
                      :class="{ disabled: !canMoveUp(categories, row.cat) }"
                      href="#"
                      @click.prevent="moveCategoryUp(categories, row.cat)"
                    >
                      <FaIcon icon="chevron-up" class="me-2" />{{ t('settings.settingsPage.moveUp') }}
                    </a>
                  </li>
                  <li>
                    <a
                      class="dropdown-item"
                      :class="{ disabled: !canMoveDown(categories, row.cat) }"
                      href="#"
                      @click.prevent="moveCategoryDown(categories, row.cat)"
                    >
                      <FaIcon icon="chevron-down" class="me-2" />{{ t('settings.settingsPage.moveDown') }}
                    </a>
                  </li>
                  <li>
                    <a
                      class="dropdown-item"
                      :class="{ disabled: !canIndent(categories, row.cat) }"
                      href="#"
                      @click.prevent="indentCategory(categories, row.cat)"
                    >
                      <FaIcon icon="indent" class="me-2" />{{ t('settings.settingsPage.indentCategory') }}
                    </a>
                  </li>
                  <li>
                    <a
                      class="dropdown-item"
                      :class="{ disabled: !canOutdent(categories, row.cat) }"
                      href="#"
                      @click.prevent="outdentCategory(categories, row.cat)"
                    >
                      <FaIcon icon="outdent" class="me-2" />{{ t('settings.settingsPage.outdentCategory') }}
                    </a>
                  </li>
                  <li><hr class="dropdown-divider" /></li>
                  <li>
                    <a class="dropdown-item text-danger" href="#" @click.prevent="removeCategory(row.cat)">
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
/* the table in a frame of the fields' grey, its header bar the tables' */
.af-visual-table {
  border: 1px solid var(--af-field-border);
  border-radius: 0.375rem;
  overflow: hidden;
}
/* the row's menu's column : narrow, its dots placed as every table's (bs-dt-row-actions) */
.af-row-menu-col {
  width: 3.5rem;
}
</style>
