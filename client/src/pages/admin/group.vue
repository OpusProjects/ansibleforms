<script setup>
/******************************************************************/
/*                                                                */
/*  A local group's page (/admin/groups/<id>), opened from the    */
/*  groups list : its Details tab (name, description) and its     */
/*  Users tab (the users in it : Add user, and a row's menu or    */
/*  the checkboxes remove one, never from its only group), the    */
/*  tab kept in the url (?tab=users). Delete top right, off for   */
/*  admins and while the group has users (the server refuses).    */
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

// ─── the group and the users ──────────────────────────────────────────────────
const groupId = computed(() => String(route.params.id || ''));
const groupIdNumber = computed(() => parseInt(groupId.value, 10));
const group = ref(null); // as saved
const edit = ref(null); // as edited : name, description
const users = ref([]); // every local user : { id, username, description, email, group_ids }

// the admins group keeps its name and is never deleted (the server refuses both)
const isAdmins = computed(() => group.value?.name === 'admins');
const dirty = computed(
  () =>
    !!group.value &&
    !!edit.value &&
    ['name', 'description'].some((k) => (edit.value[k] || '') !== (group.value[k] || '')),
);
// leaving with the details changed and unsaved asks first
useUnsavedGuard(dirty, () => t('settings.common.unsavedChanges'));

// the users in the group (as their first group or another one), and the others
const members = computed(() => users.value.filter((u) => (u.group_ids || []).includes(groupIdNumber.value)));
const others = computed(() => users.value.filter((u) => !(u.group_ids || []).includes(groupIdNumber.value)));
// a user whose only group this is : not removed from it (a user keeps one group)
const onlyGroup = (u) => (u.group_ids || []).length <= 1;

/**
 * Loads the group and the local users.
 */
async function load() {
  try {
    const [g, u] = await Promise.all([
      axios.get(`/api/v2/group/${encodeURIComponent(groupId.value)}`, TokenStorage.getAuthentication()),
      axios.get('/api/v2/user/', TokenStorage.getAuthentication()),
    ]);
    const record = g.data.records ? g.data.records[0] : g.data;
    group.value = record || null;
    edit.value = record ? { name: record.name || '', description: record.description || '' } : null;
    users.value = u.data.records || u.data;
  } catch {
    group.value = null;
  }
  loaded.value = true;
}

/**
 * The api's error, as a toast.
 *
 * Args:
 *   err (Error): the axios error.
 */
function toastError(err) {
  toast.error(err.response?.data?.message || err.response?.data?.error || err.message);
}

// ─── tabs ─────────────────────────────────────────────────────────────────────
// Details (name, description), Users ; the tab kept in the url
const tabs = computed(() => [
  { key: 'details', label: t('settings.common.tabDetails'), icon: 'sliders' },
  { key: 'users', label: t('settings.settingsPage.users'), icon: 'user' },
]);
const { activeTab } = useRouteTab('details', (key) => tabs.value.some((x) => x.key === key));

// the title : Groups › <name>, each step a link : Groups back to the list, the name to this page
const crumbs = computed(() => [
  { title: t('sidebar.groups'), icon: 'users', to: '/admin/groups' },
  { title: group.value?.name || groupId.value, icon: 'users', to: `/admin/groups/${groupId.value}` },
]);

// ─── Details ──────────────────────────────────────────────────────────────────
/**
 * Saves the details : name and description.
 */
async function saveDetails() {
  const name = edit.value.name.trim();
  if (!name) {
    toast.warning(t('settings.groups.nameRequired'));
    return;
  }
  try {
    await axios.put(
      `/api/v2/group/${encodeURIComponent(groupId.value)}`,
      { name, description: edit.value.description.trim() },
      TokenStorage.getAuthentication(),
    );
    toast.success(`${name} ${t('settings.common.isUpdated')}`);
    await load();
  } catch (err) {
    toastError(err);
  }
}

// ─── Add user / remove users ──────────────────────────────────────────────────
// Add user : a dialog with the users not in the group ; saved at once. Removing (a row's menu,
// or the rows ticked) is saved at once too, except from a user's only group.
const addingUser = ref(null); // the user id picked, null while the dialog is closed
const selectedUsers = ref([]); // the user rows ticked (their id)

