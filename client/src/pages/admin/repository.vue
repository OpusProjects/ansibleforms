<script setup>
/******************************************************************/
/*                                                                */
/*  A repository's page (/settings/repositories/<name>), opened from */
/*  the repositories' list : the steps of its dialog as tabs, the */
/*  tab kept in the url -                                         */
/*    Repository   its name, branch, uri, description, and where  */
/*                 it stands (status, head)                       */
/*    Credentials  the credential git uses                        */
/*    Usage        what the app reads from it                     */
/*    Schedule     the scheduled pull, clone on app start         */
/*    Output       what git said the last time                    */
/*  Pull, Reset, Push to repo and Delete top right, beside Save.  */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import { statusPill } from '@/config/settings';
import { cronValidationMessage } from '@/config/cron';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the repository ───────────────────────────────────────────────────────────
const repoName = computed(() => String(route.params.name || ''));
const repo = ref(null); // as saved
const edit = ref(null); // as edited
const others = ref([]); // the other repositories : who already has a one-only usage
const credentials = ref([]); // the credentials it can use
// what this page edits : the password of a repository that still has its own has its dialog
const EDITED = [
  'name',
  'branch',
  'uri',
  'description',
  'credential',
  'use_for_config',
  'use_for_forms',
  'use_for_playbooks',
  'use_for_vars_files',
  'cron',
  'rebase_on_start',
];
// what the app reads from it, each its short label and a few grey words, as in the dialog
const USAGES = computed(() =>
  [
    {
      key: 'use_for_config',
      label: t('settings.repositories.useConfigShort'),
      hint: t('settings.repositories.useConfigHint'),
      oneOnly: true,
    },
    {
      key: 'use_for_forms',
      label: t('settings.repositories.useFormsShort'),
      hint: t('settings.repositories.useFormsHint'),
    },
    {
      key: 'use_for_playbooks',
      label: t('settings.repositories.usePlaybooksShort'),
      hint: t('settings.repositories.usePlaybooksHint'),
      oneOnly: true,
    },
    {
      key: 'use_for_vars_files',
      label: t('settings.repositories.useVarsFilesShort'),
      hint: t('settings.repositories.useVarsFilesHint'),
      oneOnly: true,
    },
  ].sort((a, b) => a.label.localeCompare(b.label)),
);

/**
 * The fields of a record as this page edits them : the checkboxes booleans, the schedule's
 * switch read from the schedule.
 *
 * Args:
 *   record (object): the repository.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  const out = Object.fromEntries(EDITED.map((k) => [k, record[k] ?? '']));
  for (const u of ['use_for_config', 'use_for_forms', 'use_for_playbooks', 'use_for_vars_files', 'rebase_on_start']) {
    out[u] = !!record[u];
  }
  out.pull_scheduled = !!(record.cron && String(record.cron).trim());
  return out;
}

// the fields to save : Scheduled pull off saves no schedule
const toSave = computed(() => {
  if (!edit.value) return {};
  const data = Object.fromEntries(
    EDITED.map((k) => [k, typeof edit.value[k] === 'string' ? edit.value[k].trim() : edit.value[k]]),
  );
  if (!edit.value.pull_scheduled) data.cron = '';
  for (const k of Object.keys(data)) if (typeof data[k] === 'boolean') data[k] = data[k] ? 1 : 0;
  return data;
});
const dirty = computed(() => {
  if (!repo.value) return false;
  const saved = editable(repo.value);
  return (
    EDITED.some((k) => String(edit.value[k] ?? '') !== String(saved[k] ?? '')) ||
    edit.value.pull_scheduled !== saved.pull_scheduled
  );
});
// leaving with the repository changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

const running = computed(() => repo.value?.status === 'running');
// git's output, a line each (the trailing newline adds none)
const outputLines = computed(() => (repo.value?.output || '').replace(/\n$/, '').split('\n'));
// pushed back : only what the app writes to it, its forms or its settings
const canPush = computed(() => !!(repo.value?.use_for_forms || repo.value?.use_for_config));
const cronError = computed(() => (edit.value?.pull_scheduled ? cronValidationMessage(t, edit.value.cron) : null));

/**
 * The other repository that already has a one-only usage, so this one cannot take it too.
 *
 * Args:
 *   usage (object): one of USAGES.
 *
 * Returns:
 *   string|null: that repository's name.
 */
function takenBy(usage) {
  if (!usage.oneOnly || edit.value[usage.key]) return null;
  const other = others.value.find((r) => r[usage.key] && r.name !== repo.value.name);
  return other ? other.name : null;
}

