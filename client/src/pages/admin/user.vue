<script setup>
/******************************************************************/
/*                                                                */
/*  A local user's page (/admin/users/<id>), opened from the      */
/*  users list : its Details tab (username, description, email)  */
/*  and its Groups tab (the groups it belongs to : Add group, and */
/*  a row's menu or the checkboxes remove one, never the last),   */
/*  the tab kept in the url (?tab=groups). Change password and    */
/*  Delete top right, as the list's row menu has them.            */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authenticated = ref(false);
const loaded = ref(false);

// ─── the user and the groups ──────────────────────────────────────────────────
const userId = computed(() => String(route.params.id || ''));
const user = ref(null); // as saved
const edit = ref(null); // as edited : username, description, email
const groups = ref([]); // every local group : { id, name, description }

// the admin user : the way back in, never deleted or renamed (the server refuses both)
const isAdminUser = computed(() => user.value?.username === 'admin');

const dirty = computed(
  () =>
    !!user.value &&
    !!edit.value &&
    ['username', 'description', 'email'].some((k) => (edit.value[k] || '') !== (user.value[k] || '')),
);
// leaving with the details changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

// the groups the user belongs to : its first (group_id) and the others (group_ids)
const userGroups = computed(() => {
  const ids = user.value?.group_ids || (user.value ? [user.value.group_id] : []);
  return groups.value.filter((g) => ids.includes(g.id));
});

/**
 * Loads the user and the local groups.
 */
async function load() {
  try {
    const [u, g] = await Promise.all([
      axios.get(`/api/v2/user/${encodeURIComponent(userId.value)}`, TokenStorage.getAuthentication()),
      axios.get('/api/v2/group/', TokenStorage.getAuthentication()),
    ]);
    const record = u.data.records ? u.data.records[0] : u.data;
    user.value = record || null;
    edit.value = record
      ? { username: record.username || '', description: record.description || '', email: record.email || '' }
      : null;
    groups.value = (g.data.records || g.data).map((x) => ({ id: x.id, name: x.name, description: x.description }));
  } catch {
    user.value = null;
  }
  loaded.value = true;
}

/**
 * Saves fields of the user. The password is never sent from here but by Change password : the
 * one the api returns is masked, and sending it back would store the mask.
 *
 * Args:
 *   data (object): the fields to save.
 *
 * Returns:
 *   Promise<boolean>: whether it was saved.
 */
