<script setup>
/******************************************************************/
/*                                                                */
/*  One role of the forms config : its name, its groups and       */
/*  users (each with its auth provider) and its options. Shown    */
/*  under an opened role of the roles page, and in the New role   */
/*  dialog. The role is edited in place.                          */
/*                                                                */
/*  @model role: the role edited ({ _uid, _required, _public,     */
/*      name, groups, users, options })                           */
/*  @props:                                                       */
/*      readOnly: Boolean - the config cannot be saved now        */
/*      authProviders: Array - the providers a group or a user    */
/*         may come from (local, ldap, ...)                       */
/*      localGroups: Array - the local group names, sorted        */
/*      localUsers: Array - the local user names, sorted          */
/*      optionKeys: Array - the role options, in their order      */
/*      optionLabel: Function - an option's label                 */
/*      nextUid: Function - a new _uid for a group or a user      */
/*                                                                */
/******************************************************************/

import { useI18n } from 'vue-i18n';

const props = defineProps({
  readOnly: { type: Boolean, default: false },
  authProviders: { type: Array, default: () => [] },
  localGroups: { type: Array, default: () => [] },
  localUsers: { type: Array, default: () => [] },
  optionKeys: { type: Array, default: () => [] },
  optionLabel: { type: Function, required: true },
  nextUid: { type: Function, required: true },
});

const role = defineModel('role', { type: Object, required: true });

const { t } = useI18n();

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
}

/**
 * Removes a user from the role.
 *
 * Args:
 *   index (number): the user's position.
 */
function removeUser(index) {
  role.value.users.splice(index, 1);
}
</script>

<template>
  <BsInput
    :isFloating="false"
    v-model="role.name"
    :label="t('settings.settingsPage.name')"
    :disabled="role._required || readOnly"
  />
  <label class="form-label fw-bold d-block">{{ t('settings.settingsPage.groups') }}</label>
  <div v-for="(grp, gIdx) in role.groups" :key="grp._uid" class="d-flex align-items-center gap-2 mb-2">
    <select
      class="form-select provider-select"
      v-model="grp.provider"
      :disabled="readOnly || role._public"
      @change="onProviderChange(grp, 'group')"
    >
      <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
    </select>
    <select v-if="grp.provider === 'local'" class="form-select" v-model="grp.name" :disabled="readOnly || role._public">
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
  <div v-if="!readOnly && !role._public" :class="[role.groups.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
    <BsButton icon="plus" @click="addGroup()">{{ t('settings.settingsPage.addGroup') }}</BsButton>
  </div>
  <!-- the public role : no groups or users of its own, it is everyone's -->
  <p v-if="role._public" class="text-muted small mb-4">{{ t('settings.settingsPage.publicEveryone') }}</p>
  <label class="form-label fw-bold d-block">{{ t('settings.settingsPage.users') }}</label>
  <div v-for="(usr, uIdx) in role.users" :key="usr._uid" class="d-flex align-items-center gap-2 mb-2">
    <select
      class="form-select provider-select"
      v-model="usr.provider"
      :disabled="readOnly || role._public"
      @change="onProviderChange(usr, 'user')"
    >
      <option v-for="p in authProviders" :key="p" :value="p">{{ p }}</option>
    </select>
    <select v-if="usr.provider === 'local'" class="form-select" v-model="usr.name" :disabled="readOnly || role._public">
      <option v-for="u in localUsers" :key="u" :value="u">{{ u }}</option>
    </select>
    <input v-else class="form-control" v-model="usr.name" placeholder="username" :disabled="readOnly || role._public" />
    <button v-if="!readOnly" class="btn btn-outline-danger align-self-stretch af-remove" @click="removeUser(uIdx)">
      <FaIcon icon="times" />
    </button>
  </div>
  <div v-if="!readOnly && !role._public" :class="[role.users.length > 0 ? 'mt-3' : 'mt-1', 'mb-4']">
    <BsButton icon="plus" @click="addUser()">{{ t('settings.settingsPage.addUser') }}</BsButton>
  </div>
  <!-- the public role : no groups or users of its own, it is everyone's -->
  <p v-if="role._public" class="text-muted small mb-4">{{ t('settings.settingsPage.publicEveryone') }}</p>
  <p v-if="role._public" class="text-muted small mt-1 mb-4">
    {{ t('settings.settingsPage.publicRoleNote') }}
  </p>
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

<style scoped>
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
}
.role-options :deep(.mb-3) {
  margin-bottom: -0.5rem !important;
}
</style>
