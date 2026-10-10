<script setup>
/******************************************************************/
/*                                                                */
/*  An SSO provider's page (/settings/sso/<id>), opened from the     */
/*  providers' list : the steps of its dialog as tabs, the tab    */
/*  kept in the url -                                             */
/*    Details  its type (fixed), name and description             */
/*    Sign-in  how the app signs in with it (tenant, client id,   */
/*             issuer, redirect url), its help as in the dialog   */
/*    Groups   the group filter, and its help                     */
/*  Details' Active switch makes it the one its type signs in     */
/*  with ; Change secret and Delete top right.                    */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import getSettings from '@/config/settings';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const settings = computed(() => getSettings(t).oauth2_providers);
const authenticated = ref(false);
const loaded = ref(false);

// ─── the provider ─────────────────────────────────────────────────────────────
const providerId = computed(() => String(route.params.id || ''));
const provider = ref(null); // as saved
const edit = ref(null); // as edited
// what this page edits : the secret has its own dialog (Change secret)
const EDITED = ['name', 'description', 'tenant_id', 'client_id', 'issuer', 'redirect_uri', 'groupfilter'];
const TYPES = { azuread: 'Entra ID', oidc: 'Open ID' };

const dirty = computed(
  () => !!provider.value && EDITED.some((k) => (edit.value[k] ?? '') !== (provider.value[k] ?? '')),
);
// leaving with the provider changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

/**
 * Loads the provider.
 */
async function load() {
  try {
    const res = await axios.get(
      `/api/v2/oauth2/${encodeURIComponent(providerId.value)}`,
      TokenStorage.getAuthentication(),
    );
    const record = res.data.records ? res.data.records[0] : res.data;
    provider.value = record || null;
    edit.value = record ? Object.fromEntries(EDITED.map((k) => [k, record[k] ?? ''])) : null;
  } catch {
    provider.value = null;
  }
  loaded.value = true;
}

/**
 * Saves fields of the provider.
 *
 * Args:
 *   data (object): the fields.
 *
 * Returns:
 *   Promise<boolean>: whether they were saved.
 */