/**
 * Loads the repository, the others (for the one-only usages) and the credentials.
 *
 * Args:
 *   keepEdits (boolean): keep what is being edited (a status refresh while running).
 */
async function load(keepEdits = false) {
  const auth = TokenStorage.getAuthentication();
  try {
    const res = await axios.get(`/api/v2/repository/${encodeURIComponent(repoName.value)}`, auth);
    const record = res.data.records ? res.data.records[0] : res.data;
    repo.value = record || null;
    if (record && (!keepEdits || !edit.value)) edit.value = editable(record);
  } catch {
    repo.value = null;
  }
  if (!keepEdits) {
    const [list, creds] = await Promise.all([
      axios.get('/api/v2/repository/', auth).catch(() => null),
      axios.get('/api/v2/credential/', auth).catch(() => null),
    ]);
    others.value = list?.data?.records || [];
    credentials.value = [{ name: '' }, ...(creds?.data?.records || []).map((c) => ({ name: c.name }))];
  }
  loaded.value = true;
}

// while git runs, the status and output are refreshed every 2 seconds
let poll = null;
function watchRun() {
  clearInterval(poll);
  poll = setInterval(async () => {
    await load(true);
    if (!running.value) clearInterval(poll);
  }, 2000);
}
onBeforeUnmount(() => clearInterval(poll));

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the dialog's steps, and the last output
const tabs = computed(() => [
  { key: 'repository', label: t('settings.repositories.stepRepository'), icon: 'fab,git' },
  { key: 'access', label: t('settings.repositories.stepCredentials'), icon: 'key' },
  { key: 'usage', label: t('settings.repositories.stepUsage'), icon: 'list-check' },
  { key: 'schedule', label: t('settings.repositories.stepSchedule'), icon: 'stopwatch' },
  { key: 'output', label: t('admin.lastOutput'), icon: 'terminal' },
]);
const { activeTab } = useRouteTab('repository', (key) => tabs.value.some((x) => x.key === key));

