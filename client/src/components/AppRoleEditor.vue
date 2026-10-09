<script setup>
/******************************************************************/
/*                                                                */
/*  One role of the forms config, in three tabs : General (its    */
/*  name and options), Users and Groups (each with the auth       */
/*  provider it comes from). Shown under an opened role of the    */
/*  roles page, and in the New role dialog. The role is edited    */
/*  in place.                                                     */
/*                                                                */
/*  @model role: the role edited ({ _uid, _required, _public,     */
/*      name, groups, users, options })                           */
/*  @emits removed: a user or a group was removed (the page saves)*/
/*  @model selected: the rows ticked in the page's tables (_uid)  */
/*  @props:                                                       */
/*      readOnly: Boolean - the config cannot be saved now        */
/*      authProviders: Array - the providers a group or a user    */
/*         may come from (local, ldap, ...)                       */
/*      localGroups: Array - the local group names, sorted        */
/*      localUsers: Array - the local user names, sorted          */
/*      optionKeys: Array - the role options, in their order      */
/*      optionLabel: Function - an option's label                 */
/*      nextUid: Function - a new _uid for a group or a user      */
/*      throughGroups: Array - the local users the role gets      */
/*         through its local groups ({ username, group })        */
/*      tab: String - the tab shown, chosen by the page (its tabs */
/*         in its title line, the role's page) : no tab strip of  */
/*         its own then                                           */
/*                                                                */
/******************************************************************/

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { requiredRoleDescription } from '@/config/roles';

const props = defineProps({
  readOnly: { type: Boolean, default: false },
  authProviders: { type: Array, default: () => [] },
  localGroups: { type: Array, default: () => [] },
  localUsers: { type: Array, default: () => [] },
  optionKeys: { type: Array, default: () => [] },
  optionLabel: { type: Function, required: true },
  nextUid: { type: Function, required: true },
  tab: { type: String, default: '' },
  throughGroups: { type: Array, default: () => [] },
});

const role = defineModel('role', { type: Object, required: true });
// a user or a group removed from the role's page (its row menu) : the page saves at once, as
// it does for one added
const emit = defineEmits(['removed']);
// the rows ticked in the role page's tables (their _uid) : its Remove from role acts on them
const selected = defineModel('selected', { type: Array, default: () => [] });

/**
 * Ticks or unticks one row.
 *
 * Args:
 *   uid (number): the row's _uid.
 */
function toggleSelected(uid) {
  selected.value = selected.value.includes(uid) ? selected.value.filter((x) => x !== uid) : [...selected.value, uid];
}

/**
 * Ticks every row of a list, or none when they all are.
 *
 * Args:
 *   list (object[]): the role's users or groups.
 */
function toggleAll(list) {
  const uids = list.map((e) => e._uid);
  const all = uids.length > 0 && uids.every((u) => selected.value.includes(u));
  selected.value = all ? [] : uids;
}

const { t } = useI18n();

// ─── tabs ─────────────────────────────────────────────────────────────────────
// the role in three tabs : General (its name and options), its users and its groups, each of
// those with its count (the public role is everyone's : no count)
const ownTab = ref('general');
// the page's tab when it chooses one, else the editor's own strip
const activeTab = computed({
  get: () => props.tab || ownTab.value,
  set: (key) => (ownTab.value = key),
});
const tabs = computed(() => [
  { key: 'general', label: t('settings.common.tabDetails') },
  {
    key: 'users',
    label: t('settings.settingsPage.users'),
    count: role.value._public ? undefined : role.value.users.length,
  },
  {
    key: 'groups',
    label: t('settings.settingsPage.groups'),
    count: role.value._public ? undefined : role.value.groups.length,
  },
]);

// ─── groups and users ─────────────────────────────────────────────────────────

/**
 * Resets a group or a user to the first local name when it moves to the local provider,
 * and empties it for any other provider (its names are typed there).
 *
 * Args:
 *   entry (object): the group or the user changed.
 *   type (string): 'group' or 'user'.
 */
function onProviderChange(entry, type) {
  entry.name = entry.provider === 'local' ? (type === 'group' ? props.localGroups[0] : props.localUsers[0]) || '' : '';
}

/**
 * Adds a group to the role, the first local group by default.
 */
function addGroup() {
  role.value.groups.push({ _uid: props.nextUid(), provider: 'local', name: props.localGroups[0] || '' });
}

/**
 * Adds a user to the role, the first local user by default.
 */
function addUser() {
  role.value.users.push({ _uid: props.nextUid(), provider: 'local', name: props.localUsers[0] || '' });
}

/**
 * Removes a group from the role.
 *
 * Args:
 *   index (number): the group's position.
 */
function removeGroup(index) {
  role.value.groups.splice(index, 1);
  emit('removed');
}

/**
 * Removes a user from the role.
 *
 * Args:
 *   index (number): the user's position.
 */
function removeUser(index) {
  role.value.users.splice(index, 1);
  emit('removed');
}
</script>

