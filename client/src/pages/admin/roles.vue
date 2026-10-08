<script setup>
import { ref, computed, onMounted } from 'vue';
import Profile from '@/lib/Profile';
import axios from 'axios';
import TokenStorage from '@/lib/TokenStorage';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { useFormsConfig } from '@/composables/useFormsConfig';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';

const { t } = useI18n();
const authenticated = ref(false);
const expandedRoles = ref({});
const localGroups = ref([]);
const localUsers = ref([]);

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
  roleOptionDefaults,
  roleOptionLabel,
  authProviders,
} = useFormsConfig();

// This page had no unsaved-changes guard at all : navigating away or reloading threw
// the whole edit away silently. See useUnsavedGuard.
useUnsavedGuard(isRolesDirty, () => t('settings.common.unsavedChanges'));

// Read-only when the config can't be loaded, can't be parsed or is a ytt template.
const readOnly = computed(() => parseError.value || isTemplated.value || !!loadError.value);

const RESERVED_ROLES = ['admin', 'public'];

// _required/_public are read off flags stamped ONCE per load, never evaluated
// against the name currently being typed : a live check disables the name input
// the instant a custom name passes through 'admin'/'public', which traps the
// value there (the delete button hides at the same moment). The designer's role
// modal stamps the same two flags at open for exactly this reason.
function isRequiredRole(role) {
  return role._required === true;
}

// The 'public' role applies to everyone; the schema pins it to no groups/users.
function isPublicRole(role) {
  return role._public === true;
}

// Stamp the flags from the names as loaded. Must run after every load/reload.
// These are internal fields ; serializeRole rebuilds the role from known keys,
// so they never reach the yaml (the schema sets additionalProperties:false).
function stampRoleFlags() {
  for (const role of roles.value) {
    role._required = RESERVED_ROLES.includes(role.name);
    role._public = role.name === 'public';
  }
}

const sortedLocalGroups = computed(() => [...localGroups.value].sort());
const sortedLocalUsers = computed(() => [...localUsers.value].sort());

function onProviderChange(entry, type) {
  entry.name =
    entry.provider === 'local' ? (type === 'group' ? sortedLocalGroups.value[0] : sortedLocalUsers.value[0]) || '' : '';
}

function addRole() {
  const uid = nextUid();
  const newRole = {
    _uid: uid,
    _required: false,
    _public: false,
    name: '',
    groups: [],
    users: [],
    // start from the effective defaults : that is what a role without an
    // options block gets today, starting all-off would silently take
    // permissions away now that every flag is written explicitly
    options: roleOptionDefaults(''),
  };
  roles.value.push(newRole);
  expandedRoles.value[uid] = true;
}

function removeRole(index) {
  roles.value.splice(index, 1);
}

function toggleRole(uid) {
  expandedRoles.value[uid] = !expandedRoles.value[uid];
}

function addGroup(role) {
  role.groups.push({ _uid: nextUid(), provider: 'local', name: sortedLocalGroups.value[0] || '' });
}

function removeGroup(role, index) {
  role.groups.splice(index, 1);
}

function addUser(role) {
  role.users.push({ _uid: nextUid(), provider: 'local', name: sortedLocalUsers.value[0] || '' });
}

function removeUser(role, index) {
  role.users.splice(index, 1);
}

async function loadLocalGroups() {
  try {
    const result = await axios.get('/api/v2/group/', TokenStorage.getAuthentication());
    localGroups.value = (result.data.records || result.data).map((g) => g.name);
  } catch {
    localGroups.value = [];
  }
}

async function loadLocalUsers() {
  try {
    const result = await axios.get('/api/v2/user/', TokenStorage.getAuthentication());
    localUsers.value = (result.data.records || result.data).map((u) => u.username);
  } catch {
    localUsers.value = [];
  }
}

