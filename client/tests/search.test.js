// The header search (lib/Search.js) and the pages it offers (config/searchPages.js).
//
// The search runs over the forms list and the pages in the browser : every query word must
// match, a title match ranks first, and highlight() returns plain parts the component renders
// as text. The pages carry the role option of their route, so a result never leads to a page
// whose guard sends the user back home - checked here against the router's guards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Search from '@/lib/Search';
import { searchPages } from '@/config/searchPages';

const here = path.dirname(fileURLToPath(import.meta.url));

const forms = [
  { name: 'Ansible Core Form', description: 'Targets an Ansible Core playbook', categories: ['Demo'] },
  { name: 'HelloWorld', description: 'Kicks off the HelloWorld template in AWX', categories: ['Demo', 'AWX'] },
  { name: 'Cleanup jobs', description: 'Removes old ansible job logs', categories: ['Maintenance'] },
];
const pages = [{ title: 'Users', section: 'Settings', link: '/admin/users', icon: 'user' }];
const index = Search.buildIndex(forms, pages);

describe('Search.search', () => {
  it('finds nothing for a blank query', () => {
    expect(Search.search(index, '   ')).toEqual([]);
  });

  it('ranks a title match before a match in the description', () => {
    const titles = Search.search(index, 'ansible').map((r) => r.title);
    expect(titles).toEqual(['Ansible Core Form', 'Cleanup jobs']);
  });

  it('needs every word of the query, in any field', () => {
    expect(Search.search(index, 'awx hello').map((r) => r.title)).toEqual(['HelloWorld']);
    expect(Search.search(index, 'awx cleanup')).toEqual([]);
  });

  it('finds the pages, and links forms to the form page', () => {
    expect(Search.search(index, 'users')[0]).toMatchObject({ kind: 'page', to: '/admin/users' });
    expect(Search.search(index, 'hello')[0].to).toEqual({ path: '/form', query: { form: 'HelloWorld' } });
  });

  it('shows the texts that match under a result', () => {
    expect(Search.search(index, 'maintenance')[0].snippets).toEqual(['Maintenance']);
  });

  it('cuts a long text around its first match', () => {
    const long = 'word '.repeat(60) + 'needle ' + 'word '.repeat(60);
    const [r] = Search.search(Search.buildIndex([{ name: 'Long', description: long }], []), 'needle');
    expect(r.snippets[0]).toContain('needle');
    expect(r.snippets[0].length).toBeLessThan(160);
    expect(r.snippets[0].startsWith('… ')).toBe(true);
  });
});

describe('Search.highlight', () => {
  it('marks every match, whatever its case, and keeps the text whole', () => {
    const parts = Search.highlight('Ansible runs ansible', 'ANSIBLE');
    expect(parts.map((p) => p.text).join('')).toBe('Ansible runs ansible');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Ansible', 'ansible']);
  });

  it('treats regex characters in the query as text', () => {
    const parts = Search.highlight('a (b) c', '(b)');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['(b)']);
  });
});

describe('searchPages', () => {
  const t = (key) => key;
  const routerSrc = readFileSync(path.join(here, '..', 'src/router/index.js'), 'utf8');

  // guard function -> the role option it tests, and route path -> its guard
  const guards = {};
  for (const m of routerSrc.matchAll(/const\s+(\w+)\s*=\s*\(to,\s*from,\s*next\)\s*=>\s*\{([\s\S]*?)\n\}/g)) {
    const opts = [...m[2].matchAll(/options\?\.(\w+)/g)].map((x) => x[1]);
    if (opts.length) guards[m[1]] = opts;
  }
  const routes = {};
  for (const m of routerSrc.matchAll(/\{\s*path:\s*'([^']+)'([^}]*)\}/g)) {
    routes[m[1]] = /beforeEnter:\s*(\w+)/.exec(m[2])?.[1] || null;
  }

  it('offers only pages that exist, each with the option its route guard checks', () => {
    const all = searchPages(t, new Proxy({}, { get: () => true }));
    expect(all.length).toBeGreaterThan(20);
    const wrong = [];
    for (const page of all) {
      if (!(page.link in routes)) {
        wrong.push(`${page.link}: no such route`);
        continue;
      }
      const guard = routes[page.link];
      const expected = guard ? guards[guard]?.[0] : null;
      if ((page.permission || null) !== (expected || null)) {
        wrong.push(`${page.link}: search says '${page.permission}', the route checks '${expected}'`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('hides the pages the user may not open', () => {
    const links = searchPages(t, { showJobs: true }).map((p) => p.link);
    expect(links).toContain('/jobs');
    expect(links).toContain('/profile');
    expect(links).not.toContain('/admin/users');
    expect(links).not.toContain('/designer');
  });
});
