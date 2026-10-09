<script setup>
/******************************************************************/
/*                                                                */
/*  A mail server's page (/admin/mailSettings/<id>), opened from  */
/*  the mail servers' list : the steps of its dialog as tabs, and */
/*  a test mail, the tab kept in the url -                        */
/*    Server      its name, description, and whether it is the    */
/*                one the app sends with (Active)                 */
/*    Connection  its host, port and TLS                          */
/*    Sender      the from address, and the smtp credential it    */
/*                logs in with (or a new one)                     */
/*    Test        a test mail through it, as saved                */
/*  Delete top right, beside Save. A server of the config seed is */
/*  read only.                                                    */
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
import getSettings from '@/config/settings';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the server ───────────────────────────────────────────────────────────────
const serverId = computed(() => String(route.params.id || ''));
const server = ref(null); // as saved
const edit = ref(null); // as edited
const EDITED = ['name', 'description', 'server', 'port', 'secure', 'from_address', 'credential'];

/**
 * The fields of a server as this page edits them.
 *
 * Args:
 *   record (object): the mail server.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    server: record.server ?? '',
    port: record.port ?? '',
    secure: !!record.secure,
    from_address: record.from_address ?? '',
    credential: record.credential ?? '',
  };
}

const managed = computed(() => !!server.value?.managed);
const dirty = computed(
  () => !!server.value && EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(server.value)[k] ?? '')),
);
// leaving with the server changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

// the smtp credentials it can log in with, none first (a relay without a login)
const credentials = ref([]);

/**
 * Loads the smtp credentials the Credential dropdown offers.
 */
async function loadCredentials() {
  const res = await axios.get('/api/v2/credential/', TokenStorage.getAuthentication()).catch(() => null);
  credentials.value = [
    { name: '' },
    ...(res?.data?.records || []).filter((c) => c.credential_type === 'smtp').map((c) => ({ name: c.name })),
  ];
}

/**
 * Loads the server and the credentials.
 */