/**
 * Adds the user picked to the group.
 */
async function saveAddUser() {
  try {
    await axios.post(
      `/api/v2/user/${addingUser.value}/groups`,
      { group_id: groupIdNumber.value },
      TokenStorage.getAuthentication(),
    );
    addingUser.value = null;
    await load();
  } catch (err) {
    toastError(err);
  }
}

/**
 * Removes users from the group, one after the other ; a user's only group is left alone.
 *
 * Args:
 *   ids (number[]): the users.
 */
async function removeUsers(ids) {
  for (const uid of ids) {
    try {
      await axios.delete(`/api/v2/user/${uid}/groups/${groupIdNumber.value}`, TokenStorage.getAuthentication());
    } catch (err) {
      toastError(err);
      break;
    }
  }
  selectedUsers.value = [];
  await load();
}

/**
 * Ticks or unticks a user row.
 *
 * Args:
 *   id (number): the user.
 */
function toggleUser(id) {
  selectedUsers.value = selectedUsers.value.includes(id)
    ? selectedUsers.value.filter((x) => x !== id)
    : [...selectedUsers.value, id];
}

// the rows that can be ticked : not a user's only group
const removable = computed(() => members.value.filter((u) => !onlyGroup(u)));

// ─── Delete ───────────────────────────────────────────────────────────────────
const confirmDelete = ref(false);

/**
 * Deletes the group, then goes back to the list.
 */
