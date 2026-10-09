<script setup>
/******************************************************************/
/*                                                                */
/*  A secret store's page (/admin/secretStores/<id>), opened from */
/*  the secret stores' list : the steps of its dialog as tabs,    */
/*  the tab kept in the url -                                     */
/*    Store       its name and description                        */
/*    Type        HashiCorp Vault or CyberArk CCP, and whether a  */
/*                Vault is a Vault Enterprise                     */
/*    Connection  its address and how its certificate is checked  */
/*    Login       a Vault's token ; a CyberArk's AppID and client */
/*                certificate                                     */
/*    Options     namespace, KV version, mount, cache, extra      */
/*  Test connection, Change token (or client key) and Delete top  */
/*  right, beside Save. A store of the config seed is read only.  */
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
import { SECRET_STORE_TYPES } from '@/config/settings';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the store ────────────────────────────────────────────────────────────────
const storeId = computed(() => String(route.params.id || ''));
const store = ref(null); // as saved
const edit = ref(null); // as edited
// what this page edits : the token and the client key have their own dialog
const EDITED = [
  'name',
  'description',
  'type',
  'vault_enterprise',
  'url',
  'skip_verify',
  'custom_ca',
  'ca_bundle',
  'app_id',
  'client_cert',
  'namespace',
  'kv_version',
  'default_mount',
  'cache_ttl_seconds',
  'extra',
];
// the types, Vault last, as the dialog's : a short name beside the radio, the rest in its hint
const TYPES = [...SECRET_STORE_TYPES].reverse();

/**
 * The fields of a store as this page edits them : the switches read from what is stored.
 *
 * Args:
 *   record (object): the store.
 *
 * Returns:
 *   object: the edited fields.
 */
function editable(record) {
  return {
    name: record.name ?? '',
    description: record.description ?? '',
    type: record.type || 'vault',
    vault_enterprise: !!String(record.namespace || '').trim(),
    url: record.url ?? '',
    skip_verify: !!record.ignore_certs,
    custom_ca: !!String(record.ca_bundle || '').trim(),
    ca_bundle: record.ca_bundle ?? '',
    app_id: record.app_id ?? '',
    client_cert: record.client_cert ?? '',
    namespace: record.namespace ?? '',
    kv_version: Number(record.kv_version) || 2,
    default_mount: record.default_mount ?? '',
    cache_ttl_seconds: record.cache_ttl_seconds ?? '',
    extra: record.extra ?? '',
  };
}

const managed = computed(() => !!store.value?.managed);
const isVault = computed(() => edit.value?.type === 'vault');
const dirty = computed(
  () => !!store.value && EDITED.some((k) => String(edit.value[k] ?? '') !== String(editable(store.value)[k] ?? '')),
);
// leaving with the store changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

/**
 * Loads the store.
 */
