// Shared role helpers used by the settings roles page (via useFormsConfig) and
// the designer's role add/edit modals. Keep these pure so both can import the
// same lists/logic instead of duplicating them.

export const authProviders = ['local', 'ldap', 'azuread', 'oidc'];

export const roleOptionKeys = [
  'showDesigner',
  'showLogs',
  'showDebugButtons',
  'showSettings',
  'showExtravars',
  'showAllJobLogs',
  'showArtifacts',
  'showJobs',
  'allowLogin',
  'allowBackupOps',
  'allowVerboseMode',
  'allowJobRelaunch',
  'allowScheduledJobs',
  'allowStoredJobs',
  'allowPlannedJobs',
  'allowChat',
  'allowMcp',
  'extendedTokenExpiration',
];

// Options whose effective value is `true` when the key is absent from the yaml.
// Mirrors the fallbacks in server/src/models/user.model.js (getRolesAndOptions),
// plus `allowLogin` which is not defaulted there but is only ever tested as
// `=== false` in login.controller.js : an absent allowLogin allows login.
// The server also defaults `showExtraVars` (capital V) to true ; that casing
// variant is not exposed by this editor, so it is not listed here (unknown keys
// found in hand-written yaml are preserved verbatim by serializeRole).
const trueByDefaultOptions = [
  'allowVerboseMode',
  'showJobs',
  'showDebugButtons',
  'showExtravars',
  'showArtifacts',
  'allowStoredJobs',
  'allowPlannedJobs',
  'allowLogin',
  'allowChat',
  'allowMcp',
];

// Options whose effective value defaults to the "is this an admin" check.
const adminByDefaultOptions = [
  'showSettings',
  'showDesigner',
  'showLogs',
  'allowBackupOps',
  'allowJobRelaunch',
  'showAllJobLogs',
  'allowScheduledJobs',
];

// Effective value of every option for a role that does not spell it out.
// LIMITATION : the server evaluates `isAdmin` over ALL roles of the logged-in
// user, not over the single role being edited, so judging it per role is an
// approximation. A user who also holds the 'admin' role gets the admin
// defaults on all of his roles, which this per-role view cannot express.
// Mind too that the server ANDs an option across all the roles a user matches,
// so an explicit false in one role wins over a default in another.
export function roleOptionDefaults(roleName) {
  const isAdmin = roleName === 'admin';
  const defaults = {};
  for (const key of roleOptionKeys) defaults[key] = false;
  for (const key of trueByDefaultOptions) defaults[key] = true;
  for (const key of adminByDefaultOptions) defaults[key] = isAdmin;
  return defaults;
}

// Translated label of a role option. The keys all follow the
// settings.settingsPage.roleOption<Key> convention, so derive the i18n key from
// the option name instead of maintaining a second map per editor.
export function roleOptionLabel(t, key) {
  return t('settings.settingsPage.roleOption' + key.charAt(0).toUpperCase() + key.slice(1));
}

// Split a provider-prefixed entry ("local/admins") into { provider, name }.
// Missing prefix defaults to the 'local' provider.
export function parseProviderEntry(str) {
  // hand-edited YAML can hold non-string entries (numbers, maps) : stringify
  // defensively instead of throwing and killing the whole editor
  const s = typeof str === 'string' ? str : String(str ?? '');
  const idx = s.indexOf('/');
  if (idx === -1) return { provider: 'local', name: s };
  return { provider: s.substring(0, idx), name: s.substring(idx + 1) };
}

export function formatProviderEntry(entry) {
  return `${entry.provider}/${entry.name}`;
}