async function deleteGroup() {
  confirmDelete.value = false;
  try {
    await axios.delete(`/api/v2/group/${encodeURIComponent(groupId.value)}`, TokenStorage.getAuthentication());
    router.push('/admin/groups');
  } catch (err) {
    toastError(err);
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await load();
  // opened from the list's Add user : the dialog open at once, the url left clean
  if (route.query.add && group.value) {
    addingUser.value = others.value[0]?.id ?? '';
    const query = { ...route.query };
    delete query.add;
    router.replace({ path: route.path, query });
  }
});
</script>
<template>
  <BsModal v-if="confirmDelete" size="md" @close="confirmDelete = false">
    <template #title> {{ t('common.delete') }} {{ group?.name }} </template>
    <template #default>
      <p class="mb-0 fs-6 user-select-none">
        {{ t('settings.common.deleteConfirm') }} <strong>{{ group?.name }}</strong
        >?
      </p>
    </template>
    <template #footer>
      <BsButton icon="trash" @click="deleteGroup()">{{ t('common.delete') }}</BsButton>
    </template>
  </BsModal>
  <BsModal v-if="addingUser !== null" size="md" @close="addingUser = null">
    <template #title> <FaIcon icon="user" class="me-2" />{{ t('settings.settingsPage.addUser') }} </template>
    <template #default>
      <label class="form-label fw-bold">{{ t('settings.fields.username') }}</label>
      <select v-model="addingUser" class="form-select">
        <option v-for="u in others" :key="u.id" :value="u.id">{{ u.username }}</option>
      </select>
      <div v-if="!others.length" class="text-muted small mt-1">{{ t('settings.groups.everyUserIn') }}</div>
    </template>
    <template #footer>
      <BsButton icon="save" :disabled="!addingUser" @click="saveAddUser()">{{ t('settings.common.save') }}</BsButton>
    </template>
  </BsModal>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="users"
        :title="group?.name || groupId"
        :crumbs="crumbs"
        :description="t('settings.groups.description')"
      >
        <template v-if="group" #tabs>
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
                <span v-if="tab.key === 'users'" class="badge af-tab-count ms-1">{{ members.length }}</span>
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="loaded && !group" class="empty-state">
            <FaIcon icon="users" class="empty-state-icon" />
            <span>{{ t('settings.groups.groupNotFound', { id: groupId }) }}</span>
          </div>
          <!-- Details : the name and the description -->
          <div v-else-if="group && activeTab === 'details'" class="af-group-details">
            <BsInput
              class="af-group-field"
              v-model="edit.name"
              icon="users"
              :isFloating="false"
              :required="true"
              :disabled="isAdmins"
              :label="t('settings.fields.name')"
            />
            <BsInput
              class="af-group-field"
              v-model="edit.description"
              icon="info-circle"
              :isFloating="false"
              :label="t('settings.fields.description')"
            />
          </div>
          <!-- Users : the users in the group, as the app's other tables -->
          <template v-else-if="group">
            <p v-if="!members.length" class="text-muted small mb-0">{{ t('settings.groups.noUsers') }}</p>
            <div v-else class="af-table-frame">
              <table class="table af-table">
                <thead>
                  <tr>
                    <th class="text-center bs-dt-select">
                      <input
                        type="checkbox"
                        class="form-check-input"
                        :disabled="!removable.length"
                        :checked="removable.length > 0 && removable.every((u) => selectedUsers.includes(u.id))"
                        @change="
                          selectedUsers = removable.every((u) => selectedUsers.includes(u.id))
                            ? []
                            : removable.map((u) => u.id)
                        "
                      />
                    </th>
                    <th>{{ t('settings.fields.username') }}</th>
                    <th>{{ t('settings.fields.description') }}</th>
                    <th>{{ t('settings.fields.email') }}</th>
                    <th class="af-group-menu-col"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="u in members" :key="u.id" :class="{ 'bs-dt-selected': selectedUsers.includes(u.id) }">
                    <td class="text-center bs-dt-select">
                      <!-- this group is the user's only one : it stays (a user keeps one group) -->
                      <input
                        type="checkbox"
                        class="form-check-input"
                        :disabled="onlyGroup(u)"
                        :title="onlyGroup(u) ? t('settings.users.keepOneGroup') : null"
                        :checked="selectedUsers.includes(u.id)"
                        @change="toggleUser(u.id)"
                      />
                    </td>
                    <td>
                      <router-link :to="`/admin/users/${u.id}`" class="af-group-user-link">{{
                        u.username
                      }}</router-link>
                    </td>
                    <td>{{ u.description || '–' }}</td>
                    <td>{{ u.email || '–' }}</td>
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
                            <a
                              class="dropdown-item"
                              :class="onlyGroup(u) ? 'disabled text-muted' : 'text-danger'"
                              href="#"
                              @click.prevent="removeUsers([u.id])"
                            >
                              <FaIcon icon="trash" class="me-2" />{{ t('settings.groups.removeFromGroup') }}
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
        <template v-if="group" #actions>
          <!-- the users ticked : removed from the group -->
          <BsButton
            v-if="activeTab === 'users' && selectedUsers.length"
            icon="trash"
            @click="removeUsers(selectedUsers)"
            >{{ t('settings.groups.removeFromGroup') }} ({{ selectedUsers.length }})</BsButton
          >
          <BsButton
            v-if="activeTab === 'users'"
            icon="plus"
            :disabled="!others.length"
            @click="addingUser = others[0]?.id ?? null"
            >{{ t('settings.settingsPage.addUser') }}</BsButton
          >
          <!-- admins is never deleted, nor a group that still has users (the server refuses both) -->
          <BsButton
            icon="trash"
            :disabled="isAdmins || members.length > 0"
            :title="!isAdmins && members.length > 0 ? t('settings.groups.stillHasUsers') : null"
            @click="confirmDelete = true"
            >{{ t('common.delete') }}</BsButton
          >
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
/* the wide fields' width of the settings pages, as a user's and a role's */
.af-group-field :deep(.input-group) {
  max-width: 40rem;
}
/* the details end a little above the card's edge : the card zeroes its last field's margin */
.af-group-details {
  padding-bottom: 0.5rem;
}
/* the row menu's column : as narrow as the other tables' */
.af-group-menu-col {
  width: 3.5rem;
}
/* a user's name : a link to its page, in the blue of the rows that open something */
.af-group-user-link {
  color: var(--bs-primary);
  font-weight: 500;
  text-decoration: none;
}
.af-group-user-link:hover {
  text-decoration: underline;
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