// the title : Repositories › <name>, each step a link
const crumbs = computed(() => [
  { title: t('settings.repositories.labelPlural'), icon: 'fab,git', to: '/settings/repositories' },
  {
    title: repo.value?.name || repoName.value,
    icon: 'fab,git',
    to: `/settings/repositories/${encodeURIComponent(repoName.value)}`,
  },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Says what went wrong in a toast.
 *
 * Args:
 *   err (Error): the axios error.
 */
function fail(err) {
  toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
}

/**
 * Saves the fields of every tab ; renamed, the page follows the new name.
 */
async function save() {
  const data = toSave.value;
  if (!data.name || !data.uri || !data.description) {
    toast.warning(t('settings.repositories.fieldsRequired'));
    return;
  }
  if (cronError.value) {
    toast.warning(cronError.value);
    return;
  }
  try {
    await axios.put(`/api/v2/repository/${encodeURIComponent(repoName.value)}`, data, TokenStorage.getAuthentication());
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    if (data.name !== repoName.value) {
      // the saved values first, so the unsaved guard lets the page go
      edit.value = null;
      repo.value = null;
      await router.replace({ path: `/settings/repositories/${encodeURIComponent(data.name)}`, query: route.query });
    }
    await load();
  } catch (err) {
    fail(err);
  }
}

/**
 * Runs git on it : a pull (clone), a reset or a push of its forms ; the status refreshed
 * until it is done, and the output shown.
 *
 * Args:
 *   what (string): clone, reset or sync.
 */
async function run(what) {
  repo.value.status = 'running';
  try {
    await axios.post(
      `/api/v2/repository/${encodeURIComponent(repoName.value)}/${what}`,
      {},
      TokenStorage.getAuthentication(),
    );
  } catch (err) {
    fail(err);
  }
  await load(true);
  if (running.value) watchRun();
}

// Change password : a repository that still has its own user and password (no credential)
const changingPassword = ref(false);

/**
 * Saves its own password.
 *
 * Args:
 *   password (string): the password, typed twice.
 */
async function savePassword(password) {
  try {
    await axios.put(
      `/api/v2/repository/${encodeURIComponent(repoName.value)}`,
      { password },
      TokenStorage.getAuthentication(),
    );
    changingPassword.value = false;
    toast.success(`${repo.value.name} ${t('settings.common.isUpdated')}`);
  } catch (err) {
    fail(err);
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the repository, then goes back to the repositories.
 */
async function deleteRepo() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/repository/${encodeURIComponent(repoName.value)}`, TokenStorage.getAuthentication());
    edit.value = null;
    repo.value = null;
    router.push('/settings/repositories');
  } catch (err) {
    fail(err);
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
  if (running.value) watchRun();
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ repo?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ repo?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteRepo()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <AppChangePasswordDialog
    v-if="changingPassword"
    icon="fab,git"
    :label="t('settings.repositories.placeholderPassword')"
    @save="savePassword"
    @close="changingPassword = false"
  />
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="fab,git"
        :title="repo?.name || repoName"
        :crumbs="crumbs"
        :description="t('settings.repositories.description')"
      >
        <template v-if="repo" #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="tab in tabs" :key="tab.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === tab.key }"
                href="#"
                @click.prevent="activeTab = tab.key"
              >
                <FaIcon :icon="tab.icon" class="me-1" />
                {{ tab.label }}
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="loaded && !repo" class="empty-state">
            <FaIcon icon="fab,git" class="empty-state-icon" />
            <span>{{ t('settings.repositories.notFound', { name: repoName }) }}</span>
          </div>
          <div v-else-if="repo && edit" class="af-repo-tab">
            <!-- Repository : what it is, and where it stands -->
            <template v-if="activeTab === 'repository'">
              <!-- where it stands : its status and head, each a field of the column, read only -->
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.fields.status') }}</div>
                <span v-html="statusPill(t, repo.status)"></span>
              </div>
              <div class="mb-3">
                <div class="form-label fw-bold">{{ t('settings.fields.head') }}</div>
                <span v-if="repo.head" class="font-monospace af-repo-head">{{ repo.head }}</span>
                <span v-else>–</span>
              </div>
              <BsInput
                class="af-repo-field"
                v-model="edit.name"
                icon="heading"
                :isFloating="false"
                :required="true"
                :help="t('settings.repositories.helpName')"
                :label="t('settings.fields.name')"
              />
              <BsInput
                class="af-repo-field"
                v-model="edit.branch"
                icon="code-branch"
                placeholder="main"
                :isFloating="false"
                :label="t('settings.fields.branch')"
              />
              <BsInput
                class="af-repo-field"
                v-model="edit.uri"
                icon="fab,git"
                placeholder="https://github.com/account/repo.git"
                :isFloating="false"
                :required="true"
                :help="t('settings.repositories.helpUri')"
                :label="t('settings.fields.uri')"
              />
              <BsInput
                class="af-repo-field"
                v-model="edit.description"
                icon="info-circle"
                :isFloating="false"
                :required="true"
                :label="t('settings.fields.description')"
              />
            </template>
            <!-- Credentials : the user and password git uses -->
            <template v-else-if="activeTab === 'access'">
              <BsInput
                class="af-repo-field"
                v-model="edit.credential"
                type="select"
                icon="key"
                :isFloating="false"
                :values="credentials"
                valueKey="name"
                labelKey="name"
                :help="t('settings.repositories.helpCredential')"
                :label="t('settings.repositories.credential')"
              />
              <p v-if="repo.user && !edit.credential" class="form-text mb-0">
                {{ t('settings.repositories.ownUser', { user: repo.user }) }}
              </p>
            </template>
            <!-- Usage : what the app reads from it ; a one-only usage another repository has is
                 greyed, who has it in the tooltip -->
            <template v-else-if="activeTab === 'usage'">
              <div
                v-for="usage in USAGES"
                :key="usage.key"
                class="form-check af-short-check"
                :class="{ 'af-taken': takenBy(usage) }"
                :title="takenBy(usage) ? t('settings.common.takenBy', { name: takenBy(usage) }) : null"
              >
                <input
                  :id="'af-usage-' + usage.key"
                  v-model="edit[usage.key]"
                  class="form-check-input"
                  type="checkbox"
                  :disabled="!!takenBy(usage)"
                />
                <label class="form-check-label" :for="'af-usage-' + usage.key">
                  <span class="af-short-label">{{ usage.label }}</span>
                  <span class="text-body-secondary small">{{ usage.hint }}</span>
                </label>
              </div>
            </template>
            <!-- Schedule : the scheduled pull and its schedule, the clone on app start -->
            <template v-else-if="activeTab === 'schedule'">
              <div class="form-check form-switch mb-3">
                <input
                  id="af-repo-scheduled"
                  v-model="edit.pull_scheduled"
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                />
                <label class="form-check-label fw-bold" for="af-repo-scheduled">{{
                  t('settings.repositories.scheduledPull')
                }}</label>
                <div class="form-text mt-1">{{ t('settings.repositories.helpScheduledPull') }}</div>
              </div>
              <div v-if="edit.pull_scheduled" class="mb-3 af-repo-cron">
                <BsCron v-model="edit.cron" icon="stopwatch" :hasError="!!cronError" />
                <div v-if="cronError" class="invalid-feedback d-block">{{ cronError }}</div>
              </div>
              <div class="form-check form-switch mb-0">
                <input
                  id="af-repo-rebase"
                  v-model="edit.rebase_on_start"
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                />
                <label class="form-check-label fw-bold" for="af-repo-rebase">{{
                  t('settings.repositories.cloneOnStart')
                }}</label>
                <div class="form-text mt-1">{{ t('settings.repositories.helpCloneOnStart') }}</div>
              </div>
            </template>
            <!-- Output : what git said the last time -->
            <template v-else>
              <!-- as the server log shows its lines : each with its number in a grey column -->
              <div v-if="repo.output" class="af-repo-output font-monospace" tabindex="0" role="region">
                <div v-for="(line, i) in outputLines" :key="i" class="af-repo-output-line">
                  <span class="af-line-no af-repo-line-no">{{ i + 1 }}</span
                  ><span class="af-repo-line">{{ line }}</span>
                </div>
              </div>
              <p v-else class="text-body-secondary mb-0">{{ t('settings.repositories.noOutput') }}</p>
            </template>
          </div>
        </template>
        <template v-if="repo" #actions>
          <!-- Pull, Push and Reset : git on the repository, as the designer's repository page -->
          <BsButton icon="download" cssClass="text-nowrap" :disabled="running" @click="run('clone')">{{
            t('settings.repositories.pull')
          }}</BsButton>
          <!-- Push : only a repository the app writes to (forms, settings), else greyed, why in the tooltip -->
          <BsButton
            icon="upload"
            cssClass="text-nowrap"
            :disabled="running || !canPush"
            :title="canPush ? null : t('settings.repositories.pushHint')"
            @click="run('sync')"
            >{{ t('settings.repositories.push') }}</BsButton
          >
          <BsButton icon="redo" cssClass="text-nowrap" :disabled="running" @click="run('reset')">{{
            t('settings.repositories.reset')
          }}</BsButton>
          <BsButton v-if="repo.user && !repo.credential" icon="lock" @click="changingPassword = true">{{
            t('settings.common.changePassword')
          }}</BsButton>
          <BsButton icon="trash" @click="confirmDelete = true">{{ t('common.delete') }}</BsButton>
          <BsButton icon="save" :colorClass="dirty ? 'primary' : 'secondary'" :disabled="!dirty" @click="save()">{{
            t('settings.common.save')
          }}</BsButton>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the wide fields' width of the settings pages, as a user's and an SSO provider's */
.af-repo-field :deep(.input-group),
.af-repo-cron {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge : the card zeroes its last element's margin */
.af-repo-tab {
  padding-bottom: 0.5rem;
}
.af-repo-head {
  font-size: 0.85em;
}
/* the short checkboxes : their labels one width, so the grey hints line up, as in the dialog */
.af-short-check {
  margin-bottom: 0.6rem;
}
.af-short-label {
  display: inline-block;
  min-width: 12rem;
}
.af-taken .form-check-label,
.af-taken .form-check-label span {
  color: var(--bs-secondary-color) !important;
  opacity: 0.6;
}
/* git's output, as the server log : a bordered box that scrolls within the card, each line
   numbered in a grey column, git's own spacing kept */
.af-repo-output {
  max-height: 60vh;
  overflow: auto;
  /* the fields' darker border, as the inputs on the other tabs */
  border: 1px solid var(--af-field-border);
  border-radius: var(--bs-border-radius);
  font-size: 0.85rem;
}
.af-repo-output-line {
  display: flex;
}
.af-repo-line-no {
  flex: 0 0 3rem;
  padding: 0 0.5rem;
  margin-right: 0.75rem;
  text-align: right;
  color: var(--bs-secondary-color);
  user-select: none;
}
.af-repo-line {
  white-space: pre;
}
/* the first and last lines a little away from the box's top and bottom, the grey column too */
.af-repo-output-line:first-child > span {
  padding-top: 0.4rem;
}
.af-repo-output-line:last-child > span {
  padding-bottom: 0.4rem;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
