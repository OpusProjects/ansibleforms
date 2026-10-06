<script setup>
import Profile from '@/lib/Profile';
import Form from '@/lib/Form';
import Helpers from '@/lib/Helpers';
import TokenStorage from '@/lib/TokenStorage';
import { useRoute, useRouter } from 'vue-router';

const { t } = useI18n();

const authenticated = ref(false);
const formConfig = ref({});
const search = ref('');
const viewMode = ref('tiles'); // 'tiles' or 'list'

const route = useRoute();
const router = useRouter();
const showWarnings = ref(false);

const forms = computed(() => {
  // sort a copy : sorting formConfig.value.forms in place would mutate the
  // loaded config from inside a computed
  return formConfig.value?.forms?.slice().sort((a, b) => {
    // First, sort by "order" (undefined orders go last)
    const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    // Then, sort by name (case-insensitive)
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    if (nameA > nameB) return 1;
    if (nameA < nameB) return -1;
    return 0;
  });
});

const currentCategory = computed(() => {
  return decodeURIComponent(route.query?.category || '');
});

const roles = computed(() => {
  return TokenStorage.getPayload().user.roles;
});

const isAll = computed(() => {
  return currentCategory.value == '';
});

const filteredFormsBySearch = computed(() => {
  var f = forms.value || [];
  if (search.value) {
    return f.filter((x) => x.name.toLowerCase().includes(search.value.toLowerCase()));
  } else {
    return f;
  }
});

function setView(m) {
  if (m !== 'tiles' && m !== 'list') return;
  viewMode.value = m;
  Helpers.setCookie('forms_view_mode', m, 365);
}

function select(path) {
  if (path) {
    router.replace({ path: '/', query: { category: encodeURIComponent(path) } }).catch((_e) => {});
  } else {
    router.replace({ path: '/' }).catch((_e) => {});
  }
}

const getForms = computed(() => {
  return filterForms(currentCategory.value);
}); // the page title : the open category's name and icon (a sub category with its path, e.g.
// Expressions › Test1), "All forms" when none is open
function findCategory(items, names) {
  const item = (items || []).find((c) => c.name === names[0]);
  if (!item || names.length === 1) return item;
  return findCategory(item.items, names.slice(1));
}
const categoryTitle = computed(() => {
  if (!currentCategory.value) return { title: t('forms.allForms'), icon: 'check-double', crumbs: [] };
  const names = currentCategory.value.split('/');
  // every step with its own icon : the category, then each sub category below it
  const crumbs = names.map((name, i) => ({
    title: name,
    icon: findCategory(formConfig.value?.categories, names.slice(0, i + 1))?.icon || 'folder',
  }));
  return { title: names.join(' › '), icon: crumbs[crumbs.length - 1].icon, crumbs: crumbs.length > 1 ? crumbs : [] };
});

// the list view shows an icon column only when one of the listed forms has an icon or image
const listHasIcons = computed(() => (getForms.value || []).some((f) => f.icon || f.image));

function filterForms(category) {
  var f = filteredFormsBySearch.value || [];
  if (!category) {
    return f;
  } else {
    return f.filter((item) => {
      if (item.categories != undefined) {
        for (let j = 0; j < item.categories.length; j++) {
          if (inCategory(item.categories[j], category)) return true;
        }
        return false;
      } else {
        return category == 'Default';
      }
    });
  }
}