async function update(data) {
  try {
    await axios.put(`/api/v2/oauth2/${encodeURIComponent(providerId.value)}`, data, TokenStorage.getAuthentication());
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the dialog's steps : Details (its Provider step), Sign-in, Groups
const tabs = computed(() => [
  { key: 'details', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'signin', label: t('settings.oauth2.stepSignIn'), icon: 'right-to-bracket' },
  { key: 'groups', label: t('settings.oauth2.stepGroups'), icon: 'users' },
]);
const { activeTab } = useRouteTab('details', (key) => tabs.value.some((x) => x.key === key));

// the help of a tab, as the dialog's step shows it (the permissions of an Entra ID app...)
const notes = computed(() => {
  const step = (settings.value.steps || []).find((s) => s.key === activeTab.value);
  return step && typeof step.notes === 'function' && provider.value ? step.notes(provider.value).filter(Boolean) : [];
});

// the title : SSO › <name>, each step a link : SSO back to the providers, the name to this page
const crumbs = computed(() => [
  { title: t('sidebar.oauth2'), icon: 'right-to-bracket', to: { path: '/settings/sso', query: { tab: 'providers' } } },
  {
    title: provider.value?.name || providerId.value,
    icon: 'right-to-bracket',
    to: `/settings/sso/${providerId.value}`,
  },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the fields of every tab.
 */
async function save() {
  if (!edit.value.name.trim()) {
    toast.warning(t('settings.groups.nameRequired'));
    return;
  }
  const data = Object.fromEntries(
    EDITED.map((k) => [k, typeof edit.value[k] === 'string' ? edit.value[k].trim() : edit.value[k]]),
  );
  if (await update(data)) {
    toast.success(`${data.name} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

/**
 * Turns the provider on or off for sign-in, saved at once : on, the others of its type stop
 * being it (oauth2.model) ; off, its type offers no provider until another is turned on.
 *
 * Args:
 *   on (boolean): the switch's new state.
 */
async function setActive(on) {
  if (await update({ enable: on ? 1 : 0, provider: provider.value.provider })) await load();
  else await load();
}

// Change secret : the client secret, typed twice, as a password
const changingSecret = ref(false);

/**
 * Saves the new client secret.
 *
 * Args:
 *   secret (string): the secret, typed twice.
 */
async function saveSecret(secret) {
  if (await update({ client_secret: secret })) {
    changingSecret.value = false;
    toast.success(`${provider.value.name} ${t('settings.common.isUpdated')}`);
  }
}

// Delete asks first
const confirmDelete = ref(false);

/**
 * Deletes the provider, then goes back to the providers.
 */
async function deleteProvider() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/oauth2/${encodeURIComponent(providerId.value)}`, TokenStorage.getAuthentication());
    router.push({ path: '/settings/sso', query: { tab: 'providers' } });
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
    <template #title> {{ t('common.delete') }} {{ provider?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ provider?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteProvider()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <!-- the client secret : pasted from the provider's console, asked once -->
  <AppChangePasswordDialog
    v-if="changingSecret"
    icon="right-to-bracket"
    :title="t('settings.oauth2.changeSecret')"
    :label="t('settings.oauth2.clientSecret')"
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
        icon="right-to-bracket"
        :title="provider?.name || providerId"
        :crumbs="crumbs"
        :description="t('settings.oauth2.description')"
      >
        <template v-if="provider" #tabs>
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
          <div v-if="loaded && !provider" class="empty-state">
            <FaIcon icon="right-to-bracket" class="empty-state-icon" />
            <span>{{ t('settings.oauth2.providerNotFound', { id: providerId }) }}</span>
          </div>
          <div v-else-if="provider" class="af-provider-tab">
            <!-- the help of the tab, as in the dialog's step -->
            <div v-for="(note, n) in notes" :key="'note-' + n" class="alert alert-info af-provider-note">
              <div v-if="note.title" class="fw-bold">{{ note.title }}</div>
              <div v-if="note.text">{{ note.text }}</div>
              <ul v-if="note.items && note.items.length" class="mb-0">
                <li v-for="(line, l) in note.items" :key="l">{{ line }}</li>
              </ul>
            </div>
            <!-- Details : its type (fixed : a provider does not change type), name, description -->
            <template v-if="activeTab === 'details'">
              <BsInput
                class="af-provider-field"
                :modelValue="TYPES[provider.provider] || provider.provider"
                icon="cloud"
                :isFloating="false"
                :disabled="true"
                :label="t('settings.oauth2.provider')"
              />
              <BsInput
                class="af-provider-field"
                v-model="edit.name"
                icon="heading"
                :isFloating="false"
                :required="true"
                :label="t('settings.fields.name')"
              />
              <BsInput
                class="af-provider-field"
                v-model="edit.description"
                icon="info-circle"
                :isFloating="false"
                :label="t('settings.fields.description')"
              />
              <!-- whether users sign in with it : a switch, as LDAP's, saved at once -->
              <div class="mb-0">
                <label class="form-label fw-bold d-block" for="af-provider-active">{{
                  t('settings.oauth2.active')
                }}</label>
                <div class="form-check form-switch mb-0">
                  <input
                    id="af-provider-active"
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    :checked="!!provider.enable"
                    @change="setActive($event.target.checked)"
                  />
                </div>
                <div class="form-text">
                  {{ t('settings.oauth2.activeHelp', { type: TYPES[provider.provider] || provider.provider }) }}
                </div>
              </div>
            </template>
            <!-- Sign-in : how the app signs in with it -->
            <template v-else-if="activeTab === 'signin'">
              <BsInput
                v-if="provider.provider === 'azuread'"
                class="af-provider-field"
                v-model="edit.tenant_id"
                icon="building"
                :required="true"
                :isFloating="false"
                :help="t('settings.oauth2.tenantIdHelp')"
                :label="t('settings.oauth2.tenantId')"
              />
              <BsInput
                class="af-provider-field"
                v-model="edit.client_id"
                icon="key"
                :isFloating="false"
                :required="true"
                :label="t('settings.oauth2.clientId')"
              />
              <BsInput
                v-if="provider.provider === 'oidc'"
                class="af-provider-field"
                v-model="edit.issuer"
                icon="globe"
                :isFloating="false"
                :required="true"
                :label="t('settings.oauth2.issuer')"
              />
              <BsInput
                class="af-provider-field"
                v-model="edit.redirect_uri"
                icon="link"
                :isFloating="false"
                :label="t('settings.oauth2.redirectUrl')"
              />
            </template>
            <!-- Groups : which of the user's groups the app keeps -->
            <template v-else>
              <BsInput
                class="af-provider-field"
                v-model="edit.groupfilter"
                icon="filter"
                :isFloating="false"
                :label="t('settings.oauth2.groupFilter')"
              />
            </template>
          </div>
        </template>
        <template v-if="provider" #actions>
          <BsButton icon="lock" @click="changingSecret = true">{{ t('settings.oauth2.changeSecret') }}</BsButton>
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
/* the wide fields' width of the settings pages, as a user's and a group's */
.af-provider-field :deep(.input-group) {
  max-width: 40rem;
}
/* the tab ends a little above the card's edge : the card zeroes its last element's margin */
.af-provider-tab {
  padding-bottom: 0.5rem;
}
/* the help of a tab : compact, as the dialog's steps show it, the card's width so each line of
   it stays one line */
.af-provider-note {
  padding: 0.5rem 0.75rem;
}
.af-provider-note ul {
  padding-left: 1.25rem;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