async function update(data) {
  try {
    await axios.put(`/api/v2/user/${encodeURIComponent(userId.value)}`, data, TokenStorage.getAuthentication());
    return true;
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
    return false;
  }
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// Details (username, description, email), Groups ; the tab kept in the url
const tabs = computed(() => [
  { key: 'details', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'groups', label: t('settings.settingsPage.groups'), icon: 'users' },
]);
const { activeTab } = useRouteTab('details', (key) => tabs.value.some((x) => x.key === key));

// the title : Users › <username>, each step a link : Users back to the list, the name to this page
const crumbs = computed(() => [
  { title: t('settings.users.labelPlural'), icon: 'user', to: '/admin/users' },
  { title: user.value?.username || userId.value, icon: 'user', to: `/admin/users/${userId.value}` },
]);

// ─── Details ──────────────────────────────────────────────────────────────────
const emailValid = computed(() => !edit.value?.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(edit.value.email));

/**
 * Saves the details : username, description and email.
 */
async function saveDetails() {
  if (!edit.value.username.trim()) {
    toast.warning(t('settings.users.usernameRequired'));
    return;
  }
  if (!emailValid.value) {
    toast.warning(t('settings.users.emailInvalid'));
    return;
  }
  const data = {
    username: edit.value.username.trim(),
    description: edit.value.description.trim(),
    email: edit.value.email.trim(),
  };
  if (await update(data)) {
    toast.success(`${data.username} ${t('settings.common.isUpdated')}`);
    await load();
  }
}

// ─── Add group / remove groups ────────────────────────────────────────────────
// Add group : a dialog with the groups the user is not in yet ; saved at once. Removing (a row's
// menu, or the rows ticked) is saved at once too ; a user keeps at least one group.
const addingGroup = ref(null); // the group id picked, null while the dialog is closed
const selectedGroups = ref([]); // the group rows ticked (their id)
const freeGroups = computed(() => groups.value.filter((g) => !userGroups.value.some((u) => u.id === g.id)));

/**
 * Adds the user to the group picked.
 */
async function saveAddGroup() {
  try {
    await axios.post(
      `/api/v2/user/${encodeURIComponent(userId.value)}/groups`,
      { group_id: addingGroup.value },
      TokenStorage.getAuthentication(),
    );
    addingGroup.value = null;
    await load();
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
  }
}

/**
 * Removes the user from groups, one after the other ; the server refuses the last one.
 *
 * Args:
 *   ids (number[]): the groups.
 */
async function removeGroups(ids) {
  for (const gid of ids) {
    try {
      await axios.delete(
        `/api/v2/user/${encodeURIComponent(userId.value)}/groups/${gid}`,
        TokenStorage.getAuthentication(),
      );
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
      break;
    }
  }
  selectedGroups.value = [];
  await load();
}

/**
 * Ticks or unticks a group row.
 *
 * Args:
 *   id (number): the group.
 */
function toggleGroup(id) {
  selectedGroups.value = selectedGroups.value.includes(id)
    ? selectedGroups.value.filter((x) => x !== id)
    : [...selectedGroups.value, id];
}

// ─── Change password ──────────────────────────────────────────────────────────
const changingPassword = ref(false); // the Change password dialog open (AppChangePasswordDialog)

/**
 * Saves the new password, typed twice in the dialog ; the server hashes it.
 *
 * Args:
 *   password (string): the new password.
 */
async function savePassword(password) {
  if (await update({ password })) {
    changingPassword.value = false;
    toast.success(t('settings.users.passwordChanged'));
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
const confirmDelete = ref(false);

/**
 * Deletes the user, then goes back to the list.
 */
async function deleteUser() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/user/${encodeURIComponent(userId.value)}`, TokenStorage.getAuthentication());
    router.push('/admin/users');
  } catch (err) {
    toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
  // opened from the list's Add to group : the dialog open at once, the url left clean
  if (route.query.add && user.value) {
    // in every group already : the dialog says so, its Save off
    addingGroup.value = freeGroups.value[0]?.id ?? '';
    const query = { ...route.query };
    delete query.add;
    router.replace({ path: route.path, query });
  }
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ user?.username }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ user?.username }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteUser()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <BsModal v-if="addingGroup !== null" size="md" @close="addingGroup = null">
    <template #title> <FaIcon icon="users" class="me-2" />{{ t('settings.settingsPage.addGroup') }} </template>
    <template #default>
      <label class="form-label fw-bold">{{ t('settings.fields.group') }}</label>
      <select v-model="addingGroup" class="form-select">
        <option v-for="g in freeGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <div v-if="!freeGroups.length" class="text-muted small mt-1">{{ t('settings.users.inEveryGroup') }}</div>
    </template>
    <template #footer>
      <BsButton icon="save" :disabled="!addingGroup" @click="saveAddGroup()">{{ t('settings.common.save') }}</BsButton>
    </template>
  </BsModal>
  <!-- the Change password dialog of the users list, the same component -->
  <AppChangePasswordDialog v-if="changingPassword" icon="user" @save="savePassword" @close="changingPassword = false" />
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="user"
        :title="user?.username || userId"
        :crumbs="crumbs"
        :description="t('settings.users.description')"
      >
        <template v-if="user" #tabs>
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
                <span v-if="tab.key === 'groups'" class="badge af-tab-count ms-1">{{ userGroups.length }}</span>
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="loaded && !user" class="empty-state">
            <FaIcon icon="user" class="empty-state-icon" />
            <span>{{ t('settings.users.userNotFound', { id: userId }) }}</span>
          </div>
          <!-- Details : the username, its description and email -->
          <div v-else-if="user && activeTab === 'details'" class="af-user-details">
            <BsInput
              class="af-user-field"
              v-model="edit.username"
              icon="user"
              :isFloating="false"
              :required="true"
              :disabled="isAdminUser"
              :label="t('settings.fields.username')"
            />
            <BsInput
              class="af-user-field"
              v-model="edit.description"
              icon="info-circle"
              :isFloating="false"
              :label="t('settings.fields.description')"
            />
            <BsInput
              class="af-user-field"
              v-model="edit.email"
              icon="envelope"
              :isFloating="false"
              :hasError="!emailValid"
              :label="t('settings.fields.email')"
            />
          </div>
          <!-- Groups : the group it belongs to, as the app's other tables -->
          <template v-else-if="user">
            <p v-if="!userGroups.length" class="text-muted small mb-0">{{ t('settings.users.noGroup') }}</p>
            <div v-else class="af-table-frame">
              <table class="table af-table">
                <thead>
                  <tr>
                    <th class="text-center bs-dt-select">
                      <input
                        type="checkbox"
                        class="form-check-input"
                        :checked="userGroups.length > 0 && userGroups.every((g) => selectedGroups.includes(g.id))"
                        @change="
                          selectedGroups = userGroups.every((g) => selectedGroups.includes(g.id))
                            ? []
                            : userGroups.map((g) => g.id)
                        "
                      />
                    </th>
                    <th>{{ t('settings.fields.name') }}</th>
                    <th>{{ t('settings.fields.description') }}</th>
                    <th class="af-group-menu-col"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="g in userGroups" :key="g.id" :class="{ 'bs-dt-selected': selectedGroups.includes(g.id) }">
                    <td class="text-center bs-dt-select">
                      <input
                        type="checkbox"
                        class="form-check-input"
                        :checked="selectedGroups.includes(g.id)"
                        @change="toggleGroup(g.id)"
                      />
                    </td>
                    <td>{{ g.name }}</td>
                    <!-- an en dash when the group says nothing -->
                    <td>{{ g.description || '–' }}</td>
                    <td class="bs-dt-row-actions">
                      <div class="dropdown">
                        <a
                          role="button"
                          class="bs-dt-row-menu px-2"
                          data-bs-toggle="dropdown"
                          data-bs-popper-config='{"strategy":"fixed"}'
                        >
                          <FaIcon icon="ellipsis-vertical" />
                        </a>
                        <ul class="dropdown-menu dropdown-menu-end">
                          <li>
                            <!-- its last group : a user keeps one -->
                            <a
                              class="dropdown-item"
                              :class="userGroups.length > 1 ? 'text-danger' : 'disabled text-muted'"
                              href="#"
                              @click.prevent="removeGroups([g.id])"
                            >
                              <FaIcon icon="trash" class="me-2" />{{ t('settings.users.removeFromUser') }}
                            </a>
                          </li>
                        </ul>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
        <template v-if="user" #actions>
          <!-- the groups ticked : removed, unless that would leave none -->
          <BsButton
            v-if="activeTab === 'groups' && selectedGroups.length"
            icon="trash"
            :disabled="selectedGroups.length >= userGroups.length"
            :title="selectedGroups.length >= userGroups.length ? t('settings.users.keepOneGroup') : null"
            @click="removeGroups(selectedGroups)"
            >{{ t('settings.users.removeFromUser') }} ({{ selectedGroups.length }})</BsButton
          >
          <BsButton
            v-if="activeTab === 'groups'"
            icon="plus"
            :disabled="!freeGroups.length"
            @click="addingGroup = freeGroups[0]?.id ?? null"
            >{{ t('settings.settingsPage.addGroup') }}</BsButton
          >
          <BsButton icon="lock" @click="changingPassword = true">{{ t('settings.common.changePassword') }}</BsButton>
          <BsButton icon="trash" :disabled="isAdminUser" @click="confirmDelete = true">{{
            t('common.delete')
          }}</BsButton>
          <BsButton
            v-if="activeTab === 'details'"
            icon="save"
            :colorClass="dirty ? 'primary' : 'secondary'"
            :disabled="!dirty"
            @click="saveDetails()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the wide fields' width of the settings pages, as a role's name and description */
.af-user-field :deep(.input-group) {
  max-width: 40rem;
}
/* the details end a little above the card's edge : the card zeroes its last field's margin */
.af-user-details {
  padding-bottom: 0.5rem;
}
/* the row menu's column : as narrow as the other tables' */
.af-group-menu-col {
  width: 3.5rem;
}
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
