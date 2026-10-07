<script setup>
import { ref, onMounted, computed } from 'vue';
import { useVuelidate } from '@vuelidate/core';
import { required, helpers } from '@vuelidate/validators';
import Profile from '@/lib/Profile';
import axios from 'axios';
import { toast } from 'vue-sonner';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import Theme from '@/lib/Theme';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const activeTab = ref('env_configuration');

const env = ref({});

// Grouped by what an operator is trying to DO, not by the variable's name prefix. Two
// deliberate choices: retention gets its own tab because those four settings all treat 0
// differently and getting one wrong deletes data; and there is no 'Paths' tab, because ten
// unrelated folders grouped by having 'path' in the name told you nothing - each now sits
// with the feature it serves. 'Where does this instance write?' is answered by the Status
// page's writable-folders check.
//
// Declared as exact names and prefixes rather than one regex per group. A regex here
// already caused a bug: /^(REST_|API_BODY_LIMIT_MB|...)$/ anchored the REST_ prefix with
// $, so REST_ALLOWED_HOSTS and REST_DENIED_HOSTS - the outbound allow/deny lists - fell
// into the 'Other' catch-all instead of appearing under Security.
const envGroupOrder = [
  // First, and an env group like the rest : the setting it holds IS an environment variable,
  // and it belongs beside the import/export actions that move the configuration between disk
  // and database. The database `config_source` column stays as a fallback for instances that
  // set it before 6.3.0, but nothing writes it any more - one control, one store.
  // CONFIG_SEED_PATH and ALLOW_ENV_EDIT sit here because both answer "where does the
  // configuration come from". Both are refused (see REFUSED in lib/envSettings.js), so
  // they render read-only with their reason - which is the point: an operator needs to
  // see that a seed is in force, and that is exactly why this page cannot be saved.
  {
    key: 'configuration',
    label: () => t('settings.settingsPage.tabConfiguration'),
    icon: 'right-left',
    exact: ['ENABLE_CONFIG_IN_DATABASE', 'CONFIG_SEED_PATH', 'CONFIG_SEED_RELOAD_SECONDS', 'ALLOW_ENV_EDIT'],
  },
  {
    key: 'server',
    label: () => t('settings.settingsPage.envGroupServer'),
    icon: 'globe',
    // no BASE_URL : it is in OWNED_ELSEWHERE, which is filtered out before the groups are
    // consulted, so listing it here only claimed a variable this page never renders
    exact: [
      'NODE_ENV',
      'PORT',
      'HTTPS',
      'HTTPS_KEY',
      'HTTPS_CERT',
      'TRUST_PROXY',
      'API_BODY_LIMIT_MB',
      'ENABLE_MCP',
      'ENABLE_CHAT',
    ],
  },
  {
    key: 'database',
    label: () => t('settings.settingsPage.envGroupDatabase'),
    icon: 'database',
    prefix: ['DB_'],
    exact: ['ENABLE_DB_QUERY_LOGGING', 'ALLOW_SCHEMA_CREATION'],
  },
  {
    key: 'retention',
    label: () => t('settings.settingsPage.envGroupRetention'),
    icon: 'clock-rotate-left',
    exact: ['JOB_RETENTION_DAYS', 'AUDIT_RETENTION_DAYS', 'NIGHTLY_BACKUP_RETENTION', 'OLD_BACKUP_DAYS'],
  },
  {
    key: 'backups',
    label: () => t('settings.settingsPage.envGroupBackups'),
    icon: 'box-archive',
    exact: ['MYSQLDUMP_COMMAND', 'MYSQL_COMMAND', 'BACKUP_PATH', 'FORMS_BACKUP_PATH', 'BACKUP_COMMAND_TIMEOUT_SECONDS'],
  },
  {
    key: 'authentication',
    label: () => t('settings.settingsPage.envGroupAuthentication'),
    icon: 'user-shield',
    prefix: ['ADMIN_', 'ACCESS_TOKEN_'],
    exact: ['REINIT_ADMIN', 'AZURE_GRAPH_URI'],
  },
  {
    key: 'security',
    label: () => t('settings.settingsPage.envGroupSecurity'),
    icon: 'lock',
    prefix: ['REST_'],
    exact: [
      'ENCRYPTION_SECRET',
      'MASK_EXTRAVARS_REGEX',
      'EXTRAVARS_USER_FIELDS',
      'EXPRESSION_SANITIZER',
      'LAUNCH_VALIDATION',
    ],
  },
  {
    key: 'jobs',
    label: () => t('settings.settingsPage.envGroupJobs'),
    icon: 'fac,ansible',
    exact: ['REGEX_FILTER_JOB_OUTPUT', 'UPLOAD_PATH', 'UPLOAD_MAX_GB', 'VARS_FILES_PATH', 'AWX_API_PREFIX'],
  },
  {
    key: 'formsConfig',
    label: () => t('settings.settingsPage.envGroupFormsConfig'),
    icon: 'file-code',
    exact: ['CONFIG_PATH', 'FORMS_FOLDER_PATH', 'FORMS_STAGING_PATH', 'LOCK_PATH'],
  },
  {
    key: 'git',
    label: () => t('settings.settingsPage.envGroupGit'),
    icon: 'fab,git',
    prefix: ['GIT_'],
    exact: ['REPO_PATH', 'HOME_PATH'],
  },
  {
    key: 'ytt',
    label: () => t('settings.settingsPage.envGroupYtt'),
    icon: 'code',
    prefix: ['YTT_'],
    exact: ['USE_YTT'],
  },
  {
    key: 'ui',
    label: () => t('settings.settingsPage.envGroupUi'),
    icon: 'palette',
    prefix: ['NAV_HOME_'],
    exact: ['DEFAULT_LANGUAGE', 'SHOW_DESIGNER'],
  },
  { key: 'logging', label: () => t('settings.settingsPage.envGroupLogging'), icon: 'file-alt', prefix: ['LOG_'] },
];

