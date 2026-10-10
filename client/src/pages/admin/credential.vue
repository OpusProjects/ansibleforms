<script setup>
/******************************************************************/
/*                                                                */
/*  A credential's page (/settings/credentials/<id>), opened from    */
/*  the credentials' list : the steps of its dialog as tabs, the  */
/*  tab kept in the url -                                         */
/*    Credential  its name and description                        */
/*    Type        SSH, Git, API, Database or CyberArk             */
/*    Login       its user (a CyberArk's AppID, client            */
/*                certificate and key)                            */
/*    Store       where the user and password are kept : the app's*/
/*                database, or a secret store (not a CyberArk's)  */
/*    Connection  a host and port (SSH, a database), a database's */
/*                type and name                                   */
/*  Test connection (a database), Change password and Delete top  */
/*  right, beside Save. A credential of the config seed is read   */
/*  only.                                                         */
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
import { CREDENTIAL_TYPES } from '@/config/settings';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the credential ───────────────────────────────────────────────────────────
const credentialId = computed(() => String(route.params.id || ''));
const credential = ref(null); // as saved
const edit = ref(null); // as edited
const secretStores = ref([]); // the stores a credential can read from
// what this page edits : the password has its own dialog ; a CyberArk's client key is typed
// on the Login tab, left empty to keep the stored one
const EDITED = [
  'name',
  'description',
  'credential_type',
  'user',
  'client_cert',
  'client_key',
  'secret_source',
  'secret_store',
  'secret_ref',
  'host',
  'port',
  'db_type',
  'db_name',
];
const DB_TYPES = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'mssql', label: 'MSSQL' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'mongodb', label: 'MongoDB' },
];

/**
 * The fields of a credential as this page edits them : its type (from is_database for an old
 * one), where its secret is kept, the client key always empty (the stored one is never sent).
 *
 * Args:
 *   record (object): the credential.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    credential_type: CREDENTIAL_TYPES.includes(record.credential_type)
      ? record.credential_type
      : record.is_database
        ? 'database'
        : 'ssh',
    user: record.user ?? '',
    client_cert: record.client_cert ?? '',
    client_key: '',
    secret_source: record.secret_store ? 'store' : 'local',
    secret_store: record.secret_store ?? '',
    secret_ref: record.secret_ref ?? '',
    host: record.host ?? '',
    port: record.port ?? '',
    db_type: record.db_type || 'mysql',
    db_name: record.db_name ?? '',
  };
}

const managed = computed(() => !!credential.value?.managed);
const type = computed(() => edit.value?.credential_type);
const isCyberark = computed(() => type.value === 'cyberark');
const isDatabase = computed(() => type.value === 'database');
// read from a secret store : the user and password typed here are not kept (a CyberArk's never is)
const fromStore = computed(() => !isCyberark.value && edit.value?.secret_source === 'store');
const dirty = computed(
  () =>
    !!credential.value &&
    EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(credential.value)[k] ?? '')),
);
// leaving with the credential changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

/**
 * Loads the credential and the secret stores it can read from.
 */
async function load() {
  const auth = TokenStorage.getAuthentication();
  try {
    const res = await axios.get(`/api/v2/credential/${encodeURIComponent(credentialId.value)}`, auth);
    const record = res.data.records ? res.data.records[0] : res.data;
    credential.value = record?.id ? record : null;
    edit.value = credential.value ? editable(record) : null;
  } catch {
    credential.value = null;
  }
  const stores = await axios.get('/api/v2/secretstore/', auth).catch(() => null);
  secretStores.value = [{ name: '' }, ...(stores?.data?.records || []).map((s) => ({ name: s.name }))];
  loaded.value = true;
}

/**
 * Saves fields of the credential.
 *
 * Args:
 *   data (object): the fields.
 *
 * Returns:
 *   Promise<boolean>: whether they were saved.
 */