// The schema only requires `name` to be a string, so an empty, duplicated or
// reserved name is accepted server-side. Reject them here instead. Taking over a
// reserved name matters most : the server derives isAdmin from the role NAME, so
// a role renamed to 'admin' would grant admin to everyone it matches.
function validateRoles() {
  const seen = new Set();
  for (const role of roles.value) {
    const name = (role.name || '').trim();
    if (!name) return t('settings.settingsPage.roleNameRequired');
    if (seen.has(name)) return t('settings.settingsPage.duplicateRoleName', { name });
    seen.add(name);
    // Only 'admin' is protected, not every reserved name. The schema REQUIRES a
    // 'public' role, so blocking it too meant a config that had lost its public
    // role could never be repaired from this page. Duplicates are already caught
    // above, so allowing it cannot produce a second one. 'admin' stays blocked
    // because the server treats the role NAME as a privilege bypass
    // (roles.includes("admin") in middleware.js and job.model.js), independently
    // of the option flags.
    if (!role._required && name === 'admin') {
      return t('settings.settingsPage.reservedRoleName', { name });
    }
  }
  return null;
}

async function saveRoles() {
  const problem = validateRoles();
  if (problem) {
    toast.warning(problem);
    return;
  }
  // Roles reload as fresh objects (new _uid) on save, so remember which roles
  // were expanded by their stable identity (name) and restore afterwards. The
  // name is trimmed on serialize, so it is the trimmed one that comes back.
  const expandedNames = new Set(
    roles.value.filter((r) => expandedRoles.value[r._uid]).map((r) => (r.name || '').trim()),
  );
  const saved = await save(t('settings.settingsPage.roles'));
  // ONLY on success. These flags are stamped once per load precisely so a name passing
  // through a reserved value cannot trap the input - re-stamping after a failed save
  // (423 while the designer holds the lock, or a 409) disabled the name field and hid the
  // delete button on the role the user had just renamed, with no way back except a reload
  // that discarded the whole edit.
  if (!saved) return;
  stampRoleFlags();
  expandedRoles.value = Object.fromEntries(
    roles.value.filter((r) => expandedNames.has(r.name)).map((r) => [r._uid, true]),
  );
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([load(), loadLocalGroups(), loadLocalUsers()]);
  stampRoleFlags();
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="user-shield"
        :title="t('settings.settingsPage.roles')"
        :description="t('settings.settingsPage.rolesDescription')"
      >
        <template #default>
          <div class="pt-2">
            <div v-if="loadError" class="alert alert-danger" role="alert">
              {{ t('settings.common.failedToLoad') }} : {{ loadError }}
            </div>
            <div v-if="roles.length === 0" class="empty-state">
              <FaIcon icon="user-shield" class="empty-state-icon" />
              <span>{{ t('settings.settingsPage.noRoles') }}</span>
            </div>
            <div v-for="(role, rIdx) in roles" :key="role._uid" class="border rounded mb-2">
              <div
                class="d-flex align-items-center justify-content-between px-3 py-2 role-header"
                @click="toggleRole(role._uid)"
              >
                <div class="d-flex align-items-center gap-2">
                  <FaIcon :icon="expandedRoles[role._uid] ? 'chevron-down' : 'chevron-right'" class="text-muted" />
                  <strong>{{ role.name || '(unnamed)' }}</strong>
                  <span v-if="isRequiredRole(role)" class="badge bg-secondary-subtle text-muted">{{
                    t('settings.settingsPage.requiredItem')
                  }}</span>
                </div>
                <button
                  v-if="!isRequiredRole(role) && !readOnly"
                  class="btn btn-sm btn-outline-danger"
                  @click.stop="removeRole(rIdx)"
                >
                  <FaIcon icon="trash" />
                </button>
              </div>
              <div v-show="expandedRoles[role._uid]" class="px-3 pb-3">
                <BsInput
                  :isFloating="false"
                  v-model="role.name"
                  :label="t('settings.settingsPage.name')"
                  :disabled="isRequiredRole(role) || readOnly"
                />
                <label class="form-label fw-bold">{{ t('settings.settingsPage.groups') }}</label>
                <div v-for="(grp, gIdx) in role.groups" :key="grp._uid" class="d-flex align-items-center gap-2 mb-2">
                  <select
                    class="form-select provider-select"
                    v-model="grp.provider"
                    :disabled="readOnly || isPublicRole(role)"
                    @change="onProviderChange(grp, 'group')"
                  >
                    <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
                  </select>
                  <select
                    v-if="grp.provider === 'local'"
                    class="form-select"
                    v-model="grp.name"
                    :disabled="readOnly || isPublicRole(role)"
                  >
                    <option v-for="g in sortedLocalGroups" :key="g" :value="g">{{ g }}</option>
                  </select>
                  <input
                    v-else
                    class="form-control"
                    v-model="grp.name"
                    placeholder="groupname"
                    :disabled="readOnly || isPublicRole(role)"
                  />
                  <button v-if="!readOnly" class="btn btn-sm btn-outline-danger" @click="removeGroup(role, gIdx)">
                    <FaIcon icon="times" />
                  </button>
                </div>
                <div
                  v-if="!readOnly && !isPublicRole(role)"
                  :class="[role.groups.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']"
                >
                  <BsButton icon="plus" colorClass="secondary" @click="addGroup(role)">{{
                    t('settings.settingsPage.addGroup')
                  }}</BsButton>
                </div>
                <label class="form-label fw-bold">{{ t('settings.settingsPage.users') }}</label>
                <div v-for="(usr, uIdx) in role.users" :key="usr._uid" class="d-flex align-items-center gap-2 mb-2">
                  <select
                    class="form-select provider-select"
                    v-model="usr.provider"
                    :disabled="readOnly || isPublicRole(role)"
                    @change="onProviderChange(usr, 'user')"
                  >
                    <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
                  </select>
                  <select
                    v-if="usr.provider === 'local'"
                    class="form-select"
                    v-model="usr.name"
                    :disabled="readOnly || isPublicRole(role)"
                  >
                    <option v-for="u in sortedLocalUsers" :key="u" :value="u">{{ u }}</option>
                  </select>
                  <input
                    v-else
                    class="form-control"
                    v-model="usr.name"
                    placeholder="username"
                    :disabled="readOnly || isPublicRole(role)"
                  />
                  <button v-if="!readOnly" class="btn btn-sm btn-outline-danger" @click="removeUser(role, uIdx)">
                    <FaIcon icon="times" />
                  </button>
                </div>
                <div v-if="!readOnly && !isPublicRole(role)" :class="[role.users.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
                  <BsButton icon="plus" colorClass="secondary" @click="addUser(role)">{{
                    t('settings.settingsPage.addUser')
                  }}</BsButton>
                </div>
                <p v-if="isPublicRole(role)" class="text-muted small mt-1 mb-4">
                  {{ t('settings.settingsPage.publicRoleNote') }}
                </p>
                <label class="form-label fw-bold">{{ t('settings.settingsPage.options') }}</label>
                <div class="row row-cols-2 row-cols-md-3 g-0 role-options mb-3">
                  <div v-for="optKey in roleOptionKeys" :key="optKey" class="col">
                    <BsInput
                      type="checkbox"
                      :isSwitch="true"
                      v-model="role.options[optKey]"
                      :label="roleOptionLabel(optKey)"
                      :disabled="readOnly"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div class="d-flex justify-content-end mt-3">
              <BsButton icon="plus" colorClass="secondary" :disabled="readOnly" @click="addRole()">{{
                t('settings.settingsPage.addRole')
              }}</BsButton>
            </div>
          </div>
        </template>
        <template #actions>
          <BsButton
            icon="save"
            :colorClass="isRolesDirty ? 'primary' : 'secondary'"
            :disabled="!isRolesDirty || readOnly"
            @click="saveRoles()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
.provider-select {
  width: 130px;
  flex-shrink: 0;
}
.role-header {
  cursor: pointer;
  user-select: none;
  /* Rows carrying a delete button are taller than the reserved 'admin' / 'public' rows,
     which have none - measured 47px against 40px, so the list looked ragged. 47px is a
     btn-sm row (31px) plus this header's py-2 (16px); as a minimum the button still
     governs the height and the buttonless rows simply match it. */
  min-height: 47px;
}
.role-header:hover {
  background-color: var(--bs-tertiary-bg);
}
.role-options {
  margin-top: -0.5rem;
}
.role-options :deep(.mb-3) {
  margin-bottom: -0.5rem !important;
}
</style>
