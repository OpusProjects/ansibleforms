// Role option serialization is load-bearing, and both invariants below have already
// caused real bugs. Neither is pinned by anything else.
//
// 1. The server ANDs each option across every role a user matches (getRolesAndOptions),
//    so an explicit `false` in one role overrides another role's default. Writing out
//    options the role has no opinion about therefore silently strips permissions from
//    multi-role users. An untouched role must serialize with no options block at all.
//
// 2. roleOptionDefaults() branches on the NAME 'admin', and the server derives isAdmin
//    from the role name too. The baseline for "did this change?" must come from the
//    role's CURRENT name - caching it at load time meant renaming a role to 'admin'
//    wrote no options at all and granted full admin while the UI showed the switches off.
import { describe, it, expect } from 'vitest';
import { serializeRole, roleOptionDefaults, roleOptionKeys, roleToEditable } from '@/config/roles';

describe('an untouched role writes no options', () => {
  const loaded = { name: 'operators', groups: ['local/ops'], _uid: 1 };

  it('the helpers are really exported, so these assertions are not vacuous', () => {
    expect(typeof serializeRole).toBe('function');
    expect(roleOptionKeys.length).toBeGreaterThan(10);
  });

  it('defaults are not materialised', () => {
    const out = serializeRole({ ...loaded, options: { ...roleOptionDefaults('operators') } }, 'operators');
    expect(out.options ?? null).toBeNull();
  });

  it('only a flag the user actually changed is written', () => {
    const base = roleOptionDefaults('operators');
    const flipped = { ...base, showLogs: !base.showLogs };
    const out = serializeRole({ ...loaded, options: flipped }, 'operators');
    expect(Object.keys(out.options)).toEqual(['showLogs']);
    expect(out.options.showLogs).toBe(!base.showLogs);
  });

  it('an explicit false is still written when it differs from the default', () => {
    const base = roleOptionDefaults('operators');
    // pick an option that defaults to true, so turning it off is a real opinion
    const trueByDefault = roleOptionKeys.find((k) => base[k] === true);
    expect(trueByDefault).toBeDefined();
    const out = serializeRole({ ...loaded, options: { ...base, [trueByDefault]: false } }, 'operators');
    expect(out.options).toEqual({ [trueByDefault]: false });
  });
});

describe('the baseline follows the role name', () => {
  // serializeRole takes ONE argument and reads r.name - the baseline is derived inside.
  // (An earlier version of this test passed a second "old name" argument, which the
  // function ignores, so it asserted nothing at all.)
  it('admin has a different default set than any other role', () => {
    expect(roleOptionDefaults('admin').showSettings).toBe(true);
    expect(roleOptionDefaults('operators').showSettings).toBe(false);
  });

  it('the SAME option values serialize differently depending on the name', () => {
    // this is what stops a rename to 'admin' granting admin silently: the switches are
    // compared against the admin baseline, so the ones that differ are written out
    const adminDefaults = roleOptionDefaults('admin');
    const asAdmin = serializeRole({ name: 'admin', groups: ['local/x'], options: { ...adminDefaults } });
    const asOther = serializeRole({ name: 'operators', groups: ['local/x'], options: { ...adminDefaults } });
    // against the admin baseline nothing changed, so nothing is written
    expect(asAdmin.options).toBeUndefined();
    // the identical values are a real opinion for a non-admin role, so they ARE written
    expect(asOther.options).toBeDefined();
    expect(asOther.options.showSettings).toBe(true);
  });

  it('a role renamed TO admin keeps the switches the user saw', () => {
    // the user turned settings off while the role was named 'operators'; renaming it to
    // 'admin' must write showSettings:false explicitly, not omit it
    const off = { ...roleOptionDefaults('operators'), showSettings: false };
    const out = serializeRole({ name: 'admin', groups: ['local/x'], options: off });
    expect(out.options?.showSettings).toBe(false);
  });
});

// 3. allowMcp, left out, is read by the server as the role's allowChat (user.model.js) : a role
//    that turned the chat off before allowMcp existed keeps the MCP server off too. The editor
//    must show it that way, and write allowMcp only when it differs from allowChat.
describe('allowMcp follows allowChat unless it is set', () => {
  it('a role without allowMcp shows the allowChat it has', () => {
    expect(roleToEditable({ name: 'ops', options: { allowChat: false } }).options.allowMcp).toBe(false);
    expect(roleToEditable({ name: 'ops' }).options.allowMcp).toBe(true);
    expect(roleToEditable({ name: 'ops', options: { allowChat: false, allowMcp: true } }).options.allowMcp).toBe(true);
  });

  it('allowMcp is written only when it differs from allowChat', () => {
    const same = serializeRole({
      name: 'ops',
      options: { ...roleOptionDefaults('ops'), allowChat: false, allowMcp: false },
    });
    expect(same.options).toEqual({ allowChat: false });
    const mcpOnly = serializeRole({
      name: 'ops',
      options: { ...roleOptionDefaults('ops'), allowChat: false, allowMcp: true },
    });
    expect(mcpOnly.options).toEqual({ allowChat: false, allowMcp: true });
    const chatOnly = serializeRole({ name: 'ops', options: { ...roleOptionDefaults('ops'), allowMcp: false } });
    expect(chatOnly.options).toEqual({ allowMcp: false });
  });

  it('an untouched role still writes no options', () => {
    expect(serializeRole(roleToEditable({ name: 'ops', groups: ['local/x'] })).options).toBeUndefined();
  });
});

// 4. a role's description : read, written back only when there is one (a role without stays as
//    it was in the yaml), trimmed
describe('a role keeps its description', () => {
  it('reads it, writes it trimmed, and writes nothing when empty', () => {
    const loaded = roleToEditable({ name: 'ops', description: 'Runs the network forms', groups: ['local/x'] });
    expect(loaded.description).toBe('Runs the network forms');
    expect(serializeRole({ ...loaded, description: '  Runs the network forms  ' }).description).toBe(
      'Runs the network forms',
    );
    expect('description' in serializeRole({ ...loaded, description: '   ' })).toBe(false);
    expect(roleToEditable({ name: 'ops' }).description).toBe('');
  });

  it('admin and public never write one : theirs is fixed', () => {
    for (const name of ['admin', 'public']) {
      const out = serializeRole({ ...roleToEditable({ name, groups: [] }), description: 'typed by hand' });
      expect('description' in out).toBe(false);
    }
  });
});