async function load() {
  try {
    const res = await axios.get(
      `/api/v2/mailserver/${encodeURIComponent(serverId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data.records ? res.data.records[0] : res.data;
    server.value = record?.id ? record : null;
    edit.value = server.value ? editable(record) : null;
  } catch {
    server.value = null;
  }
  await loadCredentials();
  loaded.value = true;
}

/**
 * Saves fields of the server.
 *
 * Args:
 *   data (object): the fields.
 *
 * Returns:
 *   Promise<boolean>: whether they were saved.
 */
async function update(data) {
  try {
    await axios.put(`/api/v2/mailserver/${encodeURIComponent(serverId.value)}`, data, TokenStorage.getAuthentication());
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// Add credential : the credentials' own dialog, over this page ; what it creates is chosen
const credentialsSettings = computed(() => getSettings(t).credentials);
const creator = ref(null);

/**
 * Chooses the credential just created in the credentials' dialog.
 *
 * Args:
 *   name (string): the new credential's name.
 */
async function onCredentialCreated(name) {
  await loadCredentials();
  edit.value.credential = name;
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
const tabs = computed(() => [
  { key: 'server', label: t('settings.mailServers.stepServer'), icon: 'envelope' },
  { key: 'connection', label: t('settings.mailServers.stepConnection'), icon: 'server' },
  { key: 'sender', label: t('settings.mailServers.stepSender'), icon: 'key' },
  { key: 'test', label: t('settings.mailServers.stepTest'), icon: 'paper-plane' },
]);
const { activeTab } = useRouteTab('server', (key) => tabs.value.some((x) => x.key === key));

// the title : Mail › <name>, each step a link
const crumbs = computed(() => [
  { title: t('sidebar.mail'), icon: 'envelope', to: '/admin/mailSettings' },
  { title: server.value?.name || serverId.value, icon: 'envelope', to: `/admin/mailSettings/${serverId.value}` },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim() || !e.server.trim() || !e.from_address.trim()) {
    toast.warning(t('settings.mailServers.fieldsRequired'));
    return;
  }
  const data = {
    name: e.name.trim(),
    description: e.description.trim(),
    server: e.server.trim(),
    port: e.port,
    secure: e.secure ? 1 : 0,
    from_address: e.from_address.trim(),
    credential: e.credential,
  };
  if (await update(data)) {
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

/**
 * Makes it the one the app sends with, saved at once : the one before stops being it.
 */
async function makeActive() {
  if (await update({ is_active: 1 })) toast.success(`${server.value.name} ${t('settings.common.isUpdated')}`);
  await load();
}

// Test : a mail through the server as saved, to the address typed
const testTo = ref('');
const testing = ref(false);

/**
 * Sends a test mail and says how it went.
 */
async function sendTest() {
  if (!testTo.value.trim()) {
    toast.warning(t('admin.mail.enterDestination'));
    return;
  }
  testing.value = true;
  try {
    const res = await axios.post(
      `/api/v2/mailserver/${encodeURIComponent(serverId.value)}/test`,
      { to: testTo.value.trim() },
      TokenStorage.getAuthentication(),
    );
    toast.success(res.data.message || res.data.result?.message);
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err));
  } finally {
    testing.value = false;
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the server, then goes back to the mail servers.
 */
async function deleteServer() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/mailserver/${encodeURIComponent(serverId.value)}`, TokenStorage.getAuthentication());
    server.value = null;
    router.push('/admin/mailSettings');
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
    <template #title> {{ t('common.delete') }} {{ server?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ server?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteServer()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <!-- Add credential : the credentials' dialog only, an smtp credential preset -->
  <div class="af-nested-dialogs">
    <AppAdminMulti
      ref="creator"
      dialogOnly
      :apiVersion="2"
      :settings="credentialsSettings"
      @created="onCredentialCreated"
    />
  </div>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="envelope"
        :title="server?.name || serverId"
        :crumbs="crumbs"
        :description="t('settings.mailServers.description')"
      >
        <template v-if="server" #tabs>
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
          <div v-if="loaded && !server" class="empty-state">
            <FaIcon icon="envelope" class="empty-state-icon" />
            <span>{{ t('settings.mailServers.notFound', { id: serverId }) }}</span>
          </div>
          <div v-else-if="server && edit" class="af-mail-tab">
            <!-- a server of the config seed : read only here -->
            <div v-if="managed" class="alert alert-secondary py-2">
              <FaIcon icon="lock" class="me-2" />{{ t('settings.common.seedManagedNotice') }}
            </div>
            <!-- Test : a mail through the server as saved -->
            <template v-if="activeTab === 'test'">
              <BsInput
                class="af-mail-field"
                v-model="testTo"
                type="email"
                icon="envelope"
                placeholder="you@example.com"
                :isFloating="false"
                :required="true"
                :label="t('admin.mail.mailTo')"
              />
              <BsButton icon="paper-plane" :disabled="testing || dirty" @click="sendTest()">{{
                t('settings.mailServers.sendTest')
              }}</BsButton>
            </template>
            <fieldset v-else :disabled="managed">
              <!-- Server : what it is called, and whether the app sends with it -->
              <template v-if="activeTab === 'server'">
                <BsInput
                  class="af-mail-field"
                  v-model="edit.name"
                  icon="heading"
                  :isFloating="false"
                  :required="true"
                  :label="t('settings.fields.name')"
                />
                <BsInput
                  class="af-mail-field"
                  v-model="edit.description"
                  icon="info-circle"
                  :isFloating="false"
                  :label="t('settings.fields.description')"
                />
                <div class="mb-3">
                  <label class="form-label fw-bold d-block" for="af-mail-active">{{
                    t('settings.mailServers.active')
                  }}</label>
                  <!-- turned on, saved at once ; turned off by making another the active one -->
                  <div class="form-check form-switch mb-0">
                    <input
                      id="af-mail-active"
                      class="form-check-input"
                      type="checkbox"
                      role="switch"
                      :checked="!!server.is_active"
                      :disabled="!!server.is_active"
                      @change="makeActive()"
                    />
                  </div>
                  <div class="form-text">{{ t('settings.mailServers.activeHelp') }}</div>
                </div>
              </template>
              <!-- Connection : its host, port and TLS -->
              <template v-else-if="activeTab === 'connection'">
                <BsInput
                  class="af-mail-field"
                  v-model="edit.server"
                  icon="server"
                  placeholder="smtp.example.com"
                  :isFloating="false"
                  :required="true"
                  :help="t('settings.mail.mailServerHelp')"
                  :label="t('settings.mail.mailServer')"
                />
                <BsInput
                  class="af-mail-field"
                  v-model="edit.port"
                  type="number"
                  icon="arrows-alt-v"
                  :isFloating="false"
                  :help="t('settings.mail.mailPortHelp')"
                  :label="t('settings.mail.mailPort')"
                />
                <div class="form-check form-switch mb-3">
                  <input
                    id="af-mail-tls"
                    v-model="edit.secure"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                  />
                  <label class="form-check-label" for="af-mail-tls">{{ t('settings.mail.useTls') }}</label>
                  <div class="form-text mt-1">{{ t('settings.mail.useTlsHelp') }}</div>
                </div>
              </template>
              <!-- Sender : the from address and the login -->
              <template v-else>
                <BsInput
                  class="af-mail-field"
                  v-model="edit.from_address"
                  type="email"
                  icon="envelope"
                  placeholder="noreply@example.com"
                  :isFloating="false"
                  :required="true"
                  :help="t('settings.mail.mailFromHelp')"
                  :label="t('settings.mail.mailFrom')"
                />
                <BsInput
                  class="af-mail-field"
                  v-model="edit.credential"
                  type="select"
                  icon="key"
                  :isFloating="false"
                  :values="credentials"
                  valueKey="name"
                  labelKey="name"
                  :help="t('settings.mailServers.helpCredential')"
                  :label="t('settings.mailServers.credential')"
                />
                <BsButton v-if="!managed" icon="plus" @click="creator?.newItem({ credential_type: 'smtp' })">{{
                  t('settings.repositories.newCredential')
                }}</BsButton>
              </template>
            </fieldset>
          </div>
        </template>
        <template v-if="server && !managed" #actions>
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
/* the wide fields' width of the settings pages, as a runner's and a credential's */
.af-mail-field :deep(.input-group) {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-mail-tab {
  padding-bottom: 0.5rem;
}
/* the fields sit in a fieldset (read only for the config seed's servers) : the card cannot reach
   its last field's margin to zero it, so it is zeroed here */
.af-mail-tab fieldset > :last-child,
.af-mail-tab fieldset > :last-child :deep(.mb-3:last-child) {
  margin-bottom: 0 !important;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
