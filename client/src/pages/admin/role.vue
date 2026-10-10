<script setup>
/******************************************************************/
/*                                                                */
/*  A role's page (/settings/roles/<name>), opened from the roles    */
/*  list : its General tab (name and options), its Users and its  */
/*  Groups, the tab kept in the url (?tab=users). Saving writes   */
/*  the forms config, as the list does ; a renamed role's page    */
/*  follows its new name.                                         */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Profile from '@/lib/Profile';
import { useI18n } from 'vue-i18n';
import { useFormsConfig } from '@/composables/useFormsConfig';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRoleSupport } from '@/composables/useRoleSupport';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

const {
  roles,
  load,
  save,
  isRolesDirty,
  parseError,
  isTemplated,
  loadError,
  nextUid,
  roleOptionKeys,
  roleOptionLabel,
  authProviders,
} = useFormsConfig();
const { sortedLocalGroups, sortedLocalUsers, loadLocalNames, usersThroughGroups, stampRoleFlags, saveRoles } =
  useRoleSupport(roles, save);

// leaving with the role changed and unsaved asks first
useUnsavedGuard(isRolesDirty, () => t('settings.common.unsavedChanges'));

// read only when the config can't be loaded, can't be parsed or is a ytt template
const readOnly = computed(() => parseError.value || isTemplated.value || !!loadError.value);

// ─── the role of the page ─────────────────────────────────────────────────────
// found by the name it was loaded with (_sortName), so typing a new name does not lose it
const roleName = computed(() => String(route.params.name || ''));
const roleIndex = computed(() => roles.value.findIndex((r) => r._sortName === roleName.value));
const role = computed(() => (roleIndex.value >= 0 ? roles.value[roleIndex.value] : null));
// the local users it gets through its local groups (admin through admins)
const throughGroups = computed(() => usersThroughGroups(role.value));
// what the Users tab counts : the users named, and those through a group, each once
const userCount = computed(() => {
  if (!role.value) return 0;
  const names = new Set(role.value.users.map((u) => `${u.provider}/${u.name}`));
  for (const m of throughGroups.value) names.add(`local/${m.username}`);
  return names.size;
});

// ─── tabs ─────────────────────────────────────────────────────────────────────
// Details (the name, its description and the options), Users, Groups ; the tab kept in the url
const tabs = computed(() => [
  { key: 'general', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'users', label: t('settings.settingsPage.users'), icon: 'user' },
  { key: 'groups', label: t('settings.settingsPage.groups'), icon: 'users' },
]);
const { activeTab } = useRouteTab('general', (key) => tabs.value.some((x) => x.key === key));

// the title : Roles › <name>, each step a link : Roles back to the list, the name to this page
const crumbs = computed(() => [
  { title: t('settings.settingsPage.roles'), icon: 'user-shield', to: '/settings/roles' },
  // the role : a link to its own page too, its plain address (the first tab)
  {
    title: role.value?.name || roleName.value,
    icon: 'user-shield',
    to: `/settings/roles/${encodeURIComponent(roleName.value)}`,
  },
]);

// ─── actions ──────────────────────────────────────────────────────────────────
/**
 * Saves the forms config ; a renamed role's page then moves to its new name, on the same tab.
 */
async function saveRole() {
  // its position : the save reloads the roles under their new names, so the old one finds nothing
  const index = roleIndex.value;
  if (!(await saveRoles())) return;
  const name = roles.value[index]?._sortName;
  if (name && name !== roleName.value) {
    router.replace({ path: `/settings/roles/${encodeURIComponent(name)}`, query: route.query });
  }
}

// ─── Add user / Add group ─────────────────────────────────────────────────────
// a dialog for the user or the group added : where it comes from (its provider) and its name,
// a local one picked from the list, another typed. Saved at once, as the other New dialogs.
const adding = ref(null); // { kind: 'users' | 'groups', provider, name }

/**
 * Opens the Add user or Add group dialog, on the first local name not in the role yet.
 *
 * Args:
 *   kind (string): 'users' or 'groups'.
 */
function openAdd(kind) {
  adding.value = { kind, provider: 'local', name: localChoices(kind, 'local')[0] || '' };
}

/**
 * The local names the dialog offers : those not in the role yet.
 *
 * Args:
 *   kind (string): 'users' or 'groups'.
 *   provider (string): the provider chosen ; only 'local' has a list.
 *
 * Returns:
 *   string[]: the names.
 */
function localChoices(kind, provider) {
  if (provider !== 'local' || !role.value) return [];
  const taken = new Set(role.value[kind].filter((e) => e.provider === 'local').map((e) => e.name));
  return (kind === 'users' ? sortedLocalUsers.value : sortedLocalGroups.value).filter((n) => !taken.has(n));
}

/**
 * Adds the user or group of the dialog to the role and saves ; refused, it leaves the role
 * again and the dialog stays open.
 */
// the user or group of the dialog is in the role already : refused, said under the name
const addingTaken = computed(() => {
  if (!adding.value || !role.value) return false;
  const name = (adding.value.name || '').trim();
  return role.value[adding.value.kind].some((e) => e.provider === adding.value.provider && e.name === name);
});

async function confirmAdd() {
  const entry = { _uid: nextUid(), provider: adding.value.provider, name: (adding.value.name || '').trim() };
  if (!entry.name || addingTaken.value) return;
  const list = role.value[adding.value.kind];
  list.push(entry);
  if (await saveRoles()) {
    adding.value = null;
  } else {
    list.splice(list.indexOf(entry), 1);
  }
}

