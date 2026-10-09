<script setup>
/******************************************************************/
/*                                                                */
/*  A runner's page (/admin/runners/<id>), opened from the        */
/*  runners' list : the steps of its dialog as tabs, the tab kept */
/*  in the url -                                                  */
/*    Runner          its name, description, whether it is the    */
/*                    default of its kind, its registration       */
/*    Type            RTE, AWX, AAP or Ascender                   */
/*    Connection      its address and how its certificate is     */
/*                    checked                                     */
/*    Authentication  a token, or a user and password (AWX)       */
/*  Test connection, Change token (or password) and Delete top    */
/*  right, beside Save. A runner of the config seed is read only. */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import { RUNNER_KINDS, runnerKind, registrationPill } from '@/config/settings';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the runner ───────────────────────────────────────────────────────────────
const runnerId = computed(() => String(route.params.id || ''));
const runner = ref(null); // as saved
const edit = ref(null); // as edited
// what this page edits : the token and the password have their own dialog
const EDITED = [
  'name',
  'description',
  'kind',
  'uri',
  'use_credentials',
  'username',
  'skip_verify',
  'custom_ca',
  'ca_bundle',
];
// an example address of each kind, as the dialog's
const URI_EXAMPLE = {
  rte: 'https://rte-vmware:8000',
  awx: 'https://awx.example.com/api/v2',
  aap: 'https://aap.example.com/api/controller/v2',
  ascender: 'https://ascender.example.com/api/v2',
};

/**
 * The fields of a runner as this page edits them : its kind from its type and flavour, the
 * certificate checks from ignore_certs and its CA bundle.
 *
 * Args:
 *   record (object): the runner.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    kind: runnerKind(record),
    uri: record.uri ?? '',
    use_credentials: !!record.use_credentials,
    username: record.username ?? '',
    skip_verify: !!record.ignore_certs,
    custom_ca: !!String(record.ca_bundle || '').trim(),
    ca_bundle: record.ca_bundle ?? '',
  };
}

const managed = computed(() => !!runner.value?.managed);
const isRte = computed(() => edit.value?.kind === 'rte');
// an RTE takes its token ; an AWX, an AAP or an Ascender a token or a user and password
const usesCredentials = computed(() => !isRte.value && !!edit.value?.use_credentials);
const dirty = computed(
  () => !!runner.value && EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(runner.value)[k] ?? '')),
);
// leaving with the runner changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

/**
 * Loads the runner.
 */