<template>
  <!-- three tabs : the role itself (its name and options), its users, its groups -->
  <ul v-if="!tab" class="nav nav-tabs af-role-tabs mb-3">
    <li v-for="tab in tabs" :key="tab.key" class="nav-item">
      <a class="nav-link" :class="{ active: activeTab === tab.key }" href="#" @click.prevent="activeTab = tab.key"
        >{{ tab.label
        }}<span v-if="tab.count !== undefined" class="badge af-role-tab-count ms-2">{{ tab.count }}</span></a
      >
    </li>
  </ul>

  <!-- General : the name and the options -->
  <template v-if="activeTab === 'general'">
    <BsInput
      class="af-role-name"
      :isFloating="false"
      v-model="role.name"
      :label="t('settings.settingsPage.name')"
      :disabled="role._required || readOnly"
    />
    <!-- admin and public : a fixed description, greyed out as their name -->
    <BsInput
      v-if="role._required"
      class="af-role-description"
      :isFloating="false"
      :modelValue="requiredRoleDescription(t, role.name)"
      :label="t('settings.fields.description')"
      :disabled="true"
    />
    <BsInput
      v-else
      class="af-role-description"
      :isFloating="false"
      v-model="role.description"
      :label="t('settings.fields.description')"
      :placeholder="t('settings.settingsPage.roleDescriptionPlaceholder')"
      :disabled="readOnly"
    />
    <label class="form-label fw-bold">{{ t('settings.settingsPage.options') }}</label>
    <div class="row row-cols-2 row-cols-md-3 g-0 role-options mb-3">
      <div v-for="optKey in optionKeys" :key="optKey" class="col">
        <BsInput
          type="checkbox"
          :isSwitch="true"
          v-model="role.options[optKey]"
          :label="optionLabel(optKey)"
          :disabled="readOnly"
        />
      </div>
    </div>
  </template>

  <!-- Users : the users of the role, each with the provider they sign in with -->
  <template v-else-if="activeTab === 'users'">
    <p v-if="role._public" class="text-muted small mb-3">{{ t('settings.settingsPage.publicEveryone') }}</p>
    <!-- on the role's page : a table of its users, those named in it and those it gets through a
         group (read only, From says which), as the app's other lists -->
    <template v-else-if="tab">
      <p v-if="role.users.length === 0 && !throughGroups.length" class="text-muted small mb-0">
        {{ t('settings.settingsPage.roleNoUsers') }}
      </p>
      <div v-else class="af-table-frame">
        <table class="table af-table af-role-members">
          <thead>
            <tr>
              <th class="text-center bs-dt-select">
                <input
                  type="checkbox"
                  class="form-check-input"
                  :disabled="readOnly || !role.users.length"
                  :checked="role.users.length > 0 && role.users.every((u) => selected.includes(u._uid))"
                  @change="toggleAll(role.users)"
                />
              </th>
              <th>{{ t('settings.settingsPage.name') }}</th>
              <th>{{ t('settings.settingsPage.provider') }}</th>
              <th>{{ t('settings.settingsPage.roleMemberFrom') }}</th>
              <th class="af-role-remove-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(usr, uIdx) in role.users"
              :key="usr._uid"
              :class="{ 'bs-dt-selected': selected.includes(usr._uid) }"
            >
              <td class="text-center bs-dt-select">
                <input
                  type="checkbox"
                  class="form-check-input"
                  :disabled="readOnly"
                  :checked="selected.includes(usr._uid)"
                  @change="toggleSelected(usr._uid)"
                />
              </td>
              <td>{{ usr.name }}</td>
              <td>{{ usr.provider }}</td>
              <!-- named in the role itself : no group -->
              <td class="text-muted">–</td>
              <td class="bs-dt-row-actions">
                <!-- its menu, as the rows of the other tables -->
                <div v-if="!readOnly" class="dropdown">
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
                      <a class="dropdown-item text-danger" href="#" @click.prevent="removeUser(uIdx)">
                        <FaIcon icon="trash" class="me-2" />{{ t('settings.settingsPage.removeFromRole') }}
                      </a>
                    </li>
                  </ul>
                </div>
              </td>
            </tr>
            <tr v-for="m in throughGroups" :key="'g/' + m.username + '/' + m.group">
              <!-- through a group : changed on the group, not here -->
              <td class="text-center bs-dt-select"><input type="checkbox" class="form-check-input" disabled /></td>
              <td>{{ m.username }}</td>
              <td>local</td>
              <td>{{ m.group }}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p v-else-if="!tab && role.users.length === 0" class="text-muted small mb-3">
      {{ t('settings.settingsPage.roleNoUsers') }}
    </p>
    <div v-for="(usr, uIdx) in tab ? [] : role.users" :key="usr._uid" class="d-flex align-items-center gap-2 mb-2">
      <select
        class="form-select provider-select"
        v-model="usr.provider"
        :disabled="readOnly || role._public"
        @change="onProviderChange(usr, 'user')"
      >
        <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
      </select>
      <select
        v-if="usr.provider === 'local'"
        class="form-select"
        v-model="usr.name"
        :disabled="readOnly || role._public"
      >
        <option v-for="u in localUsers" :key="u" :value="u">{{ u }}</option>
      </select>
      <input
        v-else
        class="form-control"
        v-model="usr.name"
        placeholder="username"
        :disabled="readOnly || role._public"
      />
      <button v-if="!readOnly" class="btn btn-outline-danger align-self-stretch af-remove" @click="removeUser(uIdx)">
        <FaIcon icon="times" />
      </button>
    </div>
    <!-- the page has its own Add user (top right) : the dialog keeps this one -->
    <div v-if="!tab && !readOnly && !role._public" :class="[role.users.length > 0 ? 'mt-3' : 'mt-1', 'mb-3']">
      <BsButton icon="plus" @click="addUser()">{{ t('settings.settingsPage.addUser') }}</BsButton>
    </div>
  </template>

  <!-- Groups : the groups of the role, each with the provider it comes from -->
  <template v-else>
    <p v-if="role._public" class="text-muted small mb-3">{{ t('settings.settingsPage.publicEveryone') }}</p>
    <!-- on the role's page : a table of its groups, as the users' -->
    <template v-else-if="tab">
      <p v-if="role.groups.length === 0" class="text-muted small mb-0">{{ t('settings.settingsPage.roleNoGroups') }}</p>
      <div v-else class="af-table-frame">
        <table class="table af-table af-role-members">
          <thead>
            <tr>
              <th class="text-center bs-dt-select">
                <input
                  type="checkbox"
                  class="form-check-input"
                  :disabled="readOnly || !role.groups.length"
                  :checked="role.groups.length > 0 && role.groups.every((g) => selected.includes(g._uid))"
                  @change="toggleAll(role.groups)"
                />
              </th>
              <th>{{ t('settings.settingsPage.name') }}</th>
              <th>{{ t('settings.settingsPage.provider') }}</th>
              <th class="af-role-remove-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(grp, gIdx) in role.groups"
              :key="grp._uid"
              :class="{ 'bs-dt-selected': selected.includes(grp._uid) }"
            >
              <td class="text-center bs-dt-select">
                <input
                  type="checkbox"
                  class="form-check-input"
                  :disabled="readOnly"
                  :checked="selected.includes(grp._uid)"
                  @change="toggleSelected(grp._uid)"
                />
              </td>
              <td>{{ grp.name }}</td>
              <td>{{ grp.provider }}</td>
              <td class="bs-dt-row-actions">
                <!-- its menu, as the rows of the other tables -->
                <div v-if="!readOnly" class="dropdown">
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
                      <a class="dropdown-item text-danger" href="#" @click.prevent="removeGroup(gIdx)">
                        <FaIcon icon="trash" class="me-2" />{{ t('settings.settingsPage.removeFromRole') }}
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
    <p v-else-if="!tab && role.groups.length === 0" class="text-muted small mb-3">
      {{ t('settings.settingsPage.roleNoGroups') }}
    </p>
    <div v-for="(grp, gIdx) in tab ? [] : role.groups" :key="grp._uid" class="d-flex align-items-center gap-2 mb-2">
      <select
        class="form-select provider-select"
        v-model="grp.provider"
        :disabled="readOnly || role._public"
        @change="onProviderChange(grp, 'group')"
      >
        <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
      </select>
      <select
        v-if="grp.provider === 'local'"
        class="form-select"
        v-model="grp.name"
        :disabled="readOnly || role._public"
      >
        <option v-for="g in localGroups" :key="g" :value="g">{{ g }}</option>
      </select>
      <input
        v-else
        class="form-control"
        v-model="grp.name"
        placeholder="groupname"
        :disabled="readOnly || role._public"
      />
      <button v-if="!readOnly" class="btn btn-outline-danger align-self-stretch af-remove" @click="removeGroup(gIdx)">
        <FaIcon icon="times" />
      </button>
    </div>
    <div v-if="!tab && !readOnly && !role._public" :class="[role.groups.length > 0 ? 'mt-3' : 'mt-1', 'mb-3']">
      <BsButton icon="plus" @click="addGroup()">{{ t('settings.settingsPage.addGroup') }}</BsButton>
    </div>
  </template>
</template>

<style scoped>
/* the wide fields' width of the settings pages (AppEnvField, a path or a command) : the name and
   its description alike, room for a sentence */
.af-role-name :deep(input),
.af-role-description :deep(input) {
  max-width: 40rem;
}
.af-role-remove-col {
  width: 3.5rem;
}
.af-role-tabs .nav-link {
  cursor: pointer;
}
/* the count of a tab : small and grey, as the menus' badges */
.af-role-tab-count {
  background: var(--bs-secondary-bg);
  color: var(--bs-secondary-color);
  font-weight: 600;
}
.provider-select {
  width: 130px;
  flex-shrink: 0;
}
/* the remove button of a group or a user : as tall as the dropdowns beside it, and square */
.af-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.75rem;
}
.role-options {
  margin-top: -0.5rem;
  /* the switches take back their own margin : this gives the tab its room at the bottom */
  padding-bottom: 0.75rem;
}
.role-options :deep(.mb-3) {
  margin-bottom: -0.5rem !important;
}
</style>