// ─── Remove from role ─────────────────────────────────────────────────────────
// the rows ticked in the Users or Groups table ; none kept from one tab to the other
const selected = ref([]);
watch(activeTab, () => (selected.value = []));

/**
 * Removes the users or groups ticked from the role, saved at once.
 */
async function removeSelected() {
  const kind = activeTab.value;
  role.value[kind] = role.value[kind].filter((e) => !selected.value.includes(e._uid));
  selected.value = [];
  await saveRoles();
}

// Delete asks first : it saves at once
const confirmDelete = ref(false);

/**
 * Removes the role and saves at once, then goes back to the list.
 */
async function deleteRole() {
  confirmDelete.value = false;
  if (roleIndex.value < 0) return;
  const removed = roles.value.splice(roleIndex.value, 1)[0];
  if (await saveRoles()) {
    router.push('/settings/roles');
  } else {
    // refused (the config locked) : the role stays
    roles.value.splice(roleIndex.value < 0 ? roles.value.length : roleIndex.value, 0, removed);
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([load(), loadLocalNames()]);
  stampRoleFlags();
  loaded.value = true;
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ role?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ role?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteRole()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <BsModal v-if="adding" size="md" @close="adding = null">
    <template #title>
      <FaIcon :icon="adding.kind === 'users' ? 'user' : 'users'" class="me-2" />{{
        adding.kind === 'users' ? t('settings.settingsPage.addUser') : t('settings.settingsPage.addGroup')
      }}
    </template>
    <template #default>
      <label class="form-label fw-bold">{{ t('settings.settingsPage.provider') }}</label>
      <select
        v-model="adding.provider"
        class="form-select mb-3"
        @change="adding.name = localChoices(adding.kind, adding.provider)[0] || ''"
      >
        <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
      </select>
      <label class="form-label fw-bold">{{ t('settings.settingsPage.name') }}</label>
      <select v-if="adding.provider === 'local'" v-model="adding.name" class="form-select">
        <option v-for="n in localChoices(adding.kind, 'local')" :key="n" :value="n">{{ n }}</option>
      </select>
      <input
        v-else
        v-model="adding.name"
        class="form-control"
        :placeholder="adding.kind === 'users' ? 'username' : 'groupname'"
      />
      <div v-if="addingTaken" class="text-danger small mt-1">
        {{ t('settings.settingsPage.roleMemberTaken', { name: adding.name, role: role?.name }) }}
      </div>
      <div
        v-else-if="adding.provider === 'local' && !localChoices(adding.kind, 'local').length"
        class="text-muted small mt-1"
      >
        {{ t('settings.settingsPage.roleNoLocalLeft') }}
      </div>
    </template>
    <template #footer>
      <BsButton icon="save" :disabled="!(adding.name || '').trim() || addingTaken" @click="confirmAdd()">{{
        t('settings.common.save')
      }}</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="user-shield"
        :title="role?.name || roleName"
        :crumbs="crumbs"
        :description="t('settings.settingsPage.rolesDescription')"
      >
        <template v-if="role" #tabs>
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
                <span v-if="tab.key !== 'general' && !role._public" class="badge af-tab-count ms-1">{{
                  tab.key === 'users' ? userCount : role.groups.length
                }}</span>
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="loadError" class="alert alert-danger" role="alert">
            {{ t('settings.common.failedToLoad') }} : {{ loadError }}
          </div>
          <div v-else-if="loaded && !role" class="empty-state">
            <FaIcon icon="user-shield" class="empty-state-icon" />
            <span>{{ t('settings.settingsPage.roleNotFound', { name: roleName }) }}</span>
          </div>
          <AppRoleEditor
            v-else-if="role"
            v-model:role="roles[roleIndex]"
            :tab="activeTab"
            v-model:selected="selected"
            @removed="saveRoles()"
            :throughGroups="throughGroups"
            :readOnly="readOnly"
            :authProviders="authProviders"
            :localGroups="sortedLocalGroups"
            :localUsers="sortedLocalUsers"
            :optionKeys="roleOptionKeys"
            :optionLabel="roleOptionLabel"
            :nextUid="nextUid"
          />
        </template>
        <template v-if="role" #actions>
          <!-- what is ticked in the table : removed from the role -->
          <BsButton v-if="selected.length" icon="trash" :disabled="readOnly" @click="removeSelected()"
            >{{ t('settings.settingsPage.removeFromRole') }} ({{ selected.length }})</BsButton
          >
          <!-- the tab's own add, top right as on the other pages -->
          <BsButton
            v-if="activeTab === 'users' && !role._public"
            icon="plus"
            :disabled="readOnly"
            @click="openAdd('users')"
            >{{ t('settings.settingsPage.addUser') }}</BsButton
          >
          <BsButton
            v-if="activeTab === 'groups' && !role._public"
            icon="plus"
            :disabled="readOnly"
            @click="openAdd('groups')"
            >{{ t('settings.settingsPage.addGroup') }}</BsButton
          >
          <BsButton v-if="!role._required" icon="trash" :disabled="readOnly" @click="confirmDelete = true">{{
            t('common.delete')
          }}</BsButton>
          <BsButton
            icon="save"
            :colorClass="isRolesDirty ? 'primary' : 'secondary'"
            :disabled="!isRolesDirty || readOnly"
            @click="saveRole()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the count of a tab : small and grey, as the menus' badges */
.af-tab-count {
  background: var(--bs-secondary-bg);
  color: var(--bs-secondary-color);
  font-weight: 600;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
