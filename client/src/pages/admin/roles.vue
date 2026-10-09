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

// ─── the New role dialog ──────────────────────────────────────────────────────
// A new role is filled in a dialog, not as an empty row at the end of the list : it joins the
// list, and the config is saved, only when the dialog is saved.
const newRole = ref(null);

/**
 * Opens the New role dialog on an empty role.
 */
function addRole() {
  newRole.value = {
    _uid: nextUid(),
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
}

/**
 * Adds the role of the dialog to the list and saves the config. The dialog stays open, and
 * the role leaves the list again, when the save is refused (a name taken, the config locked).
 */
async function createRole() {
  const role = newRole.value;
  roles.value.push(role);
  if (await saveRoles()) {
    newRole.value = null;
  } else {
    const index = roles.value.indexOf(role);
    if (index >= 0) roles.value.splice(index, 1);
  }
}

function removeRole(index) {
  roles.value.splice(index, 1);
}

function toggleRole(uid) {
  expandedRoles.value[uid] = !expandedRoles.value[uid];
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
    return false;
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
  if (!saved) return false;
  stampRoleFlags();
  expandedRoles.value = Object.fromEntries(
    roles.value.filter((r) => expandedNames.has(r.name)).map((r) => [r._uid, true]),
  );
  return true;
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([load(), loadLocalGroups(), loadLocalUsers()]);
  stampRoleFlags();
});
</script>
<template>
  <BsModal v-if="newRole" size="lg" @close="newRole = null">
    <template #title> <FaIcon icon="user-shield" class="me-2" />{{ t('settings.settingsPage.newRole') }} </template>
    <template #default>
      <AppRoleEditor
        v-model:role="newRole"
        :authProviders="authProviders"
        :localGroups="sortedLocalGroups"
        :localUsers="sortedLocalUsers"
        :optionKeys="roleOptionKeys"
        :optionLabel="roleOptionLabel"
        :nextUid="nextUid"
      />
    </template>
    <template #footer>
      <BsButton icon="save" @click="createRole()">{{ t('settings.common.save') }}</BsButton>
    </template>
  </BsModal>
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
                <AppRoleEditor
                  v-model:role="roles[rIdx]"
                  :readOnly="readOnly"
                  :authProviders="authProviders"
                  :localGroups="sortedLocalGroups"
                  :localUsers="sortedLocalUsers"
                  :optionKeys="roleOptionKeys"
                  :optionLabel="roleOptionLabel"
                  :nextUid="nextUid"
                />
              </div>
            </div>
          </div>
        </template>
        <template #actions>
          <BsButton icon="plus" :disabled="readOnly" @click="addRole()">{{
            t('settings.settingsPage.addRole')
          }}</BsButton>
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
</style>
