// The chat panel (AppChat.vue). It reads the component source, like form-robustness :
// these are guards on what the panel may do, not on how it looks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '../src/components/AppChat.vue'), 'utf8');
const app = readFileSync(path.join(here, '../src/App.vue'), 'utf8');

describe('the chat panel', () => {
  it('shows only for a logged-in user, with the chat enabled on the server, and allowChat not off', () => {
    expect(src).toMatch(
      /const visible = computed\(\s*\(\) =>\s*store\.authenticated &&\s*store\.chatEnabled &&\s*store\.profile\?\.options\?\.allowChat !== false &&\s*!NO_CHAT_ROUTES\.has\(route\.name\),?\s*\)/,
    );
    // an expired session lands on the login page with store.authenticated still true
    expect(src).toMatch(/NO_CHAT_ROUTES = new Set\(\['\/login', '\/logout', '\/error', '\/schema'\]\)/);
    expect(src).toMatch(/watch\(visible, \(shown\) => \{\n +if \(shown\) return;\n +open\.value = false;/);
    expect(src).toMatch(/<template v-if="visible">/);
    expect(app).toMatch(/<AppChat \/>/);
  });

  it('approves with the plan id only - never a payload the page could have changed', () => {
    expect(src).toMatch(
      /axios\.post\(\s*'\/api\/v2\/chat\/approve',\s*\{ sessionId, planId: proposal\.planId \},\s*TokenStorage\.getAuthentication\(\),?\s*\)/,
    );
    expect(src).not.toMatch(/approve[^\n]*extravars/);
  });

  it('renders the model text only through the app html sanitizer', () => {
    expect(src).toMatch(/import \{ sanitize \} from '@\/lib\/HtmlSanitizer'/);
    expect(src).toMatch(/const render = \(text\) => sanitize\(converter\.makeHtml\(/);
    const vhtml = [...src.matchAll(/v-html="([^"]+)"/g)].map((m) => m[1]);
    expect(vhtml).toEqual(['render(e.text)']);
  });

  it('goes away once the chat is switched off, without a page reload', () => {
    expect(src).toMatch(/if \(!res\.data\?\.enabled\) store\.chatEnabled = false;/);
    expect(src).toMatch(/if \(switchedOff\(err\)\) \{\s*store\.chatEnabled = false;\s*return;\s*\}/);
  });

  it("names a few of the user's own chat forms in the welcome, from the server", () => {
    expect(src).toMatch(/examples\.value = Array\.isArray\(res\.data\?\.examples\) \? res\.data\.examples : \[\];/);
    expect(src).toMatch(/v-if="examples\.length"/);
  });

  it('follows a launched job by its status only - no job output in the chat', () => {
    expect(src).not.toMatch(/job\.output/);
    expect(src).toMatch(/proposal\.jobStatus = job\.status/);
  });

  it('talks to the server only - no provider, no key in the browser', () => {
    expect(src).not.toMatch(/anthropic|openai|api[_-]?key/i);
    for (const url of src.matchAll(/axios\.post\('([^']+)'/g)) expect(url[1]).toMatch(/^\/api\/v2\/chat\//);
  });
});