function inCategory(c, category) {
  var x = category.split('/');
  var y = c.split('/');
  for (let i = 0; i < x.length; i++) {
    if (i < y.length) {
      if (x[i] != y[i]) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function getFormClass(form) {
  return form.tileClass ?? 'bg-primary-subtle';
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
  formConfig.value = await Form.list();
  // restore view mode from cookie if present
  const vm = Helpers.getCookie('forms_view_mode');
  if (vm && (vm === 'tiles' || vm === 'list')) viewMode.value = vm;
});
</script>
<template>
  <AppNav />
  <BsOffCanvas
    :show="showWarnings && (formConfig?.warnings?.length > 0 || formConfig?.errors?.length > 0)"
    icon="triangle-exclamation"
    :title="t('forms.formWarnings')"
    @close="showWarnings = false"
  >
    <template #default>
      <!--
              TEXT, not v-html. These strings are built by Form.load and embed the FORM
              NAME and the yaml/validator error verbatim - and a form is a file in a forms
              repository, which is a different trust domain from AnsibleForms itself
              (whoever may push to that git repo, not only an AnsibleForms admin). A form
              named `<img src=x onerror=...>` therefore executed in the browser of every
              user who opened this page, and the tokens live in localStorage. None of
              these messages contains deliberate HTML, so nothing is lost; pre-line keeps
              the \r\n in "Failed to validate form 'x'.<newline><reason>" readable.
            -->
      <p v-for="(w, i) in formConfig.warnings" :key="'warning' + i" class="mb-3 text-prewrap">{{ w }}</p>
      <p v-for="(e, i) in formConfig.errors" :key="'error' + i" class="mb-3 has-text-danger text-prewrap">{{ e }}</p>
    </template>
  </BsOffCanvas>
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <div v-if="authenticated && forms" class="w-100 d-flex flex-column">
        <div class="row g-0 flex-grow-1 flex-md-nowrap af-forms-row">
          <!-- the top padding follows the selection : with "All Forms" highlighted its bar is what
               the eye measures to, so it starts 20px down (16px + the rows' 4px margin) ; otherwise
               the eye measures to the text, inside the row's padding, so the row starts at 12px -->
          <div
            class="col-md-auto af-forms-sidebar bg-body-tertiary px-3 border-top-0"
            :style="{ paddingTop: isAll ? '16px' : '8px' }"
          >
            <ul class="list-unstyled mb-3">
              <li role="button">
                <div
                  class="d-flex justify-content-between align-items-center menu-item p-2 my-1"
                  :class="{ 'bg-primary-forced': isAll }"
                  @click="select('')"
                >
                  <span :class="{ 'text-light': isAll }">
                    <span class="me-2">
                      <FaIcon icon="check-double" :fixedwidth="true"></FaIcon>
                    </span>
                    {{ t('forms.allForms') }}</span
                  >
                  <span v-if="isAll" class="badge px-3 rounded-pill active">{{ forms.length }}</span>
                  <span v-else class="badge px-3 rounded-pill">{{ forms.length }}</span>
                </div>
              </li>
              <AppMenuItem
                @click="select"
                v-for="item in formConfig?.categories"
                :key="item.name"
                :currentPath="currentCategory"
                parent=""
                :menu="item"
                :forms="forms"
                :roles="roles"
              />
            </ul>
          </div>
          <div class="col h-100 bg-body">
            <!-- the same page layout as the other pages : the open category as the title, with the
                 search and the view switch on the right, and the divider under it -->
            <AppSettings
              v-if="forms"
              bare
              :title="categoryTitle.title"
              :icon="categoryTitle.icon"
              :crumbs="categoryTitle.crumbs"
            >
              <template #headerActions>
                <div class="d-flex align-items-center gap-2 af-forms-toolbar">
                  <BsSearch v-model="search" style="width: 320px" :placeholder="t('forms.filter')" />
                  <button
                    v-if="formConfig?.warnings?.length > 0 || formConfig?.errors?.length > 0"
                    @click="showWarnings = !showWarnings"
                    class="btn btn-warning text-nowrap"
                    type="button"
                  >
                    <span class="me-1">
                      <FaIcon icon="exclamation-triangle" />
                    </span>
                    {{ showWarnings ? t('forms.hideWarnings') : t('forms.hasWarnings') }}
                    {{ t('forms.warningsOrErrors') }}
                  </button>
                  <button
                    class="btn btn-outline-primary text-nowrap"
                    @click="viewMode === 'tiles' ? setView('list') : setView('tiles')"
                    :title="t('common.actions')"
                  >
                    <span class="me-1"><FaIcon :icon="viewMode === 'tiles' ? 'th-list' : 'th'" /></span>
                    <span v-if="viewMode === 'tiles'">{{ t('forms.list') }}</span>
                    <span v-else>{{ t('forms.tiles') }}</span>
                  </button>
                </div>
              </template>
              <div v-if="viewMode === 'tiles'" class="row align-content-stretch g-4">
                <TransitionGroup>
                  <div class="col-md-6 col-lg-4 col-xxl-3" v-for="form in getForms" :key="form.name">
                    <router-link
                      :to="'/form?form=' + encodeURIComponent(form.name)"
                      class="card h-100 p-4 text-reset text-decoration-none"
                      :class="getFormClass(form)"
                    >
                      <div class="row">
                        <div v-if="form.image || form.icon" class="col-3 text-center">
                          <img v-if="form.image" :src="form.image" alt="Image" class="img-fluid" />
                          <span v-if="form.icon" class="icon is-large text-body">
                            <FaIcon
                              :icon="form.icon"
                              :size="form.iconSize"
                              :color="form.iconColor"
                              :overlayIcon="form.overlayIcon"
                              :overlayIconCircle="form.overlayIconCircle"
                              :overlayIconTransform="form.overlayIconTransform"
                              :overlayIconColor="form.overlayIconColor"
                              :overlayIconText="form.overlayIconText"
                              :overlayIconTextPosition="form.overlayIconTextPosition"
                              :overlayIconTextColor="form.overlayIconTextColor"
                            />
                          </span>
                        </div>
                        <div class="col text-body">
                          <p class="fw-bold" :class="getFormClass(form)">
                            {{ form.name }}
                          </p>
                          <p>{{ form.description }}</p>
                        </div>
                      </div>
                    </router-link>
                  </div>
                </TransitionGroup>
              </div>
              <div v-else class="table-responsive af-list-frame">
                <table class="table table-bordered table-hover mb-0">
                  <thead>
                    <tr>
                      <!-- the icon column : only when a listed form has an icon or image ; no
                           separator between it and the name, the icon belongs with the name -->
                      <th v-if="listHasIcons" class="af-icon-cell"></th>
                      <th class="af-name-cell" :class="{ 'af-after-icon': listHasIcons }">{{ t('forms.name') }}</th>
                      <th class="af-desc-cell">{{ t('forms.description') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="form in getForms"
                      :key="form.name"
                      style="cursor: pointer"
                      @click="$router.push({ path: '/form', query: { form: form.name } })"
                    >
                      <td v-if="listHasIcons" class="af-icon-cell text-center" :class="getFormClass(form)">
                        <img v-if="form.image" :src="form.image" alt="" class="af-list-image" />
                        <FaIcon
                          v-else-if="form.icon"
                          :icon="form.icon"
                          :color="form.iconColor"
                          :fixedwidth="true"
                          :overlayIcon="form.overlayIcon"
                          :overlayIconCircle="form.overlayIconCircle"
                          :overlayIconTransform="form.overlayIconTransform"
                          :overlayIconColor="form.overlayIconColor"
                          :overlayIconText="form.overlayIconText"
                          :overlayIconTextPosition="form.overlayIconTextPosition"
                          :overlayIconTextColor="form.overlayIconTextColor"
                        />
                      </td>
                      <td class="af-name-cell" :class="[getFormClass(form), { 'af-after-icon': listHasIcons }]">
                        {{ form.name }}
                      </td>
                      <td class="af-desc-cell" :class="getFormClass(form)" :title="form.description">
                        {{ form.description }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </AppSettings>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
<style scoped lang="scss">
// the list view's frame : the outer border is drawn by the wrapper, so its bottom corners
// can be rounded (a collapsed table border cannot) ; the cells keep only their inner lines
.af-list-frame {
  border: 1px solid var(--bs-border-color);
  border-radius: 0 0 var(--bs-border-radius-lg) var(--bs-border-radius-lg);
}
.af-list-frame > .table > :not(caption) > tr > :first-child {
  border-left-width: 0;
}
.af-list-frame > .table > :not(caption) > tr > :last-child {
  border-right-width: 0;
}
.af-list-frame > .table > thead > tr > * {
  border-top-width: 0;
}
/* Bootstrap's bordered table also draws a line above and below each row : the first row's
   top and the last row's bottom would double the frame's own border, so those two go */
.af-list-frame > .table > :not(caption) {
  border-top-width: 0;
  border-bottom-width: 0;
}
.af-list-frame > .table > thead > tr:first-child {
  border-top-width: 0;
}
/* the header row : a light grey, the same panel color as the left menu (Bootstrap's tertiary
   background, which the dark theme turns into a dark grey) */
.af-list-frame > .table > thead > tr > th {
  --bs-table-bg: var(--bs-tertiary-bg);
}
/* in the light theme that grey is all but white next to the rows : a step darker */
[data-bs-theme='light'] .af-list-frame > .table > thead > tr > th {
  --bs-table-bg: #f1f3f5;
}
/* and in the dark theme a clear step above the rows (below), like the menu panel */
[data-bs-theme='dark'] .af-list-frame > .table > thead > tr > th {
  --bs-table-bg: #2c3136;
}
/* the rows a shade lighter than the page (#212529), so the list stands apart from it */
[data-bs-theme='dark'] .af-list-frame > .table > tbody > tr > td {
  --bs-table-bg: #24282d;
}
.af-list-frame > .table > tbody > tr:last-child {
  border-bottom-width: 0;
}
.af-list-frame > .table > tbody > tr:last-child > * {
  border-bottom-width: 0;
}
// the list view's rows : more room above and below, every cell centred vertically
.table > :not(caption) > tr > td,
.table > :not(caption) > tr > th {
  padding-top: 0.85rem;
  padding-bottom: 0.85rem;
  vertical-align: middle;
}
// its icon column : a fixed width (wide images and icons fit, the names line up), and
// joined to the name column (no border between)
.af-icon-cell {
  width: 4rem;
  min-width: 4rem;
  white-space: nowrap;
  border-right-width: 0 !important;
  padding-left: 1rem !important;
  padding-right: 0.25rem !important;
}
// the description stays on one line : cut off with "..." (the full text is its tooltip) ;
// max-width 0 lets the cell shrink to the room the table leaves it instead of growing
.af-desc-cell {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 1rem !important;
  padding-right: 1.5rem !important; // the same room after the "..." as after the longest name
}
// the name column is as wide as the longest name (names never wrap) ; the description
// takes the rest of the width
.af-name-cell {
  width: 1%;
  white-space: nowrap;
  padding-right: 1.5rem !important; // room between the longest name and the description
}
.af-after-icon {
  border-left-width: 0 !important;
  padding-left: 0.5rem !important;
}
.af-list-image {
  height: 1.25em;
  width: auto;
  max-width: 3rem;
  vertical-align: -0.25em;
}

// the warning/error list renders as TEXT rather than v-html (see the template) ; these
// messages carry \r\n between the summary and the reason, which text nodes collapse
.text-prewrap {
  white-space: pre-line;
}

.badge {
  background-color: var(--af-bg-badge) !important;
  color: var(--af-text-badge) !important;

  &.active {
    background-color: var(--af-text-badge) !important;
    color: var(--af-bg-badge) !important;
  }
}

.v-enter-active,
.v-leave-active {
  transition: opacity 0.2s ease;
}

.v-enter-from,
.v-leave-to {
  opacity: 0;
}
</style>