async function load() {
  try {
    const res = await axios.get(
      `/api/v2/secretstore/${encodeURIComponent(storeId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data.records ? res.data.records[0] : res.data;
    store.value = record || null;
    edit.value = record ? editable(record) : null;
  } catch {
    store.value = null;
  }
  loaded.value = true;
}

/**
 * Saves fields of the store.
 *
 * Args:
 *   data (object): the fields.
 *
 * Returns:
 *   Promise<boolean>: whether they were saved.
 */
async function update(data) {
  try {
    await axios.put(`/api/v2/secretstore/${encodeURIComponent(storeId.value)}`, data, TokenStorage.getAuthentication());
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the dialog's steps : Store, Type, Connection, Login, Options
const tabs = computed(() => [
  { key: 'store', label: t('settings.secretStores.stepStore'), icon: 'vault' },
  { key: 'type', label: t('settings.secretStores.stepType'), icon: 'shapes' },
  { key: 'connection', label: t('settings.secretStores.stepConnection'), icon: 'globe' },
  { key: 'auth', label: t('settings.secretStores.stepAuth'), icon: 'key' },
  { key: 'options', label: t('settings.secretStores.stepOptions'), icon: 'sliders' },
]);
const { activeTab } = useRouteTab('store', (key) => tabs.value.some((x) => x.key === key));

// the title : Secret stores › <name>, each step a link
const crumbs = computed(() => [
  { title: t('sidebar.secretStores'), icon: 'vault', to: '/admin/secretStores' },
  { title: store.value?.name || storeId.value, icon: 'vault', to: `/admin/secretStores/${storeId.value}` },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab, the switches stored as the dialog stores them : no namespace
 * but in a Vault Enterprise, a CA bundle only when checked against one.
 */
async function save() {
  const e = edit.value;
  if (!e.name.trim() || !e.url.trim() || (!isVault.value && !e.app_id.trim())) {
    toast.warning(t('settings.secretStores.fieldsRequired'));
    return;
  }
  const data = {
    name: e.name.trim(),
    description: e.description.trim(),
    type: e.type,
    url: e.url.trim(),
    ignore_certs: e.skip_verify ? 1 : 0,
    ca_bundle: !e.skip_verify && e.custom_ca ? e.ca_bundle : '',
    namespace: isVault.value && e.vault_enterprise ? e.namespace.trim() : '',
    cache_ttl_seconds: e.cache_ttl_seconds,
    extra: typeof e.extra === 'string' ? e.extra.trim() : e.extra,
  };
  if (isVault.value) {
    Object.assign(data, { kv_version: e.kv_version, default_mount: e.default_mount.trim() });
  } else {
    Object.assign(data, { app_id: e.app_id.trim(), client_cert: e.client_cert });
  }
  if (await update(data)) {
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

// Test connection : one at a time
const testing = ref(false);

/**
 * Asks the store whether it answers, and says so.
 */
async function testConnection() {
  testing.value = true;
  try {
    const result = await axios.post(
      `/api/v2/secretstore/${encodeURIComponent(storeId.value)}/check`,
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

// Change token (a Vault) or Change client key (a CyberArk) : pasted once, in a dialog
const changingSecret = ref(false);
const secretKey = computed(() => (isVault.value ? 'token' : 'client_key'));

/**
 * Saves the new token or client key.
 *
 * Args:
 *   secret (string): the token or the PEM private key.
 */
async function saveSecret(secret) {
  if (await update({ [secretKey.value]: secret })) {
    changingSecret.value = false;
    toast.success(`${store.value.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the store, then goes back to the secret stores.
 */
async function deleteStore() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/secretstore/${encodeURIComponent(storeId.value)}`, TokenStorage.getAuthentication());
    store.value = null;
    router.push('/admin/secretStores');
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
    <template #title> {{ t('common.delete') }} {{ store?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ store?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteStore()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <!-- a token or a private key : pasted once -->
  <AppChangePasswordDialog
    v-if="changingSecret"
    icon="vault"
    :title="isVault ? t('settings.runners.changeToken') : t('settings.secretStores.changeClientKey')"
    :label="isVault ? t('settings.fields.token') : t('settings.secretStores.clientKey')"
    :repeat="false"
    @save="saveSecret"
    @close="changingSecret = false"
  />
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="vault"
        :title="store?.name || storeId"
        :crumbs="crumbs"
        :description="t('settings.secretStores.description')"
      >
        <template v-if="store" #tabs>
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
          <div v-if="loaded && !store" class="empty-state">
            <FaIcon icon="vault" class="empty-state-icon" />
            <span>{{ t('settings.secretStores.notFound', { id: storeId }) }}</span>
          </div>
          <div v-else-if="store && edit" class="af-store-tab">
            <!-- a store of the config seed : read only here -->
            <div v-if="managed" class="alert alert-secondary py-2">
              <FaIcon icon="lock" class="me-2" />{{ t('settings.common.seedManagedNotice') }}
            </div>
            <fieldset :disabled="managed">
              <!-- Store : what it is called -->
              <template v-if="activeTab === 'store'">
                <BsInput
                  class="af-store-field"
                  v-model="edit.name"
                  icon="heading"
                  :isFloating="false"
                  :required="true"
                  :help="t('settings.secretStores.nameHelp')"
                  :label="t('settings.fields.name')"
                />
                <BsInput
                  class="af-store-field"
                  v-model="edit.description"
                  icon="info-circle"
                  :isFloating="false"
                  :label="t('settings.fields.description')"
                />
              </template>
              <!-- Type : CyberArk CCP or HashiCorp Vault, a Vault's Enterprise switch under it -->
              <template v-else-if="activeTab === 'type'">
                <div v-for="type in TYPES" :key="type.value" class="form-check af-short-check">
                  <input
                    :id="'af-type-' + type.value"
                    v-model="edit.type"
                    class="form-check-input"
                    type="radio"
                    name="af-store-type"
                    :value="type.value"
                  />
                  <label class="form-check-label" :for="'af-type-' + type.value">
                    <span class="af-short-label">{{ type.short || type.label }}</span>
                    <span class="text-body-secondary small">{{
                      t(`settings.secretStores.type_${type.value}Hint`)
                    }}</span>
                  </label>
                </div>
                <div v-if="isVault" class="form-check form-switch mt-3">
                  <input
                    id="af-store-enterprise"
                    v-model="edit.vault_enterprise"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                  />
                  <label class="form-check-label" for="af-store-enterprise">{{
                    t('settings.secretStores.enterprise')
                  }}</label>
                  <div class="form-text mt-1">{{ t('settings.secretStores.enterpriseHelp') }}</div>
                </div>
              </template>
              <!-- Connection : where it is, and how its certificate is checked -->
              <template v-else-if="activeTab === 'connection'">
                <BsInput
                  class="af-store-field"
                  v-model="edit.url"
                  icon="globe"
                  :placeholder="isVault ? 'https://vault.example.com:8200' : 'https://ccp.example.com'"
                  :isFloating="false"
                  :required="true"
                  :label="t('settings.fields.uri')"
                />
                <div class="form-check form-switch mb-3">
                  <input
                    id="af-store-skip"
                    v-model="edit.skip_verify"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    @change="edit.skip_verify && (edit.custom_ca = false)"
                  />
                  <label class="form-check-label" for="af-store-skip">{{ t('settings.runners.skipVerify') }}</label>
                </div>
                <div v-if="!edit.skip_verify" class="form-check form-switch mb-3">
                  <input
                    id="af-store-ca"
                    v-model="edit.custom_ca"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                  />
                  <label class="form-check-label" for="af-store-ca">{{ t('settings.runners.customCa') }}</label>
                </div>
                <BsInput
                  v-if="!edit.skip_verify && edit.custom_ca"
                  class="af-store-field"
                  v-model="edit.ca_bundle"
                  type="textarea"
                  icon="certificate"
                  placeholder="-----BEGIN CERTIFICATE-----"
                  :isFloating="false"
                  :help="t('settings.runners.caBundleHelp')"
                  :label="t('settings.fields.caBundle')"
                />
              </template>
              <!-- Login : a Vault's token (its dialog) ; a CyberArk's AppID and certificate -->
              <template v-else-if="activeTab === 'auth'">
                <template v-if="isVault">
                  <p class="form-text mb-0">{{ t('settings.secretStores.tokenOnPage') }}</p>
                </template>
                <template v-else>
                  <BsInput
                    class="af-store-field"
                    v-model="edit.app_id"
                    icon="id-badge"
                    :isFloating="false"
                    :required="true"
                    :help="t('settings.secretStores.appIdHelp')"
                    :label="t('settings.secretStores.appId')"
                  />
                  <BsInput
                    class="af-store-field"
                    v-model="edit.client_cert"
                    type="textarea"
                    icon="certificate"
                    placeholder="-----BEGIN CERTIFICATE-----"
                    :isFloating="false"
                    :help="t('settings.secretStores.clientCertHelp')"
                    :label="t('settings.secretStores.clientCert')"
                  />
                  <p class="form-text mb-0">{{ t('settings.secretStores.clientKeyOnPage') }}</p>
                </template>
              </template>
              <!-- Options : a Vault's namespace, KV version and mount ; the cache and extra of both -->
              <template v-else>
                <template v-if="isVault">
                  <BsInput
                    v-if="edit.vault_enterprise"
                    class="af-store-field"
                    v-model="edit.namespace"
                    icon="folder"
                    :isFloating="false"
                    :help="t('settings.secretStores.namespaceHelp')"
                    :label="t('settings.secretStores.namespace')"
                  />
                  <div class="mb-3">
                    <div class="form-label">{{ t('settings.secretStores.kvVersion') }}</div>
                    <div
                      v-for="opt in [
                        { value: 2, label: 'KV v2', hint: t('settings.secretStores.kv2Hint') },
                        { value: 1, label: 'KV v1', hint: t('settings.secretStores.kv1Hint') },
                      ]"
                      :key="opt.value"
                      class="form-check af-short-check"
                    >
                      <input
                        :id="'af-kv-' + opt.value"
                        v-model="edit.kv_version"
                        class="form-check-input"
                        type="radio"
                        name="af-store-kv"
                        :value="opt.value"
                      />
                      <label class="form-check-label" :for="'af-kv-' + opt.value">
                        <span class="af-short-label">{{ opt.label }}</span>
                        <span class="text-body-secondary small">{{ opt.hint }}</span>
                      </label>
                    </div>
                  </div>
                  <BsInput
                    class="af-store-field"
                    v-model="edit.default_mount"
                    icon="folder-open"
                    placeholder="secret"
                    :isFloating="false"
                    :help="t('settings.secretStores.defaultMountHelp')"
                    :label="t('settings.secretStores.defaultMount')"
                  />
                </template>
                <BsInput
                  class="af-store-field"
                  v-model="edit.cache_ttl_seconds"
                  type="number"
                  icon="clock"
                  :isFloating="false"
                  :help="t('settings.secretStores.cacheTtlHelp')"
                  :label="t('settings.secretStores.cacheTtl')"
                />
                <BsInput
                  class="af-store-field"
                  v-model="edit.extra"
                  type="textarea"
                  icon="code"
                  placeholder="{}"
                  :isFloating="false"
                  :help="t('settings.secretStores.extraHelp')"
                  :label="t('settings.secretStores.extra')"
                />
              </template>
            </fieldset>
          </div>
        </template>
        <template v-if="store" #actions>
          <BsButton icon="plug" cssClass="text-nowrap" :disabled="testing" @click="testConnection()">{{
            t('settings.common.testConnection')
          }}</BsButton>
          <template v-if="!managed">
            <BsButton icon="lock" cssClass="text-nowrap" @click="changingSecret = true">{{
              isVault ? t('settings.runners.changeToken') : t('settings.secretStores.changeClientKey')
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
/* the wide fields' width of the settings pages, as a runner's and a repository's */
.af-store-field :deep(.input-group) {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge, as every record's page (24px in all) */
.af-store-tab {
  padding-bottom: 0.5rem;
}
/* the fields sit in a fieldset (read only for the config seed's stores) : the card cannot reach
   its last field's margin to zero it, so it is zeroed here */
.af-store-tab fieldset > :last-child,
.af-store-tab fieldset > :last-child :deep(.mb-3:last-child) {
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
