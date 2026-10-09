<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Profile from '@/lib/Profile';
import { useI18n } from 'vue-i18n';
import { useFormsConfig } from '@/composables/useFormsConfig';
import { useUnsavedGuard } from '@/composables/useUnsavedGuard';
import { useRoleSupport } from '@/composables/useRoleSupport';
import { requiredRoleDescription } from '@/config/roles';
import { toast } from 'vue-sonner';
import BsDataTable from '@/components/BsDataTable.vue';

const { t } = useI18n();
const router = useRouter();
const authenticated = ref(false);

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
const { sortedLocalGroups, sortedLocalUsers, loadLocalNames, stampRoleFlags, saveRoles } = useRoleSupport(roles, save);

// a role removed here is only gone once saved : leaving with it unsaved asks first
useUnsavedGuard(isRolesDirty, () => t('settings.common.unsavedChanges'));

// Read-only when the config can't be loaded, can't be parsed or is a ytt template.
const readOnly = computed(() => parseError.value || isTemplated.value || !!loadError.value);

/**
 * Opens a role's page (/admin/roles/<name>) : its General, Users and Groups tabs.
 *
 * Args:
 *   role (object): the role clicked.
 */
function openRole(role) {
  router.push(`/admin/roles/${encodeURIComponent(role._sortName || role.name)}`);
}

/**
 * Opens the role of a row (the table gives the row, not the role).
 *
 * Args:
 *   item (object): the row.
 */
function openRow(item) {
  const role = roles.value.find((r) => r._uid === item.id);
  if (role) openRole(role);
}

// the roles in alphabetical order, each with its position in the config (which keeps its own
// order : the list is sorted, the file is not)
const sortedRoles = computed(() =>
  roles.value
    .map((role, rIdx) => ({ role, rIdx }))
    .sort((a, b) => (a.role._sortName ?? '').localeCompare(b.role._sortName ?? '', undefined, { sensitivity: 'base' })),
);

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

// ─── the table ────────────────────────────────────────────────────────────────
// the app's data table, as the other lists : a checkbox per role, Select all and Delete for the
// selection, the search and the columns on the title line, a row's menu ; a row opens its role
const toolsId = `af-tools-${Math.random().toString(36).slice(2, 10)}`;
const selectedIds = ref(new Set());
const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const tableItems = computed(() =>
  sortedRoles.value.map(({ role }) => ({
    id: role._uid,
    name: role.name,
    // admin and public : their fixed description
    description: role._required ? requiredRoleDescription(t, role.name) : role.description || '',
    required: role._required,
  })),
);
const columns = computed(() => [
  {
    key: 'name',
    // a share of the width, so it follows the screen : the description gets the rest
    width: '30%',
    label: t('settings.settingsPage.name'),
    sortable: true,
    filterable: true,
    // admin and public : the config must keep them, said beside their name
    render: (v, row) =>
      escapeHtml(v) +
      (row.required
        ? ` <span class="badge af-required-badge ms-2">${escapeHtml(t('settings.settingsPage.requiredItem'))}</span>`
        : ''),
  },
  // what the role is for ; an en dash when it says nothing
  {
    key: 'description',
    label: t('settings.fields.description'),
    sortable: true,
    filterable: true,
    render: (v) => (v ? escapeHtml(v) : '–'),
  },
]);

/**
 * Removes roles and saves at once ; refused (the config locked), they come back.
 *
 * Args:
 *   uids (number[]): the roles' _uid.
 */
async function deleteRoles(uids) {
  const removed = roles.value.filter((r) => uids.includes(r._uid));
  roles.value = roles.value.filter((r) => !uids.includes(r._uid));
  if (await saveRoles()) {
    selectedIds.value = new Set();
  } else {
    roles.value = [...roles.value, ...removed];
  }
}

/**
 * Deletes the roles selected, after asking ; admin and public are left alone.
 */
async function bulkDelete() {
  const present = new Map(tableItems.value.map((r) => [r.id, r]));
  const chosen = [...selectedIds.value].filter((id) => present.has(id));
  const ids = chosen.filter((id) => !present.get(id).required);
  const skipped = chosen.length - ids.length;
  if (!ids.length) {
    if (skipped) toast.warning(t('settings.common.bulkDeleteNone'));
    return;
  }
  const question = skipped
    ? t('settings.common.bulkDeleteConfirmSkip', { count: ids.length, skipped })
    : t('settings.common.bulkDeleteConfirm', { count: ids.length });
  if (!confirm(question)) return;
  await deleteRoles(ids);
}

/**
 * Deletes one role from its row's menu, after asking.
 *
 * Args:
 *   item (object): the row.
 */
async function deleteOne(item) {
  if (item.required) return;
  if (!confirm(`${t('settings.common.deleteConfirm')} ${item.name}?`)) return;
  await deleteRoles([item.id]);
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await Promise.all([load(), loadLocalNames()]);
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
        <!-- the table's search and columns, on the title line as the other lists have them -->
        <template #headerActions>
          <div :id="toolsId" class="af-title-flow"></div>
        </template>
        <template #default>
          <div>
            <div v-if="loadError" class="alert alert-danger" role="alert">
              {{ t('settings.common.failedToLoad') }} : {{ loadError }}
            </div>
            <div v-if="roles.length === 0" class="empty-state">
              <FaIcon icon="user-shield" class="empty-state-icon" />
              <span>{{ t('settings.settingsPage.noRoles') }}</span>
            </div>
            <!-- the app's data table : checkboxes, Select all, Delete, search and columns on the
                 title line ; a row opens its role's page -->
            <BsDataTable
              v-else
              framed
              :toolbarTo="'#' + toolsId"
              :items="tableItems"
              :columns="columns"
              idKey="id"
              :selectedIds="selectedIds"
              :selectable="!readOnly"
              :rowSelectable="(row) => !row.required"
              :rowClickSelects="false"
              :name="t('settings.settingsPage.roles')"
              :exportName="t('settings.settingsPage.roles')"
              @update:selectedIds="selectedIds = $event"
              @row-click="openRow"
            >
              <template v-if="!readOnly" #bulk-actions="{ count }">
                <BsButton v-if="count" icon="trash" @click="bulkDelete">
                  {{ t('common.delete') }} ({{ count }})
                </BsButton>
              </template>
              <template #row-actions="{ item }">
                <div class="dropdown">
                  <a
                    role="button"
                    class="bs-dt-row-menu px-2"
                    data-bs-toggle="dropdown"
                    data-bs-popper-config='{"strategy":"fixed"}'
                    @click.stop
                  >
                    <font-awesome-icon icon="ellipsis-vertical" />
                  </a>
                  <ul class="dropdown-menu dropdown-menu-end">
                    <li>
                      <a class="dropdown-item" href="#" @click.prevent="openRow(item)">
                        <font-awesome-icon icon="pencil" class="me-2" />{{ t('settings.settingsPage.editRole') }}
                      </a>
                    </li>
                    <li><hr class="dropdown-divider" /></li>
                    <li>
                      <a
                        class="dropdown-item"
                        :class="item.required || readOnly ? 'disabled text-muted' : 'text-danger'"
                        href="#"
                        @click.prevent="deleteOne(item)"
                      >
                        <font-awesome-icon icon="trash" class="me-2" />{{ t('common.delete') }}
                      </a>
                    </li>
                  </ul>
                </div>
              </template>
            </BsDataTable>
          </div>
        </template>
        <template #actions>
          <BsButton icon="plus" :disabled="readOnly" @click="addRole()">{{
            t('settings.settingsPage.addRole')
          }}</BsButton>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