async function update(data) {
  try {
    await axios.put(
      `/api/v2/credential/${encodeURIComponent(credentialId.value)}`,
      data,
      TokenStorage.getAuthentication(),
    );
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the dialog's steps : Store not for a CyberArk's, Connection for SSH and a database only
const tabs = computed(() =>
  [
    { key: 'credential', label: t('settings.credentials.stepCredential'), icon: 'lock' },
    { key: 'type', label: t('settings.credentials.stepType'), icon: 'shapes' },
    { key: 'login', label: t('settings.credentials.stepLogin'), icon: 'user' },
    !isCyberark.value && { key: 'store', label: t('settings.credentials.stepStore'), icon: 'vault' },
    ['ssh', 'database'].includes(type.value) && {
      key: 'connection',
      label: t('settings.credentials.stepConnection'),
      icon: 'server',
    },
  ].filter(Boolean),
);
const { activeTab } = useRouteTab('credential', (key) =>
  ['credential', 'type', 'login', 'store', 'connection'].includes(key),
);
// a tab the type does not have (Connection of an API credential) : its first
const shownTab = computed(() => (tabs.value.some((x) => x.key === activeTab.value) ? activeTab.value : 'credential'));

// the title : Credentials › <name>, each step a link
const crumbs = computed(() => [
  { title: t('sidebar.credentials'), icon: 'lock', to: '/settings/credentials' },
  {
    title: credential.value?.name || credentialId.value,
    icon: 'lock',
    to: `/settings/credentials/${credentialId.value}`,
  },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab, as the dialog saves them : read from a secret store, no user
 * and password are kept ; kept in the app's database, no secret store.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim() || !e.description.trim()) {
    toast.warning(t('settings.credentials.fieldsRequired'));
    return;
  }
  const data = {
    name: e.name.trim(),
    description: e.description.trim(),
    credential_type: e.credential_type,
    host: ['ssh', 'database'].includes(e.credential_type) ? e.host.trim() : '',
    port: ['ssh', 'database'].includes(e.credential_type) ? e.port : '',
    db_type: isDatabase.value ? e.db_type : '',
    db_name: isDatabase.value ? e.db_name.trim() : '',
  };
  if (fromStore.value) {
    Object.assign(data, { secret_store: e.secret_store, secret_ref: e.secret_ref.trim() });
  } else {
    Object.assign(data, { secret_store: '', secret_ref: '', user: e.user.trim() });
  }
  if (isCyberark.value) {
    data.client_cert = e.client_cert;
    // left empty, the stored key stays
    if (e.client_key.trim()) data.client_key = e.client_key;
  }
  if (await update(data)) {
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

// Test connection : a database credential, one at a time
const testing = ref(false);

/**
 * Logs in to the database with the credential, and says how it went.
 */
async function testConnection() {
  testing.value = true;
  try {
    const result = await axios.get(
      `/api/v2/credential/testdb/${encodeURIComponent(credentialId.value)}`,
      TokenStorage.getAuthentication(),
    );
    toast.success(result.data.message);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, t('admin.connectionFailed')));
  } finally {
    testing.value = false;
  }
}

// Change password : typed twice, as a user's
const changingPassword = ref(false);

/**
 * Saves the new password.
 *
 * Args:
 *   password (string): the password, typed twice.
 */
async function savePassword(password) {
  if (await update({ password })) {
    changingPassword.value = false;
    toast.success(`${credential.value.name} ${t('settings.common.isUpdated')}`);
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the credential, then goes back to the credentials.
 */
async function deleteCredential() {
  confirmDelete.value = false;
  try {
    await axios.delete(
      `/api/v2/credential/${encodeURIComponent(credentialId.value)}`,
      TokenStorage.getAuthentication(),
    );
    credential.value = null;
    router.push('/settings/credentials');
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
    <template #title> {{ t('common.delete') }} {{ credential?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ credential?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteCredential()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <AppChangePasswordDialog v-if="changingPassword" icon="lock" @save="savePassword" @close="changingPassword = false" />
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="lock"
        :title="credential?.name || credentialId"
        :crumbs="crumbs"
        :description="t('settings.credentials.description')"
      >
        <template v-if="credential" #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="tab in tabs" :key="tab.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: shownTab === tab.key }"
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
          <div v-if="loaded && !credential" class="empty-state">
            <FaIcon icon="lock" class="empty-state-icon" />
            <span>{{ t('settings.credentials.notFound', { id: credentialId }) }}</span>
          </div>
          <div v-else-if="credential && edit" class="af-credential-tab">
            <!-- a credential of the config seed : read only here -->
            <div v-if="managed" class="alert alert-secondary py-2">
              <FaIcon icon="lock" class="me-2" />{{ t('settings.common.seedManagedNotice') }}
            </div>
            <fieldset :disabled="managed">
              <!-- Credential : what it is called -->
              <template v-if="shownTab === 'credential'">
                <BsInput
                  class="af-credential-field"
                  v-model="edit.name"
                  icon="lock"
                  :isFloating="false"
                  :required="true"
                  :label="t('settings.fields.name')"
                />
                <BsInput
                  class="af-credential-field"
                  v-model="edit.description"
                  icon="info-circle"
                  :isFloating="false"
                  :required="true"
                  :label="t('settings.fields.description')"
                />
              </template>
              <!-- Type : what it is for, each its label and a few grey words -->
              <template v-else-if="shownTab === 'type'">
                <div v-for="kind in CREDENTIAL_TYPES" :key="kind" class="form-check af-short-check">
                  <input
                    :id="'af-ctype-' + kind"
                    v-model="edit.credential_type"
                    class="form-check-input"
                    type="radio"
                    name="af-credential-type"
                    :value="kind"
                  />
                  <label class="form-check-label" :for="'af-ctype-' + kind">
                    <span class="af-short-label">{{ t(`settings.credentials.type_${kind}`) }}</span>
                    <span class="text-body-secondary small">{{ t(`settings.credentials.type_${kind}Hint`) }}</span>
                  </label>
                </div>
              </template>
              <!-- Login : its user (read from a store : nothing here) ; a CyberArk's AppID,
                   client certificate and key -->
              <template v-else-if="shownTab === 'login'">
                <p v-if="fromStore" class="form-text mb-0">{{ t('settings.credentials.loginFromStore') }}</p>
                <template v-else>
                  <BsInput
                    class="af-credential-field"
                    v-model="edit.user"
                    icon="user"
                    :isFloating="false"
                    :help="isCyberark ? t('settings.secretStores.appIdHelp') : ''"
                    :label="isCyberark ? t('settings.secretStores.appId') : t('settings.fields.user')"
                  />
                  <template v-if="isCyberark">
                    <BsInput
                      class="af-credential-field"
                      v-model="edit.client_cert"
                      type="textarea"
                      icon="certificate"
                      placeholder="-----BEGIN CERTIFICATE-----"
                      :isFloating="false"
                      :help="t('settings.secretStores.clientCertHelp')"
                      :label="t('settings.secretStores.clientCert')"
                    />
                    <BsInput
                      class="af-credential-field"
                      v-model="edit.client_key"
                      type="textarea"
                      icon="key"
                      placeholder="-----BEGIN PRIVATE KEY-----"
                      :isFloating="false"
                      :help="t('settings.credentials.clientKeyKeep')"
                      :label="t('settings.secretStores.clientKey')"
                    />
                  </template>
                  <p v-else class="form-text mb-0">{{ t('settings.runners.passwordOnPage') }}</p>
                </template>
              </template>
              <!-- Store : the app's database, or a secret store and the place in it -->
              <template v-else-if="shownTab === 'store'">
                <div
                  v-for="opt in [
                    {
                      value: 'local',
                      label: t('settings.credentials.secretLocal'),
                      hint: t('settings.credentials.secretLocalHint'),
                    },
                    {
                      value: 'store',
                      label: t('settings.credentials.secretFromStore'),
                      hint: t('settings.credentials.secretFromStoreHint'),
                    },
                  ]"
                  :key="opt.value"
                  class="form-check af-short-check"
                >
                  <input
                    :id="'af-source-' + opt.value"
                    v-model="edit.secret_source"
                    class="form-check-input"
                    type="radio"
                    name="af-credential-source"
                    :value="opt.value"
                  />
                  <label class="form-check-label" :for="'af-source-' + opt.value">
                    <span class="af-short-label">{{ opt.label }}</span>
                    <span class="text-body-secondary small">{{ opt.hint }}</span>
                  </label>
                </div>
                <template v-if="fromStore">
                  <BsInput
                    class="af-credential-field mt-3"
                    v-model="edit.secret_store"
                    type="select"
                    icon="vault"
                    :isFloating="false"
                    :values="secretStores"
                    valueKey="name"
                    labelKey="name"
                    :help="t('settings.credentials.secretStoreHelp')"
                    :label="t('settings.credentials.secretStore')"
                  />
                  <BsInput
                    class="af-credential-field"
                    v-model="edit.secret_ref"
                    icon="shield-alt"
                    :placeholder="t('settings.credentials.secretRefPlaceholder')"
                    :isFloating="false"
                    :help="t('settings.credentials.secretRefHelp')"
                    :label="t('settings.credentials.secretRef')"
                  />
                </template>
              </template>
              <!-- Connection : a host and port ; a database's type and name -->
              <template v-else>
                <BsInput
                  class="af-credential-field"
                  v-model="edit.host"
                  icon="server"
                  :isFloating="false"
                  :label="t('settings.fields.host')"
                />
                <BsInput
                  class="af-credential-field"
                  v-model="edit.port"
                  type="number"
                  icon="arrows-alt-v"
                  :isFloating="false"
                  :label="t('settings.fields.port')"
                />
                <template v-if="isDatabase">
                  <BsInput
                    class="af-credential-field"
                    v-model="edit.db_type"
                    type="select"
                    icon="database"
                    :isFloating="false"
                    :values="DB_TYPES"
                    valueKey="value"
                    labelKey="label"
                    :required="true"
                    :label="t('settings.credentials.databaseType')"
                  />
                  <BsInput
                    class="af-credential-field"
                    v-model="edit.db_name"
                    icon="database"
                    :isFloating="false"
                    :label="t('settings.credentials.database')"
                  />
                </template>
              </template>
            </fieldset>
          </div>
        </template>
        <template v-if="credential" #actions>
          <BsButton
            v-if="credential.is_database"
            icon="plug"
            cssClass="text-nowrap"
            :disabled="testing"
            @click="testConnection()"
            >{{ t('settings.common.testConnection') }}</BsButton
          >
          <template v-if="!managed">
            <BsButton
              v-if="!isCyberark && !fromStore"
              icon="lock"
              cssClass="text-nowrap"
              @click="changingPassword = true"
              >{{ t('settings.common.changePassword') }}</BsButton
            >
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
/* the wide fields' width of the settings pages, as a runner's and a secret store's */
.af-credential-field :deep(.input-group) {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-credential-tab {
  padding-bottom: 0.5rem;
}
/* the fields sit in a fieldset (read only for the config seed's credentials) : the card cannot
   reach its last field's margin to zero it, so it is zeroed here */
.af-credential-tab fieldset > :last-child,
.af-credential-tab fieldset > :last-child :deep(.mb-3:last-child) {
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
