import yaml from 'yaml';
import crypto from 'crypto';
import Audit from '../models/audit.model.js';
import logger from './logger.js';

// Semantic auditing for config.yaml writes.
//
// The generic audit middleware already records THAT someone saved the config and
// whether it worked. It cannot record WHAT changed, because only this layer sees the
// old and the new document. That gap matters most for roles : a privilege escalation
// shipped here once where renaming a role to `admin` silently granted full admin
// while the editor showed the switches off. An option delta is what makes that kind
// of change visible after the fact.

// Compare the option maps of one role. An option that is ABSENT in one side and
// explicit in the other is a real change, not a no-op : most options default to true
// (a few to isAdmin) and the server ANDs them across every role a user matches, so
// `undefined -> false` genuinely removes a permission. See the role option notes in
// CLAUDE.md before changing this.
function diffOptions(before, after) {
  const out = {};
  // `options` is meant to be a map. A string would otherwise diff per CHARACTER
  // ({"0":{"from":"a"}...}), so anything that is not a plain object is treated as absent
  const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  before = asMap(before);
  after = asMap(after);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    // both spellings of showExtravars/showExtraVars are legitimate and both are
    // reported : normalising one away here would hide a real edit
    if (from !== to) out[key] = { from, to };
  }
  return out;
}

// Membership is the other half of "what may this role do" : swapping a group grants
// the role to a different set of people without touching a single option. Names are
// recorded (they are short and they are the point), capped so one enormous role
// cannot dominate the entry.
const MAX_MEMBERS = 25;
function memberList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter((v) => typeof v === 'string')
    .sort();
}
function diffMembers(before, after) {
  const a = memberList(before);
  const b = memberList(after);
  // JSON.stringify rather than join(sep) : no separator can collide with a name,
  // and an accidental control character in a separator turns this whole file into
  // something grep classifies as binary and silently skips (see tests/api-surface.test.mjs)
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  return { from: a.slice(0, MAX_MEMBERS), to: b.slice(0, MAX_MEMBERS) };
}

// Keyed by name, which is how the roles editor, the server's role matching and this
// diff all think about roles - but the LIST can legitimately contain the same name
// twice, and that is a privilege escalation (getRolesAndOptions applies every entry,
// so a second `- name: admin` grants admin to its groups). Form.validateConfig now
// rejects that, but this diff must not go quietly blind if one ever gets in by another
// route: duplicates are collected and reported instead of the last one winning.
function rolesByName(list) {
  const map = new Map();
  const duplicates = new Set();
  for (const role of Array.isArray(list) ? list : []) {
    if (role && typeof role.name === 'string') {
      if (map.has(role.name)) duplicates.add(role.name);
      map.set(role.name, role);
    }
  }
  return { map, duplicates };
}

/**
 * Pure diff of two `roles:` arrays. Exported for testing.
 * @returns {{created:Array, deleted:Array, updated:Array}}
 */
export function diffRoles(oldRoles, newRoles) {
  const { map: before } = rolesByName(oldRoles);
  const { map: after, duplicates } = rolesByName(newRoles);
  const created = [];
  const deleted = [];
  const updated = [];
  // a duplicated name is reported on its own, because the per-name diff below can
  // only ever describe one of the entries
  const duplicated = [...duplicates];

  for (const [name, role] of after) {
    if (!before.has(name)) {
      created.push({ role: name, groups: memberList(role.groups).length, users: memberList(role.users).length });
      continue;
    }
    const previous = before.get(name);
    const changed = diffOptions(previous.options, role.options);
    const groups = diffMembers(previous.groups, role.groups);
    const users = diffMembers(previous.users, role.users);
    if (Object.keys(changed).length || groups || users) {
      const entry = { role: name };
      if (Object.keys(changed).length) entry.changed = changed;
      if (groups) entry.groups = groups;
      if (users) entry.users = users;
      updated.push(entry);
    }
  }
  for (const [name, role] of before) {
    if (!after.has(name)) {
      deleted.push({ role: name, groups: memberList(role.groups).length, users: memberList(role.users).length });
    }
  }
  return { created, deleted, updated, duplicated };
}