// Map a stored role (schema shape) to the editable shape both editors use
// ({provider,name} member objects, all option flags materialized). Absent
// options are materialized with their EFFECTIVE value (the default the server
// would apply), not with false : showing them as off would misreport the live
// permissions of the role.
export function roleToEditable(r) {
  const defaults = roleOptionDefaults(r.name);
  const options = { ...defaults };
  for (const [k, v] of Object.entries(r.options || {})) {
    // Known flags are normalized to real booleans so the switches and the
    // serializer can't disagree on a hand-written non-boolean (yaml 1.2 parses
    // `showJobs: yes` as the string "yes", which the server reads as truthy but
    // a checkbox renders as off). Unknown flags are kept verbatim.
    options[k] = roleOptionKeys.includes(k) ? !!v : v;
  }
  // allowMcp absent : the server gives it the role's allowChat (user.model.js), so it shows that
  if (!r.options || r.options.allowMcp === undefined) options.allowMcp = options.allowChat;
  return {
    name: r.name || '',
    groups: (r.groups || []).map(parseProviderEntry),
    users: (r.users || []).map(parseProviderEntry),
    options,
    // Remembered so serializeRole can tell a flag the admin actually has an
    // opinion about from one that merely shows its default. See serializeRole.
    _explicitOptions: Object.keys(r.options || {}),
  };
}

// Serialize an edited role back to the schema shape:
//  - groups is always present (empty array allowed),
//  - users only when non-empty,
//  - options only carries the flags this role has an opinion about,
//  - the public role never carries groups/users (the schema pins it),
//  - the role name is trimmed, like the member names : a stray space is
//    invisible in the editor but the server matches role names literally
//    (`roles: [operators]` in a form, `roles.includes("admin")` in
//    middleware.js), so ' operators ' would silently stop applying anywhere,
//  - member names are trimmed ; empty/never-filled rows are dropped.
//
// A flag is written when, and only when, it was already spelled out in the yaml
// or the user actually moved the switch away from the default shown to him.
// Both halves of that rule matter:
//  - writing a switched-off flag is what makes the round trip lossless, since
//    the server reads an absent option as "apply the default" and most defaults
//    are true, so an omitted flag would come back on ;
//  - NOT writing an untouched flag is what keeps roles composable. The server
//    ANDs each option across every role a user matches
//    (server/src/models/user.model.js, getRolesAndOptions), so an explicit
//    false beats another role's default. Materializing untouched defaults as
//    explicit false would turn "no opinion" into "deny" and, for a user holding
//    several roles, silently strip permissions granted by another role -- an
//    admin who also matches a plain role would lose settings access.
// Flags we don't know about (hand-written yaml, the showExtraVars casing variant) are
// passed through untouched.
export function serializeRole(r) {
  const name = (r.name || '').trim();
  const isPublic = name === 'public';
  const role = { name };
  const clean = (list) =>
    (list || [])
      .filter((e) => e && typeof e.name === 'string' && e.name.trim())
      .map((e) => formatProviderEntry({ provider: e.provider, name: e.name.trim() }));
  role.groups = isPublic ? [] : clean(r.groups);
  const users = isPublic ? [] : clean(r.users);
  if (users.length) role.users = users;
  // The baseline MUST be derived from the role's CURRENT name, never from a copy
  // taken when it was loaded : roleOptionDefaults branches on `admin`, so a role
  // renamed across that boundary would be compared against the wrong defaults.
  // Renaming a plain role to `admin` then omitted every admin-gated flag, and the
  // server derives isAdmin from the name -- granting full admin while the editor
  // showed those switches off. Comparing against the current name writes the
  // explicit values needed to preserve exactly what the user saw. The trimmed
  // name is the one being written, so it is the one to branch on.
  const defaults = roleOptionDefaults(name);
  // allowMcp left out is read as the role's allowChat : it is written whenever it differs
  defaults.allowMcp = r.options?.allowChat === undefined ? defaults.allowChat : !!r.options.allowChat;
  const explicit = r._explicitOptions || [];
  const options = {};
  for (const k of roleOptionKeys) {
    const value = !!r.options?.[k];
    if (explicit.includes(k) || value !== defaults[k]) options[k] = value;
  }
  for (const [k, v] of Object.entries(r.options || {})) {
    if (!roleOptionKeys.includes(k)) options[k] = v;
  }
  if (Object.keys(options).length > 0) role.options = options;
  return role;
}
