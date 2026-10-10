import { describe, it, expect, vi, beforeAll } from 'vitest';

// vi.mock calls are hoisted — use the exact import specifiers from common.js
vi.mock('cert-info', () => ({ default: { info: vi.fn() } }));

// These mocks match the relative paths as resolved from src/lib/common.js
vi.mock('../../config/app.config.js', () => ({
  default: {
    filterJobOutputRegex: '\\[low\\]',
    maskExtravarsRegex: 'password|secret|token',
  }
}));
vi.mock('../../config/log.config.js', () => ({
  default: { tz: 'UTC', path: '/tmp/test-logs' }
}));
vi.mock('./logger.js', () => ({
  default: {
    debug: vi.fn(), info: vi.fn(), notice: vi.fn(),
    warning: vi.fn(), error: vi.fn(), warn: vi.fn(),
  }
}));

let Helpers;
beforeAll(async () => {
  const mod = await import('../src/lib/common.js');
  Helpers = mod.default;
});

// ─── htmlEscape ───────────────────────────────────────────────

describe('Helpers.htmlEscape', () => {
  it('escapes < and > characters', () => {
    expect(Helpers.htmlEscape('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes ampersand', () => {
    expect(Helpers.htmlEscape('a & b')).toBe('a &amp; b');
  });

  it('escapes double quotes', () => {
    expect(Helpers.htmlEscape('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(Helpers.htmlEscape("it's")).toBe("it&#39;s");
  });

  it('handles empty string', () => {
    expect(Helpers.htmlEscape('')).toBe('');
  });

  it('passes through string with no special chars', () => {
    expect(Helpers.htmlEscape('hello world 123')).toBe('hello world 123');
  });

  it('escapes a full script tag (XSS payload)', () => {
    expect(Helpers.htmlEscape('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes img onerror payload', () => {
    expect(Helpers.htmlEscape('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes multiple special chars in one string', () => {
    expect(Helpers.htmlEscape('a < b & c > d "e" \'f\''))
      .toBe('a &lt; b &amp; c &gt; d &quot;e&quot; &#39;f&#39;');
  });

  it('escapes nested HTML tags', () => {
    expect(Helpers.htmlEscape('<div onclick="evil()"><b>text</b></div>'))
      .toBe('&lt;div onclick=&quot;evil()&quot;&gt;&lt;b&gt;text&lt;/b&gt;&lt;/div&gt;');
  });
});

// ─── formatOutput: XSS prevention ────────────────────────────

describe('formatOutput XSS prevention', () => {
  function makeRecord(output, outputType = 'stdout') {
    return [{ output, output_type: outputType, timestamp: '2024-01-01 12:00:00' }];
  }

  it('escapes <script> tag in stdout output', () => {
    const result = Helpers.formatOutput(makeRecord('<script>alert("xss")</script>'));
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes <img onerror> payload in stdout output', () => {
    const result = Helpers.formatOutput(makeRecord('<img src=x onerror=alert(1)>'));
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  it('escapes <script> in stderr output', () => {
    const result = Helpers.formatOutput(makeRecord('<script>alert(1)</script>', 'stderr'));
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes XSS in warning lines (stdout)', () => {
    const result = Helpers.formatOutput(makeRecord('[WARNING] <script>alert(1)</script>'));
    expect(result).not.toContain('<script>');
    expect(result).toContain("class='has-text-purple'");
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes XSS in warning lines (stderr)', () => {
    const result = Helpers.formatOutput(makeRecord('[WARNING] <img onerror=alert(1)>', 'stderr'));
    expect(result).not.toContain('<img');
    expect(result).toContain("class='has-text-purple'");
  });

  it('escapes XSS in error lines', () => {
    const result = Helpers.formatOutput(makeRecord('[ERROR] <script>alert(1)</script>'));
    expect(result).not.toContain('<script>');
    expect(result).toContain("class='has-text-danger'");
  });

  it('escapes XSS in task/play lines (bold)', () => {
    const xssTask = 'TASK [<script>alert(1)</script>] ****';
    const result = Helpers.formatOutput(makeRecord(xssTask));
    expect(result).not.toContain('<script>');
    expect(result).toContain("class='has-text-weight-bold'");
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes XSS in ok/success lines', () => {
    const result = Helpers.formatOutput(makeRecord('ok: [<script>alert(1)</script>] => {}'));
    expect(result).not.toContain('<script>alert');
    expect(result).toContain("class='has-text-success'");
  });

  it('escapes XSS in changed lines', () => {
    const result = Helpers.formatOutput(makeRecord('changed: [<img onerror=alert(1)>] => {}'));
    expect(result).not.toContain('<img');
    expect(result).toContain("class='has-text-warning'");
  });

  it('escapes XSS in skipping lines', () => {
    const result = Helpers.formatOutput(makeRecord('skipping: [<script>xss</script>]'));
    expect(result).not.toContain('<script>');
    expect(result).toContain("class='has-text-info'");
  });

  it('escapes XSS in continuation lines (inheriting previous format)', () => {
    const multiline = '[WARNING] first line\n<script>alert("xss")</script>';
    const result = Helpers.formatOutput(makeRecord(multiline));
    expect(result).not.toContain('<script>alert');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes XSS in plain text lines', () => {
    const multiline = 'normal line\n<script>alert(1)</script>';
    const result = Helpers.formatOutput(makeRecord(multiline));
    expect(result).not.toContain('<script>alert');
  });

  it('escapes XSS in summary lines (ok=...failed=...)', () => {
    const summary = 'hostname : ok=2 changed=0 unreachable=0 failed=0 <script>alert(1)</script>';
    const result = Helpers.formatOutput(makeRecord(summary));
    expect(result).not.toContain('<script>alert');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes event handler attributes in output (tag is neutralized)', () => {
    const result = Helpers.formatOutput(makeRecord('<div onmouseover="alert(1)">hover me</div>'));
    // The < and > are escaped so the tag won't be parsed as HTML by the browser
    expect(result).not.toContain('<div onmouseover');
    expect(result).toContain('&lt;div');
    expect(result).toContain('&quot;alert(1)&quot;');
  });

  it('escapes SVG-based XSS payloads', () => {
    const result = Helpers.formatOutput(makeRecord('<svg/onload=alert(1)>'));
    expect(result).not.toContain('<svg');
    expect(result).toContain('&lt;svg');
  });

  it('escapes data URI payloads', () => {
    const result = Helpers.formatOutput(makeRecord('<a href="data:text/html,<script>alert(1)</script>">click</a>'));
    expect(result).not.toContain('<a href');
    expect(result).toContain('&lt;a');
  });

  it('escapes multi-record output with XSS in multiple records', () => {
    const records = [
      { output: '<script>alert(1)</script>', output_type: 'stdout', timestamp: '12:00:00' },
      { output: '<img onerror=alert(2)>', output_type: 'stderr', timestamp: '12:00:01' },
    ];
    const result = Helpers.formatOutput(records);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('<img');
  });
});

// ─── formatOutput: correct HTML structure preserved ──────────

describe('formatOutput preserves correct HTML structure', () => {
  function makeRecord(output, outputType = 'stdout') {
    return [{ output, output_type: outputType, timestamp: '2024-01-01 12:00:00' }];
  }

  it('wraps stderr errors in has-text-danger spans', () => {
    const result = Helpers.formatOutput(makeRecord('some error', 'stderr'));
    expect(result).toContain("<span class='has-text-danger'>");
    expect(result).toContain('</span>');
  });

  it('wraps stderr warnings in has-text-purple spans', () => {
    const result = Helpers.formatOutput(makeRecord('[WARNING] something', 'stderr'));
    expect(result).toContain("<span class='has-text-purple'>");
  });

  it('wraps stdout warnings in has-text-purple spans', () => {
    const result = Helpers.formatOutput(makeRecord('[WARNING] test'));
    expect(result).toContain("<span class='has-text-purple'>");
  });

  it('escapes XSS in a recap line host', () => {
    const result = Helpers.formatOutput(makeRecord('<img/src=x/onerror=alert(1)> : ok=1 changed=0 unreachable=0 failed=0'));
    expect(result).not.toContain('<img');
    expect(result).toContain("class='has-text-success'");
  });

  it('wraps stdout errors in has-text-danger spans', () => {
    const result = Helpers.formatOutput(makeRecord('[ERROR] test'));
    expect(result).toContain("<span class='has-text-danger'>");
  });

  it('wraps ok lines in has-text-success spans', () => {
    const result = Helpers.formatOutput(makeRecord('ok: [myhost] => {"changed": false}'));
    expect(result).toContain("<span class='has-text-success'>");
  });

  it('wraps changed lines in has-text-warning spans', () => {
    const result = Helpers.formatOutput(makeRecord('changed: [myhost] => {"changed": true}'));
    expect(result).toContain("<span class='has-text-warning'>");
  });

  it('wraps skipping lines in has-text-info spans', () => {
    const result = Helpers.formatOutput(makeRecord('skipping: [myhost]'));
    expect(result).toContain("<span class='has-text-info'>");
  });

  it('wraps task lines in has-text-weight-bold spans', () => {
    const result = Helpers.formatOutput(makeRecord('TASK [my task] ****'));
    expect(result).toContain("<span class='has-text-weight-bold'>");
  });

  it('adds timestamp span', () => {
    const result = Helpers.formatOutput(makeRecord('hello'));
    expect(result).toContain("2024-01-01 12:00:00");
    expect(result).toContain("class='tag is-info is-light'");
  });

  it('renders summary line with tag spans for ok/changed/failed counts', () => {
    const summary = 'myhost : ok=3 changed=1 unreachable=0 failed=0 skipped=2 rescued=0';
    const result = Helpers.formatOutput(makeRecord(summary));
    expect(result).toContain("<span class='tag is-success'>ok=3</span>");
    expect(result).toContain("<span class='tag is-warning'>changed=1</span>");
    expect(result).toContain("<span class='tag is-info'>skipped=2</span>");
  });
});

// ─── formatOutput: asText mode (no escaping) ─────────────────

describe('formatOutput asText mode', () => {
  it('does NOT escape HTML in asText mode', () => {
    const records = [{ output: '<script>alert(1)</script>', output_type: 'stdout', timestamp: '12:00:00' }];
    const result = Helpers.formatOutput(records, true);
    expect(result).toContain('<script>alert(1)</script>');
    expect(result).not.toContain('&lt;');
  });

  it('returns plain text without span wrapping in asText mode', () => {
    const records = [{ output: 'hello world', output_type: 'stdout', timestamp: '12:00:00' }];
    const result = Helpers.formatOutput(records, true);
    expect(result).toBe('hello world');
    expect(result).not.toContain('<span');
  });

  it('normalizes newlines in asText mode', () => {
    const records = [{ output: 'line1\r\nline2\nline3', output_type: 'stdout', timestamp: '12:00:00' }];
    const result = Helpers.formatOutput(records, true);
    expect(result).toBe('line1\r\nline2\r\nline3');
  });
});

// ─── formatOutput: edge cases ────────────────────────────────

describe('formatOutput edge cases', () => {
  function makeRecord(output, outputType = 'stdout') {
    return [{ output, output_type: outputType, timestamp: '2024-01-01 12:00:00' }];
  }

  it('handles output with only ampersands', () => {
    const result = Helpers.formatOutput(makeRecord('a & b & c'));
    expect(result).toContain('a &amp; b &amp; c');
  });

  it('handles output with HTML entity lookalikes', () => {
    const result = Helpers.formatOutput(makeRecord('&amp; already escaped'));
    expect(result).toContain('&amp;amp;');
  });

  it('handles output with single quotes in content', () => {
    const result = Helpers.formatOutput(makeRecord("it's a test"));
    expect(result).toContain("it&#39;s a test");
  });

  it('handles mixed XSS across multiple lines in one record', () => {
    const multiline = 'ok: [safe-host] => {}\n<script>alert(1)</script>\nchanged: [host2] => {}';
    const result = Helpers.formatOutput(makeRecord(multiline));
    expect(result).not.toContain('<script>');
    expect(result).toContain("class='has-text-success'");
    expect(result).toContain("class='has-text-warning'");
  });
});
