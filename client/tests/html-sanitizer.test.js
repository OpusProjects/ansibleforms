import { describe, it, expect } from 'vitest';
import HtmlSanitizer, { ADD_ATTR, forceSafeRel, sanitize } from '../src/lib/HtmlSanitizer.js';

// ─── Link targets in form HTML (issue #480) ───
//
// `target` is NOT in DOMPurify 3.x's default attribute allowlist, so a bare
// DOMPurify.sanitize() dropped it and a link written with target="_blank" navigated in
// the current tab, discarding the form the user was filling in. `ADD_ATTR` is what puts
// it back, so it is asserted directly.
//
// It is asserted as CONFIGURATION rather than as sanitize() output on purpose : these
// tests run in happy-dom, which is not a faithful enough DOM for DOMPurify to be pinned
// by its output. Measured here - happy-dom keeps `target` even with the default config
// (so an output assertion would pass on the unfixed code, a false green) and strips
// block elements such as <p> and <div> that every real browser keeps. The output
// behaviour was verified by hand against Chromium instead : with the default config
// Chromium yields `<a href="..." rel="noopener noreferrer">`, with ADD_ATTR ['target']
// it yields `<a href="..." target="_blank" rel="noopener noreferrer">`, and a
// javascript: href is dropped either way.

describe('HtmlSanitizer configuration', () => {
  it('allows target back into the attribute allowlist', () => {
    expect(ADD_ATTR).toContain('target');
  });

  it('widens nothing beyond target', () => {
    expect(ADD_ATTR).toEqual(['target']);
  });

  it('exposes sanitize on the default export', () => {
    expect(typeof HtmlSanitizer.sanitize).toBe('function');
    expect(typeof sanitize('')).toBe('string');
  });

  it('treats a null or undefined value as empty', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(undefined)).toBe('');
  });
});

// ─── rel is forced, not trusted to the form author ───
//
// forceSafeRel is the `afterSanitizeAttributes` hook, kept pure so it can be pinned
// without a DOM : it only ever reads and writes attributes through the node interface.

function fakeNode(attributes = {}) {
  const attrs = { ...attributes };
  return {
    attrs,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
  };
}

describe('forceSafeRel', () => {
  it('forces noopener and noreferrer on target="_blank"', () => {
    const node = fakeNode({ href: 'https://example.com', target: '_blank' });
    forceSafeRel(node);
    expect(node.attrs.rel.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
  });

  it('forces them on a named target too, which browsers do not imply', () => {
    const node = fakeNode({ target: 'someWindow' });
    forceSafeRel(node);
    expect(node.attrs.rel).toContain('noopener');
    expect(node.attrs.rel).toContain('noreferrer');
  });

  it('keeps the rel tokens the author already wrote', () => {
    const node = fakeNode({ target: '_blank', rel: 'nofollow' });
    forceSafeRel(node);
    const rel = node.attrs.rel.split(' ');
    expect(rel).toContain('nofollow');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('does not duplicate a token that is already present', () => {
    const node = fakeNode({ target: '_blank', rel: 'noopener  noopener noreferrer' });
    forceSafeRel(node);
    expect(node.attrs.rel.split(' ').filter((r) => r === 'noopener')).toHaveLength(1);
  });

  it('leaves a node without a target untouched', () => {
    const node = fakeNode({ href: 'https://example.com' });
    forceSafeRel(node);
    expect(node.attrs.rel).toBeUndefined();
  });

  it('leaves target="_self" untouched - it opens no new context', () => {
    const node = fakeNode({ target: '_self' });
    forceSafeRel(node);
    expect(node.attrs.rel).toBeUndefined();
  });

  it('ignores a node with no attribute interface (text and comment nodes)', () => {
    expect(() => forceSafeRel({})).not.toThrow();
    expect(() => forceSafeRel(null)).not.toThrow();
  });
});
