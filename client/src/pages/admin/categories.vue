<script setup>
import { ref, computed, onMounted } from 'vue';
import Profile from '@/lib/Profile';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { useFormsConfig, DEFAULT_CATEGORY_ICON } from '@/composables/useFormsConfig';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
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

const { t } = useI18n();
const authenticated = ref(false);
const { categories, load, save, isCategoriesDirty, parseError, isTemplated, loadError, nextUid } = useFormsConfig();

// This page had no unsaved-changes guard at all : navigating away or reloading threw
// the whole edit away silently. See useUnsavedGuard.
useUnsavedGuard(isCategoriesDirty, () => t('settings.common.unsavedChanges'));

const readOnly = computed(() => parseError.value || isTemplated.value || !!loadError.value);

// The tree as it was loaded, to compare paths against. Deep copied : the editor
// mutates the live tree in place, so a reference would always agree with itself.
const loadedCategories = ref(null);
function rememberLoaded() {
  loadedCategories.value = JSON.parse(JSON.stringify(categories.value));
}

const flatCats = computed(() => flattenCategories(categories.value));

// Nesting was buildable but not editable : a category could be created under a
// parent and never moved again, so restructuring meant deleting a whole subtree
// and typing it back. These four reorganize the tree in place.
function moveUp(cat) {
  moveCategoryUp(categories.value, cat);
}
function moveDown(cat) {
  moveCategoryDown(categories.value, cat);
}
function indent(cat) {
  indentCategory(categories.value, cat);
}
function outdent(cat) {
  outdentCategory(categories.value, cat);
}

// A category is addressed by its PATH, so moving one renames it and all its
// descendants. Forms still pointing at the old path keep loading, they simply
// stop appearing under that category - silent unless it is said out loud.
// Renaming has always done this too, which is why this reports rather than
// refuses : reorganizing on purpose is the normal case.
const movedPaths = computed(() => {
  if (!loadedCategories.value) return [];
  return movedCategoryPaths(loadedCategories.value, categories.value);
});

// Same rule the server enforces on every category, at any depth
// (server/schema/base_schema.json, /category name pattern) : 2 to 50 characters
// and no slash. Checked here so the save is blocked with a readable message
// instead of a raw schema error.
// The 'u' flag is not cosmetic : ajv compiles schema patterns with it, so it
// counts code points. Without it a single emoji reads as 2 characters and slips
// past this check only to be refused by the server, and a 26 emoji name is
// blocked here even though the server accepts it.
const categoryNameRegex = /^[^/]{2,50}$/u;

// Returns the first offending row (1-based, in table order) or null. The name is
// tested TRIMMED, exactly as it gets serialized : the pattern alone accepts a
// whitespace-only name, which is schema-valid but renders as a blank menu entry.
function findInvalidCategory() {
  const rows = flatCats.value;
  for (let i = 0; i < rows.length; i++) {
    const name = (rows[i].cat.name || '').trim();
    if (!categoryNameRegex.test(name)) return { row: i + 1, name };
  }
  return null;
}

// Sibling names must be unique : a category is addressed by its slash-joined
// path (a form's `categories: [Parent/Child]`, AppMenuItem.inCategory), so two
// siblings sharing a name are the same path and cannot be told apart, and the
// menu even keys its root entries on the name. The schema has no such rule and
// the same name under different parents is a different path, so this is a UX
// guard scoped to siblings only -- it never rejects a config the server accepts
// for any other reason.
function findDuplicateCategory(cats) {
  const seen = new Set();
  for (const cat of cats) {
    const name = (cat.name || '').trim();
    if (name) {
      if (seen.has(name)) return name;
      seen.add(name);
    }
    if (cat.items && cat.items.length > 0) {
      const duplicate = findDuplicateCategory(cat.items);
      if (duplicate) return duplicate;
    }
  }
  return null;
}

function addCategory() {
  categories.value.push({ _uid: nextUid(), name: '', icon: DEFAULT_CATEGORY_ICON });
}

function addSubcategory(parentCat) {
  if (!parentCat.items) parentCat.items = [];
  parentCat.items.push({ _uid: nextUid(), name: '', icon: DEFAULT_CATEGORY_ICON });
}

function removeCategory(cat, list) {
  if (!list) list = categories.value;
  const idx = list.indexOf(cat);
  if (idx >= 0) {
    list.splice(idx, 1);
    return true;
  }
  for (const item of list) {
    if (item.items && removeCategory(cat, item.items)) return true;
  }
  return false;
}

