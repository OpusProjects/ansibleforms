// useFormsConfig is the shared load/save behind the config.yaml editors (admin/roles.vue ; the
// categories and constants, once settings pages, are edited in the designer now). It had no coverage at all,
// and four of the properties below are the kind that fail quietly - the save appears to
// work and the damage shows up in the stored document or on somebody else's screen.
//
//  - baseHash must be the hash of what the user STARTED editing. save() re-reads the raw
//    yaml just before merging (so comments and the untouched forms: block survive), and if
//    that read refreshed baseHash the server could never detect a concurrent change - every
//    save would silently overwrite whatever landed in between. Nothing about the UI would
//    look wrong.
//  - on a 409 baseHash MUST be refreshed, or the editor is a dead end: the same stale hash
//    is rejected again on every following click and the only way out is a reload, which
//    discards the user's work.
//  - only DIRTY sections may be written. Rewriting an untouched section round-trips it
//    through createNode and drops its comments and anchors.
//  - a ytt template must never be section-merged, and load failing must leave the editor
//    read-only rather than "not dirty, nothing to save".
import { describe, it, expect, beforeEach, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: null, put: null, puts: [], gets: 0 }));
vi.mock('axios', () => ({
  default: {
    get: (...a) => {
      http.gets++;
      return http.get(...a);
    },
    put: (...a) => {
      http.puts.push(a[1]);
      return http.put ? http.put(...a) : Promise.resolve({ data: {} });
    },
  },
}));

const toasts = vi.hoisted(() => ({ error: [], success: [], warning: [] }));
vi.mock('vue-sonner', () => ({
  toast: {
    error: (m) => toasts.error.push(m),
    success: (m) => toasts.success.push(m),
    warning: (m) => toasts.warning.push(m),
  },
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }));
vi.mock('@/lib/TokenStorage', () => ({ default: { getAuthentication: () => ({}) } }));
vi.mock('@/lib/Helpers', () => ({ default: { parseAxiosResponseError: (e) => e.message || 'error' } }));

const { useFormsConfig } = await import('@/composables/useFormsConfig');

// a config with a comment, an anchor and a forms: block - all of which must survive
const YAML = `# top comment
categories:
  - name: Ops
    icon: server
roles:
  # who may operate
  - name: operators
    groups:
      - local/ops
constants:
  # the environment name
  ENV: prod
forms:
  - name: keep-me
    roles: [operators]
`;

const okGet =
  (yamlStr, hash = 'HASH-1') =>
  () =>
    Promise.resolve({ data: { forms_yaml: yamlStr, baseHash: hash } });

beforeEach(() => {
  http.puts.length = 0;
  http.gets = 0;
  http.put = null;
  toasts.error.length = 0;
  toasts.success.length = 0;
  toasts.warning.length = 0;
});

describe('loading', () => {
  it('parses the sections and starts clean', async () => {
    http.get = okGet(YAML);
    const c = useFormsConfig();
    await c.load();
    expect(c.categories.value.map((x) => x.name)).toEqual(['Ops']);
    expect(c.roles.value.map((x) => x.name)).toEqual(['operators']);
    // stamping _uid on every row must not register as an edit
    expect(c.isCategoriesDirty.value).toBe(false);
    expect(c.isRolesDirty.value).toBe(false);
    expect(c.isConstantsDirty.value).toBe(false);
  });

  it('a failed load leaves the editor read-only instead of silently clean', async () => {
    http.get = () => Promise.reject(new Error('boom'));
    const c = useFormsConfig();
    await c.load();
    expect(c.loadError.value).toBe('boom');
    // no snapshot : nothing can be dirty, so Save must stay disabled rather than
    // offering to write an empty config over the real one
    c.categories.value.push({ name: 'X', icon: 'bars' });
    expect(c.isCategoriesDirty.value).toBe(false);
  });

  it('a syntax error is reported and does not wipe the config', async () => {
    http.get = okGet('categories: [unclosed\n');
    const c = useFormsConfig();
    await c.load();
    expect(c.parseError.value).toBe(true);
    expect(http.puts).toEqual([]);
  });

  it('a ytt template is flagged read-only', async () => {
    http.get = okGet('#@ load("@ytt:data", "data")\ncategories: []\n');
    const c = useFormsConfig();
    await c.load();
    expect(c.isTemplated.value).toBe(true);
  });
});

