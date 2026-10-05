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
});

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
    <main class="d-flex container-xxl">
      <div v-if="authenticated && forms" class="container-fluid min-vh-100 d-flex flex-column">
        <div class="row flex-grow-1">
          <div class="col-md-auto bg-categories h-100 border-top-0">
            <div class="d-flex align-items-center p-3 mb-3 link-body-emphasis text-decoration-none border-bottom">
              <FaIcon icon="fas,layer-group" />
              <span class="ms-2 fs-5 fw-bold">{{ t('forms.categories') }}</span>
            </div>
            <ul class="list-unstyled my-3">
              <li role="button">
                <div
                  class="d-flex justify-content-between menu-item p-2 my-1"
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
            <div v-if="forms" class="p-3">
              <div class="d-flex justify-content-end mb-2">
                <button
                  v-if="formConfig?.warnings?.length > 0 || formConfig?.errors?.length > 0"
                  @click="showWarnings = !showWarnings"
                  class="btn btn-warning btn-sm"
                  type="button"
                >
                  <span class="me-1">
                    <FaIcon icon="exclamation-triangle" />
                  </span>
                  {{ showWarnings ? t('forms.hideWarnings') : t('forms.hasWarnings') }}
                  {{ t('forms.warningsOrErrors') }}
                </button>
                <button
                  class="btn btn-outline-secondary btn-sm ms-2"
                  @click="viewMode === 'tiles' ? setView('list') : setView('tiles')"
                  :title="t('common.actions')"
                >
                  <span class="me-1"><FaIcon :icon="viewMode === 'tiles' ? 'th-list' : 'th'" /></span>
                  <span v-if="viewMode === 'tiles'">{{ t('forms.list') }}</span>
                  <span v-else>{{ t('forms.tiles') }}</span>
                </button>
              </div>
              <BsInput
                v-model="search"
                :placeholder="t('forms.search')"
                :label="t('forms.filter')"
                type="text"
                icon="search"
              />
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
              <div v-else class="table-responsive">
                <table class="table table-bordered table-hover">
                  <thead>
                    <tr>
                      <th>{{ t('forms.name') }}</th>
                      <th>{{ t('forms.description') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="form in getForms"
                      :key="form.name"
                      style="cursor: pointer"
                      @click="$router.push({ path: '/form', query: { form: form.name } })"
                    >
                      <td :class="getFormClass(form)">
                        {{ form.name }}
                      </td>
                      <td :class="getFormClass(form)">
                        {{ form.description }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
<style scoped lang="scss">
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