export function configHash(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function parseQuietly(text) {
  try {
    return yaml.parse(text || '') || {};
  } catch {
    // an unparsable side still produces a useful config.save entry, just no delta
    return null;
  }
}

/**
 * Record a config write and everything it changed about roles.
 * Fire and forget : never awaited for correctness, never throws.
 *
 * @param {object} p
 * @param {object} [p.user]    acting user (req.user.user), omit for system
 * @param {string} [p.ip]
 * @param {string} p.oldYaml   the config as it was
 * @param {string} p.newYaml   the config as written
 * @param {string} [p.source]  'database' | 'file' | 'repository' | 'import' | ...
 * @param {string} [p.action]  override the summary action name
 */
export function auditConfigChange(args) {
  // DEFERRED to the next tick. This does two YAML parses, and yaml.parse is synchronous:
  // on a large config that measured 82 ms at 30 KB and several SECONDS at multi-MB, and
  // this is a single-process app, so doing it inline froze the whole server before the
  // response was even written. Auditing is observability - it must never sit on the
  // response path. setImmediate also means a throw in here can never reach the caller.
  setImmediate(() => auditConfigChangeNow(args));
}

// `parsedAfter` lets a caller that has ALREADY parsed the new document hand it over
// rather than paying for a second identical parse (saveConfig has one in hand).
// One save must not fan out into thousands of concurrent inserts : the pool is 20
// connections with no queue limit, so a mass role replacement would stall unrelated
// requests. Entries are written one at a time (this already runs off the response path)
// and capped, with a summary row when the cap is hit.
const MAX_ROLE_ENTRIES = 200;

async function auditConfigChangeNow({ user, ip, oldYaml, newYaml, source, action = 'config.save', parsedAfter }) {
  try {
    const before = parseQuietly(oldYaml);
    const after = parsedAfter !== undefined ? parsedAfter : parseQuietly(newYaml);
    const base = { user, ip };

    await Audit.log({
      ...base,
      action,
      targetType: 'config',
      target: source || null,
      detail: {
        source: source || null,
        // counts make an unexpected mass deletion obvious at a glance
        roles: Array.isArray(after?.roles) ? after.roles.length : null,
        categories: Array.isArray(after?.categories) ? after.categories.length : null,
        forms: Array.isArray(after?.forms) ? after.forms.length : null,
        sha256Before: configHash(oldYaml).slice(0, 16),
        sha256After: configHash(newYaml).slice(0, 16),
      },
    });

    // no delta is possible if either side would not parse
    if (!before || !after) return;

    const { created, deleted, updated, duplicated } = diffRoles(before.roles, after.roles);
    const roleEntryCount = (duplicated?.length || 0) + created.length + deleted.length + updated.length;
    if (roleEntryCount > MAX_ROLE_ENTRIES) {
      // no single role to name - the change is across the whole section, and 'roles' says
      // so rather than leaving the one summary row in the table without a target
      await Audit.log({ user, ip, action: 'role.bulkChange', targetType: 'role', target: 'roles',
        detail: { created: created.length, deleted: deleted.length, updated: updated.length,
                  duplicated: duplicated?.length || 0,
                  note: `too many role changes to record individually (cap ${MAX_ROLE_ENTRIES})` } });
      return;
    }
    for (const name of duplicated || []) {
      // outcome 'failure' so it stands out : a config that reaches this state has a
      // role defined twice, which grants that role's rights to both definitions
      await Audit.log({ ...base, action: 'role.duplicate', outcome: 'failure', targetType: 'role', target: name,
        detail: { reason: 'the same role name is defined more than once, so its permissions are the union of both entries' } });
    }
    for (const c of created) {
      await Audit.log({ ...base, action: 'role.create', targetType: 'role', target: c.role, detail: { groups: c.groups, users: c.users } });
    }
    for (const d of deleted) {
      await Audit.log({ ...base, action: 'role.delete', targetType: 'role', target: d.role, detail: { groups: d.groups, users: d.users } });
    }
    for (const u of updated) {
      const detail = {};
      if (u.changed) detail.changed = u.changed;
      if (u.groups) detail.groups = u.groups;
      if (u.users) detail.users = u.users;
      await Audit.log({ ...base, action: 'role.update', targetType: 'role', target: u.role, detail });
    }
  } catch (e) {
    // auditing must never be the reason a config save fails
    logger.error(`Failed to audit the config change : ${e.message || e}`);
  }
}

export default { diffRoles, auditConfigChange, configHash };