async function saveCategories() {
  const invalid = findInvalidCategory();
  if (invalid) {
    toast.warning(t('settings.settingsPage.invalidCategoryName', invalid));
    return;
  }
  const duplicate = findDuplicateCategory(categories.value);
  if (duplicate) {
    toast.warning(t('settings.settingsPage.duplicateCategoryName', { name: duplicate }));
    return;
  }
  // save() reloads on success, so the baseline has to follow or the moved-paths
  // notice would keep describing a tree that is now the stored one
  if (await save(t('settings.settingsPage.categories'))) rememberLoaded();
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
  rememberLoaded();
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="th-list"
        :title="t('settings.settingsPage.categories')"
        :description="t('settings.settingsPage.categoriesDescription')"
      >
        <template #default>
          <div class="pt-2">
            <div v-if="loadError" class="alert alert-danger" role="alert">
              {{ t('settings.common.failedToLoad') }} : {{ loadError }}
            </div>
            <!-- a form references a category by its PATH, so a move or a rename
                 leaves those forms pointing at something that is no longer there -->
            <div v-if="movedPaths.length > 0" class="alert alert-warning py-2" role="alert">
              {{ t('settings.settingsPage.categoryPathsChanged', { paths: movedPaths.join(', ') }) }}
            </div>
            <div v-if="categories.length === 0" class="empty-state">
              <FaIcon icon="th-list" class="empty-state-icon" />
              <span>{{ t('settings.settingsPage.noCategories') }}</span>
            </div>
            <table v-else class="table table-sm table-bordered mb-2 config-table">
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
                        :disabled="isDefaultCategory(row.cat, row.depth) || readOnly"
                      />
                    </div>
                  </td>
                  <td>
                    <div class="d-flex align-items-center gap-2">
                      <FaIcon :icon="row.cat.icon || 'question'" class="text-muted" />
                      <select
                        class="form-select form-select-sm"
                        v-model="row.cat.icon"
                        :disabled="isDefaultCategory(row.cat, row.depth) || readOnly"
                      >
                        <!-- a hand-written icon that is not in the list would show as nothing
                             selected, as if the category had no icon at all : offer it as an
                             option so it stays visible and is not replaced unnoticed -->
                        <option v-if="row.cat.icon && !availableIcons.includes(row.cat.icon)" :value="row.cat.icon">
                          {{ row.cat.icon }}
                        </option>
                        <option v-for="ic in availableIcons" :key="ic" :value="ic">{{ ic }}</option>
                      </select>
                    </div>
                  </td>
                  <td class="text-center align-middle">
                    <!-- reorganize : indent makes the row above the parent, outdent lifts
                         it back out. Paired into two groups so six controls read as four
                         things, and disabled rather than hidden so nothing shifts around
                         under the pointer as rows move. -->
                    <div
                      v-if="!isDefaultCategory(row.cat, row.depth) && !readOnly"
                      class="d-flex justify-content-center gap-1 cat-actions"
                    >
                      <!-- one group of four, not four buttons : the row already carries an
                           add and a delete, and the cell has to hold all six at whatever
                           base font size the browser is using -->
                      <div class="btn-group btn-group-sm" role="group">
                        <button
                          class="btn btn-outline-secondary"
                          :disabled="!canMoveUp(categories, row.cat)"
                          @click="moveUp(row.cat)"
                          :title="t('settings.settingsPage.moveUp')"
                        >
                          <FaIcon icon="chevron-up" />
                        </button>
                        <button
                          class="btn btn-outline-secondary"
                          :disabled="!canMoveDown(categories, row.cat)"
                          @click="moveDown(row.cat)"
                          :title="t('settings.settingsPage.moveDown')"
                        >
                          <FaIcon icon="chevron-down" />
                        </button>
                        <button
                          class="btn btn-outline-secondary"
                          :disabled="!canIndent(categories, row.cat)"
                          @click="indent(row.cat)"
                          :title="t('settings.settingsPage.indentCategory')"
                        >
                          <FaIcon icon="indent" />
                        </button>
                        <button
                          class="btn btn-outline-secondary"
                          :disabled="!canOutdent(categories, row.cat)"
                          @click="outdent(row.cat)"
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
                    <!-- the row it sits on is as tall as the button rows around it, so the
                         badge is centred in both directions rather than sitting on the
                         cell's text baseline -->
                    <div
                      v-else-if="isDefaultCategory(row.cat, row.depth)"
                      class="d-flex justify-content-center align-items-center"
                    >
                      <span class="badge bg-secondary-subtle text-muted">{{
                        t('settings.settingsPage.requiredItem')
                      }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <template #actions>
          <BsButton icon="plus" :disabled="readOnly" @click="addCategory()">{{
            t('settings.settingsPage.addCategory')
          }}</BsButton>
          <BsButton
            icon="save"
            :colorClass="isCategoriesDirty ? 'primary' : 'secondary'"
            :disabled="!isCategoriesDirty || readOnly"
            @click="saveCategories()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped lang="scss">
// Six controls have to fit a cell that cannot grow (.config-table is
// table-layout: fixed). The icons are what identifies each button, so the
// horizontal padding around them is what gets trimmed, not the size : the
// defaults render 36px wide here and ~39px at a larger base font, which is
// enough to push the row out of its column and over the icon dropdown.
.cat-actions .btn {
  --bs-btn-padding-x: 0.4rem;
  white-space: nowrap;
}
// A control that cannot apply has to READ as unclickable : bootstrap's default
// only takes the opacity down to .65, which in a row of six still looks like a
// live button. Disabled controls are exempt from the contrast minimum (WCAG
// 1.4.3) precisely so they can recede, so this goes lighter than any active text
// is allowed to. Measured against the row background : 2.72:1 disabled, against
// 4.69:1 for the same button enabled.
.cat-actions .btn:disabled {
  --bs-btn-disabled-color: var(--bs-secondary-color);
  --bs-btn-disabled-border-color: var(--bs-border-color);
  --bs-btn-disabled-opacity: 0.45;
}
</style>
