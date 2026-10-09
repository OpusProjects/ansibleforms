/******************************************************************/
/*                                                                */
/*  useRoleSupport : what the roles list and a role's page share  */
/*                                                                */
/*  The local groups and users a role can name, the flags stamped */
/*  on the roles as loaded, the checks a save must pass, and the  */
/*  save itself (useFormsConfig's, with those checks before it).  */
/*                                                                */
/******************************************************************/
import { ref, computed } from 'vue';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import TokenStorage from '@/lib/TokenStorage';

// the roles the config must keep : admin and public
export const RESERVED_ROLES = ['admin', 'public'];

/**
 * The roles' shared support, around the roles of useFormsConfig.
 *
 * Args:
 *   roles (Ref<object[]>): the roles being edited (useFormsConfig's roles).
 *   save (Function): useFormsConfig's save (successLabel) => Promise<boolean>.
 *
 * Returns:
 *   object: { sortedLocalGroups, sortedLocalUsers, loadLocalNames, usersThroughGroups,
 *     stampRoleFlags, validateRoles, saveRoles }.
 */
export function useRoleSupport(roles, save) {
  const { t } = useI18n();
  const localGroups = ref([]);
  const localUsers = ref([]);
  // the local users with their groups (its first one and the others), for the users a role
  // gets through its groups
  const localMembers = ref([]);
  // the local groups' ids and names, to name a member's group
  const groupIds = ref([]);

  // ─── the local groups and users a role can name ──────────────────────────────
  const sortedLocalGroups = computed(() => [...localGroups.value].sort());
  const sortedLocalUsers = computed(() => [...localUsers.value].sort());

  /**
   * Loads the local groups' and users' names ; an error leaves the list empty.
   *
   * Returns:
   *   Promise<void>: when both are loaded.
   */
  async function loadLocalNames() {
    await Promise.all([
      axios
        .get('/api/v2/group/', TokenStorage.getAuthentication())
        .then((result) => {
          const records = result.data.records || result.data;
          localGroups.value = records.map((g) => g.name);
          groupIds.value = records.map((g) => [g.id, g.name]);
        })
        .catch(() => (localGroups.value = groupIds.value = [])),
      axios
        .get('/api/v2/user/', TokenStorage.getAuthentication())
        .then((result) => {
          const records = result.data.records || result.data;
          localUsers.value = records.map((u) => u.username);
          localMembers.value = records.map((u) => ({ username: u.username, groupIds: u.group_ids || [u.group_id] }));
        })
        .catch(() => (localUsers.value = [])),
    ]);
  }

  /**
   * The local users a role gets through its local groups : each with the group they come from.
   * A user of another provider's group (LDAP, SSO) is only known when they sign in : not listed.
   *
   * Args:
   *   role (object): the role.
   *
   * Returns:
   *   object[]: { username, group }, sorted by username.
   */
  function usersThroughGroups(role) {
    if (!role || role._public) return [];
    const names = new Set(role.groups.filter((g) => g.provider === 'local').map((g) => g.name));
    const nameOf = new Map(groupIds.value);
    // a user in several of the role's groups : once, its groups together
    return localMembers.value
      .map((m) => ({
        username: m.username,
        group: m.groupIds
          .map((id) => nameOf.get(id))
          .filter((n) => names.has(n))
          .join(', '),
      }))
      .filter((m) => m.group)
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  // ─── the flags stamped as loaded ─────────────────────────────────────────────
  /**
   * Stamps each role's flags from its name as loaded. Must run after every load and every
   * successful save. _required / _public are read off these, never off the name being typed :
   * a live check disabled the name input the instant a custom name passed through 'admin' or
   * 'public', which trapped the value there. They are internal : serializeRole rebuilds the
   * role from known keys, so they never reach the yaml.
   */
  function stampRoleFlags() {
    for (const role of roles.value) {
      role._required = RESERVED_ROLES.includes(role.name);
      role._public = role.name === 'public';
      // the name the list is sorted on : the one loaded, so a role does not move while renamed
      role._sortName = role.name || '';
    }
  }

  // ─── the checks a save must pass ─────────────────────────────────────────────
  /**
   * The first reason the roles cannot be saved, or null. The schema only requires `name` to be
   * a string, so an empty, duplicated or reserved name is refused here. Only 'admin' is
   * protected : the server treats the role NAME as a privilege bypass (roles.includes("admin")
   * in middleware.js and job.model.js). 'public' is not, so a config that lost its public role
   * can be repaired.
   *
   * Returns:
   *   string|null: the message, or null when the roles can be saved.
   */
  function validateRoles() {
    const seen = new Set();
    for (const role of roles.value) {
      const name = (role.name || '').trim();
      if (!name) return t('settings.settingsPage.roleNameRequired');
      if (seen.has(name)) return t('settings.settingsPage.duplicateRoleName', { name });
      seen.add(name);
      if (!role._required && name === 'admin') {
        return t('settings.settingsPage.reservedRoleName', { name });
      }
      // a user or a group listed twice in a role : the same entry, written twice
      for (const kind of ['users', 'groups']) {
        const entries = new Set();
        for (const entry of role[kind] || []) {
          const key = `${entry.provider}/${(entry.name || '').trim()}`;
          if (entries.has(key)) return t('settings.settingsPage.duplicateRoleMember', { name: key, role: name });
          entries.add(key);
        }
      }
    }
    return null;
  }

  /**
   * Checks the roles and saves the forms config.
   *
   * Returns:
   *   Promise<boolean>: whether the roles were saved.
   */
  async function saveRoles() {
    const problem = validateRoles();
    if (problem) {
      toast.warning(problem);
      return false;
    }
    // ONLY on success : re-stamping after a failed save (423 while the designer holds the lock,
    // or a 409) disabled the name field of the role just renamed, with no way back
    if (!(await save(t('settings.settingsPage.roles')))) return false;
    stampRoleFlags();
    return true;
  }

  return {
    sortedLocalGroups,
    sortedLocalUsers,
    loadLocalNames,
    usersThroughGroups,
    stampRoleFlags,
    validateRoles,
    saveRoles,
  };
}