describe('saving', () => {
  it('writes only the dirty section, so untouched ones keep their comments', async () => {
    http.get = okGet(YAML);
    const c = useFormsConfig();
    await c.load();
    c.categories.value[0].name = 'Operations';

    expect(await c.save('cats')).toBe(true);
    const written = http.puts.at(-1).forms_yaml;
    expect(written).toContain('Operations');
    expect(written).toContain('# top comment');
    expect(written).toContain('keep-me');
    expect(written).toContain('local/ops');
    // the point of the dirty flags : a section rebuilt through createNode loses the
    // comments inside it, so an untouched section must not be rewritten at all
    expect(written, 'the untouched roles section was rewritten').toContain('# who may operate');
    expect(written, 'the untouched constants section was rewritten').toContain('# the environment name');
  });

  it('sends the hash of what the user started editing, not a fresher one', async () => {
    // the pre-save GET returns a DIFFERENT hash - it must not be adopted, or a
    // concurrent change could never be detected
    let n = 0;
    http.get = () =>
      Promise.resolve({
        data: { forms_yaml: YAML, baseHash: n++ === 0 ? 'HASH-1' : 'HASH-MOVED' },
      });
    const c = useFormsConfig();
    await c.load();
    c.categories.value[0].name = 'Operations';
    await c.save();
    expect(http.puts.at(-1).baseHash).toBe('HASH-1');
  });

  it('a 409 refuses the write, reports it, and refreshes the hash so a retry can succeed', async () => {
    http.get = okGet(YAML, 'HASH-1');
    const c = useFormsConfig();
    await c.load();
    c.categories.value[0].name = 'Operations';

    http.get = okGet(YAML, 'HASH-2');
    http.put = () => Promise.reject({ response: { status: 409 } });
    expect(await c.save()).toBe(false);
    expect(toasts.error.length).toBe(1);

    // the second, deliberate click must go through with the CURRENT hash
    http.put = () => Promise.resolve({ data: {} });
    expect(await c.save()).toBe(true);
    expect(http.puts.at(-1).baseHash).toBe('HASH-2');
  });

  it('a refused save reports false so the caller does not re-stamp its state', async () => {
    http.get = okGet(YAML);
    const c = useFormsConfig();
    await c.load();
    c.roles.value[0].name = 'public';
    http.put = () => Promise.reject({ response: { status: 423 }, message: 'locked' });
    expect(await c.save()).toBe(false);
  });

  it('never section-merges into a ytt template, even if it became one since load', async () => {
    http.get = okGet(YAML);
    const c = useFormsConfig();
    await c.load();
    c.categories.value[0].name = 'Operations';
    // somebody switched the stored config to a template in the meantime
    http.get = okGet('#@ load("@ytt:data", "data")\ncategories: []\n');
    expect(await c.save()).toBe(false);
    expect(http.puts, 'nothing may be written into a template').toEqual([]);
  });
});

describe('category normalization', () => {
  it('gives every level an icon, so saving does not fail on a field nobody touched', async () => {
    http.get = okGet('categories:\n  - name: Parent\n    items:\n      - name: Child\n');
    const c = useFormsConfig();
    await c.load();
    expect(c.categories.value[0].icon).toBe('bars');
    expect(c.categories.value[0].items[0].icon).toBe('bars');
  });

  it('trims names, because a category is addressed by its literal slash-joined path', async () => {
    http.get = okGet(YAML);
    const c = useFormsConfig();
    await c.load();
    c.categories.value[0].name = '  Spaced  ';
    await c.save();
    expect(http.puts.at(-1).forms_yaml).toContain('Spaced');
    expect(http.puts.at(-1).forms_yaml).not.toContain('  Spaced  ');
  });
});