// exact name or declared prefix - no regex, so no anchor to get wrong
function envInGroup(group, name) {
  if ((group.exact || []).includes(name)) return true;
  return (group.prefix || []).some((p) => name.startsWith(p));
}

// One line of help under each variable, matching the Settings tab. help.yaml holds a
// multi-paragraph description; take its first sentence. The split requires a capital
// after the period, so 'e.g. `https://...`' and 'i.e. /dev/log' are not cut in half.
// a documented enum ('true, false', '1, 2') becomes a dropdown
function envOptions(e) {
  return Helpers.envAllowedOptions(e?.allowed);
}

function envHelp(e) {
  // a hand-written hint wins : several variables share one boilerplate description
  if (e.hint) return String(e.hint).trim();
  const d = String(e.description || '')
    .replace(/\s+/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1') // '**DEPRECATED:**' rendered its asterisks
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (!d) return '';
  return d.split(/(?<=\.)\s+(?=[A-Z])/)[0];
}

// Variables that do not belong on this page. They must be excluded explicitly, not merely
// left out of the group list.
//
// There is no 'Other' catch-all any more : every variable is claimed by a named group, so a
// variable matching NO group is not shown at all and cannot be edited from the UI. That is
// the trade for losing the catch-all, and it fails silently - nothing warns, the variable is
// simply absent. Adding one to help.yaml therefore means adding it to a group here too.
// tests/env-group-coverage.test.js pins exactly that: it reads the real help.yaml and fails
// when a variable belongs to no group, or to more than one.
//
// VAULT_* are only imported once, when upgrading to 7.1 (Secret stores). BASE_URL is here for a different reason -
// it is the one setting that genuinely cannot be applied without a restart, because the
// served index.html has the base path baked into it, so every page already open would break.
// Showing it on a page of editable settings would only offer an edit that cannot work; it is
// reported as a fact on the Status page instead.
// AF_ROLE and RTE_* describe which process this is and where its RTE lives : set in the
// environment of the container, not edited from inside the app. ANSIBLE_PATH and
// PROCESS_MAX_BUFFER are read by an RTE only : since 7.3 the app runs no playbook itself.
const OWNED_ELSEWHERE = /^VAULT_|^BASE_URL$|^AF_ROLE$|^RTE_|^ANSIBLE_PATH$|^PROCESS_MAX_BUFFER$/;

const envGroups = computed(() => {
  if (!env.value || !Array.isArray(env.value)) return [];
  const matched = new Set();
  const groups = envGroupOrder
    .map((g) => {
      const items = env.value.filter((e) => {
        if (matched.has(e.name) || OWNED_ELSEWHERE.test(e.name)) return false;
        if (envInGroup(g, e.name)) {
          matched.add(e.name);
          return true;
        }
        return false;
      });
      return { ...g, label: g.label(), items };
    })
    .filter((g) => g.items.length > 0);
  return groups;
});

const authenticated = ref(false);
const item = ref({ url: '', forms_yaml: '', config_source: null });
const originalItem = ref(null);
const showImportConfirm = ref(false);
const showExportConfirm = ref(false);

const themeOptions = Theme.themes().map((th) => ({ value: th.value, label: th.title }));

const colorPalette = [
  { label: 'Blue', hex: '#008cba' },
  { label: 'Indigo', hex: '#6610f2' },
  { label: 'Purple', hex: '#744fc6' },
  { label: 'Pink', hex: '#d63384' },
  { label: 'Red', hex: '#dc3545' },
  { label: 'Orange', hex: '#ff8800' },
  { label: 'Green', hex: '#198754' },
  { label: 'Teal', hex: '#20c997' },
  { label: 'Cyan', hex: '#0190ce' },
  { label: 'Navy', hex: '#1b2a4a' },
  { label: 'Slate', hex: '#475569' },
  { label: 'Brown', hex: '#795548' },
];

const effectiveTheme = computed({
  get() {
    return item.value.default_theme || 'light';
  },
  set(val) {
    item.value.default_theme = val;
  },
});

const effectiveThemeColor = computed({
  get() {
    return item.value.default_theme_color || '#008cba';
  },
  set(val) {
    item.value.default_theme_color = val;
  },
});

const rules = computed(() => ({
  item: {
    url: { required: helpers.withMessage(`${t('settings.settingsPage.publicRootUrl')} is required`, required) },
  },
}));
const $v = useVuelidate(rules, { item });

function resolveConfigSource(obj) {
  return obj.config_source || (obj.enableConfigInDatabase ? 'database' : 'file');
}

function resolveLanguage(obj) {
  return obj.default_language || 'en';
}

function resolveTheme(obj) {
  return obj.default_theme || 'light';
}

function resolveThemeColor(obj) {
  return obj.default_theme_color || '#008cba';
}

const settingsDirty = computed(() => {
  if (originalItem.value === null) return false;
  return (
    item.value.url !== originalItem.value.url ||
    resolveConfigSource(item.value) !== resolveConfigSource(originalItem.value) ||
    resolveLanguage(item.value) !== resolveLanguage(originalItem.value) ||
    resolveTheme(item.value) !== resolveTheme(originalItem.value) ||
    resolveThemeColor(item.value) !== resolveThemeColor(originalItem.value)
  );
});

async function loadItem() {
  try {
    const result = await axios.get('/api/v2/settings/', TokenStorage.getAuthentication());
    item.value = result.data;
    originalItem.value = JSON.parse(JSON.stringify(result.data));
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

async function saveSettings() {
  $v.value.item.$touch();
  // Say so. Returning silently made the combined Save half-apply: the environment
  // variables were written and a success toast appeared while the settings half was
  // dropped, and the only sign was an inline field error on a tab the user may not have
  // been looking at. saveActiveTab checks the return value now.
  if ($v.value.item.$invalid) {
    toast.error(t('errors.requiredFields'));
    return false;
  }
  try {
    const { url, config_source, default_language, default_theme, default_theme_color } = item.value;
    await axios.put(
      '/api/v2/settings/',
      { url, config_source, default_language, default_theme, default_theme_color },
      TokenStorage.getAuthentication(),
    );
    toast.success(t('settings.settingsPage.label') + ' ' + t('settings.common.isUpdated'));
    await loadItem();
    return true;
  } catch (err) {
    // false, not undefined. Only the validation branch above used to say so, so a
    // REFUSED save - a 409 from a concurrent edit, a 423 from the designer lock, any
    // 500 - fell through saveActiveTab's guard and wrote the environment half anyway:
    // an error toast and a success toast for one button press, half applied.
    toast.error(Helpers.parseAxiosResponseError(err));
    return false;
  }
}

async function importConfigToDatabase() {
  showImportConfirm.value = false;
  try {
    const result = await axios.put('/api/v2/settings/importConfig', {}, TokenStorage.getAuthentication());
    toast.success(result.data.message);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

async function exportConfigToFile() {
  showExportConfirm.value = false;
  try {
    const result = await axios.put('/api/v2/settings/exportConfig', {}, TokenStorage.getAuthentication());
    toast.success(result.data.message);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

// The edited values, keyed by variable name. Seeded from what the server reports so
// 'dirty' means 'differs from what is actually in effect', not 'has been touched'.
const envEdits = ref({});
const envBaseline = ref({});
const envRestartPending = ref([]);

// A field is a real input only when it can actually be written : never for a refused
// variable, and never for one the real environment already sets, because dotenv will not
// overwrite that and the save would silently do nothing.
function envEditable(e) {
  return e.editable !== 'refused' && !e.overridden;
}

const envSecret = computed(() => new Set((env.value || []).filter((e) => e.secret).map((e) => e.name)));
const envDirtyNames = computed(() =>
  Object.keys(envEdits.value).filter((k) => {
    // a blank secret box means 'leave it alone', not 'set it to empty' - otherwise
    // opening the tab and pressing Save would wipe every stored credential
    if (envSecret.value.has(k) && String(envEdits.value[k] ?? '') === '') return false;
    return String(envEdits.value[k] ?? '') !== String(envBaseline.value[k] ?? '');
  }),
);
const envDirty = computed(() => envDirtyNames.value.length > 0);

async function saveEnvironmentVariables() {
  const names = envDirtyNames.value;
  if (names.length === 0) return;
  const payload = {};
  for (const n of names) payload[n] = envEdits.value[n] ?? '';
  try {
    const result = await axios.put('/api/v2/config/env', payload, TokenStorage.getAuthentication());
    toast.success(result.data.message);
    envRestartPending.value = result.data?.restartRequired || [];
    await loadEnvironmentVariables();
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

const anyDirty = computed(() => settingsDirty.value || envDirty.value);

async function saveActiveTab() {
  // A refused settings half must stop the whole save, not let the environment half
  // through on its own - the user pressed one button and is entitled to one outcome.
  if (settingsDirty.value) {
    if ((await saveSettings()) === false) return;
  }
  if (envDirty.value) await saveEnvironmentVariables();
}

async function loadEnvironmentVariables() {
  try {
    const result = await axios.get('/api/v2/config/env', TokenStorage.getAuthentication());
    env.value = result.data;
    const edits = {};
    for (const e of result.data) if (envEditable(e)) edits[e.name] = e.secret ? '' : (e.value ?? '');
    envEdits.value = { ...edits };
    envBaseline.value = { ...edits };
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([loadItem(), loadEnvironmentVariables()]);
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <!-- titled like its menu entry, "General" : the header link and the menu are "Settings" already -->
      <AppSettings
        v-if="authenticated"
        icon="toolbox"
        :title="t('sidebar.ansibleForms')"
        :description="t('settings.settingsPage.description')"
      >
        <template #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="group in envGroups" :key="group.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === 'env_' + group.key }"
                href="#"
                @click.prevent="activeTab = 'env_' + group.key"
              >
                <FaIcon :icon="group.icon" class="me-1" />
                {{ group.label }}
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <!-- Environment Variable tabs -->
          <template v-for="group in envGroups" :key="group.key">
            <div v-show="activeTab === 'env_' + group.key">
              <!-- The editable, database-backed settings live with their subject rather than
                   in a general tab: the public url is a server property, the language and
                   theme defaults are UI ones. They save through saveSettings(), the fields
                   below through the env endpoint - the one Save button covers both. -->
              <template v-if="group.key === 'server'">
                <BsInput
                  :isFloating="false"
                  icon="globe"
                  v-model="$v.item.url.$model"
                  :label="t('settings.settingsPage.publicRootUrl')"
                  :required="true"
                  :help="t('settings.settingsPage.publicRootUrlHelp')"
                  :hasError="$v.item.url.$invalid && $v.item.url.$dirty"
                  :errors="$v.item.url.$errors"
                />
                <div class="mt-4"></div>
              </template>
              <template v-if="group.key === 'ui'">
                <!-- no language field here : DEFAULT_LANGUAGE below is the one control for it.
                     Theme and colour have no environment variable, so they stay database
                     backed. -->
                <BsInput
                  :isFloating="false"
                  type="select"
                  icon="palette"
                  v-model="effectiveTheme"
                  :values="themeOptions"
                  valueKey="value"
                  labelKey="label"
                  :label="t('settings.settingsPage.defaultTheme')"
                  :help="t('settings.settingsPage.defaultThemeHelp')"
                />
                <div v-if="effectiveTheme === 'color'" class="mt-2 ms-1">
                  <div class="d-flex flex-wrap gap-2">
                    <button
                      v-for="c in colorPalette"
                      :key="c.hex"
                      type="button"
                      class="settings-color-swatch"
                      :style="{ backgroundColor: c.hex }"
                      :class="{ 'settings-color-swatch-active': effectiveThemeColor === c.hex }"
                      :title="c.label"
                      @click="effectiveThemeColor = c.hex"
                    >
                      <FaIcon v-if="effectiveThemeColor === c.hex" icon="check" class="settings-swatch-check" />
                    </button>
                  </div>
                </div>
                <div class="mt-4"></div>
              </template>
              <div v-if="envRestartPending.length" class="alert alert-warning py-2">
                <FaIcon icon="triangle-exclamation" class="me-2" />
                {{ t('settings.settingsPage.envRestartPending', { names: envRestartPending.join(', ') }) }}
              </div>
              <!-- The same rhythm as the Settings tab - label, value, help text below -
                   but deliberately NOT BsInput. These are read-only: they come from the
                   process environment and there is no endpoint that writes them, so an
                   input (even disabled) would promise an edit that cannot happen. The
                   value sits in a plain bordered block instead. -->
              <template v-for="(e, i) in group.items" :key="e.name">
                <div v-if="i > 0" class="mt-4"></div>
                <!-- Same structure as a BsInput on the Settings tab: mb-3 wrapper,
                     form-label fw-bold, an input-group with a leading icon, then the
                     help text. The value is a DIV carrying .form-control rather than an
                     <input>: it looks like the fields beside it, but nothing writes these
                     - they come from the process environment - so an input would promise
                     an edit that cannot happen. -->
                <div class="mb-3">
                  <!-- an editable variable gets a real BsInput, so it is identical to the
                       Settings tab. One that cannot be written keeps the read-only box and
                       says why, rather than offering an edit that would not take. -->
                  <BsInput
                    v-if="envEditable(e)"
                    :isFloating="false"
                    :icon="e.type === 'number' ? 'hashtag' : 'font'"
                    :type="envOptions(e) ? 'select' : e.secret ? 'password' : e.type === 'number' ? 'number' : 'text'"
                    :values="envOptions(e) || []"
                    valueKey="value"
                    labelKey="label"
                    :placeholder="e.secret && e.set ? t('settings.settingsPage.envSecretUnchanged') : ''"
                    :label="e.short || e.name"
                    :help="envHelp(e)"
                    v-model="envEdits[e.name]"
                  />
                  <template v-else>
                    <label class="form-label fw-bold">{{ e.short || e.name }}</label>
                    <div>
                      <div class="input-group">
                        <span class="input-group-text text-gray-500">
                          <FaIcon :fixedwidth="true" :icon="e.editable === 'refused' ? 'lock' : 'shield-halved'" />
                        </span>
                        <div class="form-control env-value" :title="e.name">
                          {{ e.value === null || e.value === '' ? '—' : e.value }}
                        </div>
                      </div>
                    </div>
                    <div v-if="envHelp(e)" class="form-text">{{ envHelp(e) }}</div>
                    <div class="form-text env-locked">
                      {{ e.overridden ? t('settings.settingsPage.envOverridden') : e.refusedReason || '' }}
                    </div>
                  </template>
                  <div v-if="envEditable(e) && e.editable === 'restart'" class="form-text env-restart">
                    {{ t('settings.settingsPage.envRestartRequired') }}
                    <!-- for a path, 'takes effect after a restart' is true but misses the
                         part that matters: whatever is already on disk does not move -->
                    <template v-if="e.relocates"> {{ t('settings.settingsPage.envRelocates') }}</template>
                  </div>
                </div>
              </template>
              <!-- After the fields, not before them: these move the whole configuration
                   between disk and database, so they read as an action on the settings
                   above rather than a heading over them. mt-4 to separate them from the last
                   field, and a small mb-2 so they do not sit hard against the card edge -
                   deliberately smaller than a field's mb-3, which the :last-child rule below
                   zeroes precisely because it stacks on the card's own padding. -->
              <template v-if="group.key === 'configuration'">
                <div class="mt-4 mb-2 d-flex align-items-center">
                  <BsButton icon="file-import" colorClass="secondary" @click="showImportConfirm = true">{{
                    t('settings.settingsPage.importToDatabase')
                  }}</BsButton>
                  <BsButton
                    icon="file-export"
                    colorClass="secondary"
                    cssClass="ms-3"
                    @click="showExportConfirm = true"
                    >{{ t('settings.settingsPage.exportToFile') }}</BsButton
                  >
                </div>
              </template>
            </div>
          </template>
        </template>
        <template #actions>
          <!-- one button : a tab can now hold both database-backed settings and environment
               variables, so Save applies whichever of the two is pending -->
          <BsButton
            icon="save"
            :colorClass="anyDirty ? 'primary' : 'secondary'"
            :disabled="!anyDirty"
            @click="saveActiveTab()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>

      <!-- Modal - confirm import config.yaml to database -->
      <BsModal v-if="showImportConfirm" @close="showImportConfirm = false">
        <template #title> {{ t('settings.settingsPage.importConfirmTitle') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('settings.settingsPage.importConfirmText') }}
          </p>
        </template>
        <template #footer>
          <BsButton icon="file-import" @click="importConfigToDatabase()">{{ t('common.confirm') }}</BsButton>
        </template>
      </BsModal>

      <!-- Modal - confirm export database to config.yaml -->
      <BsModal v-if="showExportConfirm" @close="showExportConfirm = false">
        <template #title> {{ t('settings.settingsPage.exportConfirmTitle') }} </template>
        <template #default>
          <p class="mt-3 fs-6 user-select-none">
            {{ t('settings.settingsPage.exportConfirmText') }}
          </p>
        </template>
        <template #footer>
          <BsButton icon="file-export" @click="exportConfigToFile()">{{ t('common.confirm') }}</BsButton>
        </template>
      </BsModal>
    </main>
  </div>
</template>
<style scoped>
/* the card body padding of a tabbed AppSettings card is set globally
   (bootstrap-override.scss, .tab-card-flush-card) */

/* The last field's mb-3 stacks on the card's own bottom padding. The global
   .tab-card-flush-card rule only reaches a DIRECT child of .card-body, which here is the
   v-show tab pane, so the field one level inside it keeps its margin.
   !important because Bootstrap's own .mb-3 is !important.

   The SECOND selector matters as much as the first: BsInput renders its own .mb-3 wrapper
   INSIDE the page's, so zeroing only the outer one still left 16px from the inner one -
   measured 32px of gap under the last field against 16px on every other admin page. It is
   scoped under the outer :last-child, so it can only ever reach the trailing field and not
   a field that merely ends some group mid-page. */
:deep(.card-body) > div > .mb-3:last-child,
:deep(.card-body) > div > .mb-3:last-child .mb-3:last-child {
  margin-bottom: 0 !important;
}
/* The value is a div, not an input : .form-control gives it the same box as the fields
   on the Settings tab, and the tertiary background is what says 'read only'. */
.env-locked {
  color: var(--bs-secondary-color);
  font-style: italic;
}
.env-restart {
  color: var(--af-warning-text, var(--bs-warning-text-emphasis));
}
.env-value {
  background-color: var(--bs-tertiary-bg);
  height: auto;
  min-height: calc(1.5em + 0.75rem + 2px);
  word-break: break-all;
  font-family: var(--bs-font-monospace);
}
.settings-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    transform 0.15s,
    border-color 0.15s;
}
.settings-color-swatch:hover {
  transform: scale(1.15);
  border-color: rgba(255, 255, 255, 0.5);
}
.settings-color-swatch-active {
  border-color: var(--bs-body-color);
  box-shadow: 0 0 0 2px var(--bs-body-bg);
}
.settings-swatch-check {
  color: #fff;
  font-size: 0.65rem;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.5));
}
</style>