async function load() {
  try {
    const res = await axios.get(
      `/api/v2/runner/${encodeURIComponent(runnerId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data.records ? res.data.records[0] : res.data;
    // its registration (state) is added to the list only : read from there
    if (record) {
      const list = await axios.get('/api/v2/runner/', TokenStorage.getAuthentication()).catch(() => null);
      const listed = (list?.data?.records || []).find((r) => String(r.id) === String(record.id));
      if (listed?.state) record.state = listed.state;
    }
    runner.value = record || null;
    edit.value = record ? editable(record) : null;
  } catch {
    runner.value = null;
  }
  loaded.value = true;
}

/**
 * Saves fields of the runner.
 *
 * Args:
 *   data (object): the fields.
 *
 * Returns:
 *   Promise<boolean>: whether they were saved.
 */
async function update(data) {
  try {
    await axios.put(`/api/v2/runner/${encodeURIComponent(runnerId.value)}`, data, TokenStorage.getAuthentication());
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the dialog's steps : Runner, Type, Connection, Authentication
const tabs = computed(() => [
  { key: 'runner', label: t('settings.runners.stepRunner'), icon: 'rocket' },
  { key: 'type', label: t('settings.runners.stepType'), icon: 'shapes' },
  { key: 'connection', label: t('settings.runners.stepConnection'), icon: 'globe' },
  { key: 'auth', label: t('settings.runners.stepAuth'), icon: 'key' },
]);
const { activeTab } = useRouteTab('runner', (key) => tabs.value.some((x) => x.key === key));

// the title : Runners › <name>, each step a link
const crumbs = computed(() => [
  { title: t('sidebar.runners'), icon: 'rocket', to: '/admin/runners' },
  { title: runner.value?.name || runnerId.value, icon: 'rocket', to: `/admin/runners/${runnerId.value}` },
]);

// the forms it is the default for : playbook forms (an RTE), template forms (the others)
const defaultFor = computed(() =>
  runner.value?.type === 'rte' ? t('settings.runners.default_playbook') : t('settings.runners.default_template'),
);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab, its kind stored as a type and a flavour, as the dialog does.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim() || !e.uri.trim()) {
    toast.warning(t('settings.runners.fieldsRequired'));
    return;
  }
  const data = {
    name: e.name.trim(),
    description: e.description.trim(),
    uri: e.uri.trim(),
    type: e.kind === 'rte' ? 'rte' : 'awx',
    flavour: ['aap', 'ascender'].includes(e.kind) ? e.kind : null,
    use_credentials: usesCredentials.value ? 1 : 0,
    username: usesCredentials.value ? e.username.trim() : runner.value.username,
    ignore_certs: e.skip_verify ? 1 : 0,
    ca_bundle: !e.skip_verify && e.custom_ca ? e.ca_bundle : '',
  };
  if (await update(data)) {
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

/**
 * Makes it the default of its kind, saved at once : the one before stops being it.
 */
async function makeDefault() {
  if (await update({ is_default: 1 })) {
    toast.success(`${runner.value.name} ${t('settings.common.isUpdated')}`);
  }
  await load();
}

// Test connection : one at a time
const testing = ref(false);

/**
 * Asks the runner whether it answers, and says so.
 */
async function testConnection() {
  testing.value = true;
  try {
    const result = await axios.post(
      `/api/v2/runner/${encodeURIComponent(runnerId.value)}/check`,
      {},
      TokenStorage.getAuthentication(),
    );
    toast.success(result.data.result);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, t('admin.connectionFailed')));
  } finally {
    testing.value = false;
  }
}

// Change token, or Change password with a user and password : its secret, asked in a dialog
const changingSecret = ref(false);
const secretKey = computed(() => (usesCredentials.value ? 'password' : 'token'));

/**
 * Saves the new token or password.
 *
 * Args:
 *   secret (string): the token (pasted once) or the password (typed twice).
 */
async function saveSecret(secret) {
  if (await update({ [secretKey.value]: secret })) {
    changingSecret.value = false;
    toast.success(`${runner.value.name} ${t('settings.common.isUpdated')}`);
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the runner, then goes back to the runners.
 */
async function deleteRunner() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/runner/${encodeURIComponent(runnerId.value)}`, TokenStorage.getAuthentication());
    runner.value = null;
    router.push('/admin/runners');
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ runner?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ runner?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteRunner()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <!-- a token is pasted once ; a password typed twice -->
  <AppChangePasswordDialog
    v-if="changingSecret"
    icon="rocket"
    :title="usesCredentials ? t('settings.common.changePassword') : t('settings.runners.changeToken')"
    :label="usesCredentials ? t('settings.fields.password') : t('settings.fields.token')"
    :repeat="usesCredentials"
    @save="saveSecret"
    @close="changingSecret = false"
  />
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="rocket"
        :title="runner?.name || runnerId"
        :crumbs="crumbs"
        :description="t('settings.runners.description')"
      >
        <template v-if="runner" #tabs>
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
          <div v-if="loaded && !runner" class="empty-state">
            <FaIcon icon="rocket" class="empty-state-icon" />
            <span>{{ t('settings.runners.notFound', { id: runnerId }) }}</span>
          </div>
          <div v-else-if="runner && edit" class="af-runner-tab">
            <!-- a runner of the config seed : read only here -->
            <div v-if="managed" class="alert alert-secondary py-2">
              <FaIcon icon="lock" class="me-2" />{{ t('settings.common.seedManagedNotice') }}
            </div>
            <fieldset :disabled="managed">
              <!-- Runner : what it is called, whether it is the default, its registration -->
              <template v-if="activeTab === 'runner'">
                <BsInput
                  class="af-runner-field"
                  v-model="edit.name"
                  icon="heading"
                  :isFloating="false"
                  :required="true"
                  :help="t('settings.runners.nameHelp')"
                  :label="t('settings.fields.name')"
                />
                <BsInput
                  class="af-runner-field"
                  v-model="edit.description"
                  icon="info-circle"
                  :isFloating="false"
                  :label="t('settings.fields.description')"
                />
                <div class="mb-3">
                  <label class="form-label fw-bold d-block" for="af-runner-default">{{
                    t('settings.runners.isDefault')
                  }}</label>
                  <!-- turned on, saved at once ; turned off by making another the default -->
                  <div class="form-check form-switch mb-0">
                    <input
                      id="af-runner-default"
                      class="form-check-input"
                      type="checkbox"
                      role="switch"
                      :checked="!!runner.is_default"
                      :disabled="!!runner.is_default"
                      @change="makeDefault()"
                    />
                  </div>
                  <div class="form-text">{{ t('settings.runners.defaultHelp', { forms: defaultFor }) }}</div>
                </div>
                <div class="mb-3">
                  <div class="form-label fw-bold">{{ t('settings.runners.state') }}</div>
                  <span v-html="registrationPill(t, runner.state)"></span>
                </div>
              </template>
              <!-- Type : RTE, AWX, AAP or Ascender, each its label and a few grey words -->
              <template v-else-if="activeTab === 'type'">
                <div v-for="kind in RUNNER_KINDS" :key="kind" class="form-check af-short-check">
                  <input
                    :id="'af-kind-' + kind"
                    v-model="edit.kind"
                    class="form-check-input"
                    type="radio"
                    name="af-runner-kind"
                    :value="kind"
                  />
                  <label class="form-check-label" :for="'af-kind-' + kind">
                    <span class="af-short-label">{{ t(`settings.runners.type_${kind}`) }}</span>
                    <span class="text-body-secondary small">{{ t(`settings.runners.type_${kind}Hint`) }}</span>
                  </label>
                </div>
              </template>
              <!-- Connection : where it is, and how its certificate is checked -->
              <template v-else-if="activeTab === 'connection'">
                <BsInput
                  class="af-runner-field"
                  v-model="edit.uri"
                  icon="globe"
                  :placeholder="URI_EXAMPLE[edit.kind]"
                  :isFloating="false"
                  :required="true"
                  :help="t(`settings.runners.uriHelp_${edit.kind}`)"
                  :label="t('settings.fields.uri')"
                />
                <div class="form-check form-switch mb-3">
                  <input
                    id="af-runner-skip"
                    v-model="edit.skip_verify"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    @change="edit.skip_verify && (edit.custom_ca = false)"
                  />
                  <label class="form-check-label" for="af-runner-skip">{{ t('settings.runners.skipVerify') }}</label>
                </div>
                <div v-if="!edit.skip_verify" class="form-check form-switch mb-3">
                  <input
                    id="af-runner-ca"
                    v-model="edit.custom_ca"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                  />
                  <label class="form-check-label" for="af-runner-ca">{{ t('settings.runners.customCa') }}</label>
                </div>
                <BsInput
                  v-if="!edit.skip_verify && edit.custom_ca"
                  class="af-runner-field"
                  v-model="edit.ca_bundle"
                  type="textarea"
                  icon="certificate"
                  placeholder="-----BEGIN CERTIFICATE-----"
                  :isFloating="false"
                  :help="t('settings.runners.caBundleHelp')"
                  :label="t('settings.fields.caBundle')"
                />
              </template>
              <!-- Authentication : an RTE's token ; an AWX's token, or a user and password -->
              <template v-else>
                <template v-if="!isRte">
                  <div
                    v-for="opt in [
                      {
                        value: false,
                        label: t('settings.runners.authToken'),
                        hint: t('settings.runners.authTokenHint'),
                      },
                      { value: true, label: t('settings.runners.authUser'), hint: t('settings.runners.authUserHint') },
                    ]"
                    :key="String(opt.value)"
                    class="form-check af-short-check"
                  >
                    <input
                      :id="'af-auth-' + opt.value"
                      v-model="edit.use_credentials"
                      class="form-check-input"
                      type="radio"
                      name="af-runner-auth"
                      :value="opt.value"
                    />
                    <label class="form-check-label" :for="'af-auth-' + opt.value">
                      <span class="af-short-label">{{ opt.label }}</span>
                      <span class="text-body-secondary small">{{ opt.hint }}</span>
                    </label>
                  </div>
                </template>
                <BsInput
                  v-if="usesCredentials"
                  class="af-runner-field mt-3"
                  v-model="edit.username"
                  icon="user"
                  :isFloating="false"
                  :label="t('settings.fields.username')"
                />
                <p class="form-text mb-0" :class="{ 'mt-3': !isRte && !usesCredentials }">
                  {{
                    usesCredentials
                      ? t('settings.runners.passwordOnPage')
                      : t(`settings.runners.tokenOnPage_${isRte ? 'rte' : 'api'}`)
                  }}
                </p>
              </template>
            </fieldset>
          </div>
        </template>
        <template v-if="runner" #actions>
          <BsButton icon="plug" cssClass="text-nowrap" :disabled="testing" @click="testConnection()">{{
            t('settings.common.testConnection')
          }}</BsButton>
          <template v-if="!managed">
            <BsButton icon="lock" cssClass="text-nowrap" @click="changingSecret = true">{{
              usesCredentials ? t('settings.common.changePassword') : t('settings.runners.changeToken')
            }}</BsButton>
            <BsButton icon="trash" @click="confirmDelete = true">{{ t('common.delete') }}</BsButton>
            <BsButton icon="save" :colorClass="dirty ? 'primary' : 'secondary'" :disabled="!dirty" @click="save()">{{
              t('settings.common.save')
            }}</BsButton>
          </template>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the wide fields' width of the settings pages, as a user's and a repository's */
.af-runner-field :deep(.input-group) {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-runner-tab {
  padding-bottom: 0.5rem;
}
/* the fields sit in a fieldset (read only for the config seed's runners) : the card cannot reach
   its last field's margin to zero it, so it is zeroed here */
.af-runner-tab fieldset > :last-child,
.af-runner-tab fieldset > :last-child :deep(.mb-3:last-child) {
  margin-bottom: 0 !important;
}
/* the radio buttons : their labels one width, so the grey hints line up, as in the dialog */
.af-short-check {
  margin-bottom: 0.6rem;
}
.af-short-label {
  display: inline-block;
  min-width: 12rem;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
