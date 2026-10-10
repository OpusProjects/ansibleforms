// The constants editor round-trip (config/constants.js), shared by admin/constants.vue
// (through useFormsConfig) and the designer's constant modals.
//
// Constants are referenced from forms as $(MY_KEY), so both halves matter: the KEY has to
// come back byte-identical or the reference stops resolving, and the VALUE has to keep its
// type - a version string "1.10" silently becoming the number 1.1, or an account number
// "007" becoming 7, corrupts a config the user only opened to look at.
//
// The subtle one is the parent guard. An untouched leaf is written back from _orig
// verbatim, but a row that WAS a parent must never take that path: its children have been
// deleted, and restoring _orig would resurrect the entire subtree the user just removed.
import { describe, it, expect } from 'vitest';
import {
  constantsToArray,
  arrayToConstants,
  coerceConstantValue,
  constantValueDisplay,
  constantValueError,
  constantValueRows,
  flattenConstants,
} from '@/config/constants';

describe('a round trip changes nothing', () => {
  const original = {
    PLAIN: 'hello',
    VERSION: '1.10',
    PADDED: '007',
    EXPONENT: '1e5',
    NUMBER: 42,
    FLOAT: 1.5,
    YES: true,
    NOTHING: null,
    NESTED: { INNER: 'x', DEEPER: { LEAF: 3 } },
  };

  it('survives constantsToArray -> arrayToConstants untouched', () => {
    expect(arrayToConstants(constantsToArray(original))).toEqual(original);
  });

  it('keeps the STRING types that look like something else', () => {
    const out = arrayToConstants(constantsToArray(original));
    // each of these would be a real corruption of a config nobody edited
    expect(out.VERSION).toBe('1.10');
    expect(out.PADDED).toBe('007');
    expect(out.EXPONENT).toBe('1e5');
    expect(typeof out.NUMBER).toBe('number');
    expect(out.YES).toBe(true);
    expect(out.NOTHING).toBe(null);
  });

  it('keeps nesting', () => {
    const out = arrayToConstants(constantsToArray(original));
    expect(out.NESTED.DEEPER.LEAF).toBe(3);
  });
});

describe('editing', () => {
  it('an edited leaf is coerced, an untouched sibling is not', () => {
    const rows = constantsToArray({ EDITED: '1.10', UNTOUCHED: '1.10' });
    rows.find((r) => r.key === 'EDITED').value = '2';
    const out = arrayToConstants(rows);
    expect(out.EDITED).toBe(2);
    expect(out.UNTOUCHED).toBe('1.10');
  });

  it('trims keys, because $(KEY) is matched literally', () => {
    const rows = constantsToArray({ A: '1' });
    rows[0].key = '  SPACED  ';
    expect(Object.keys(arrayToConstants(rows))).toEqual(['SPACED']);
  });

  it('drops a keyless row instead of writing an empty key', () => {
    const rows = constantsToArray({ A: '1' });
    rows.push({ key: '   ', value: 'orphan', children: [] });
    expect(arrayToConstants(rows)).toEqual({ A: '1' });
  });

  it('emptying a parent does not resurrect its children', () => {
    const rows = constantsToArray({ GROUP: { A: '1', B: '2' } });
    // the user deleted every child row
    rows[0].children = [];
    const out = arrayToConstants(rows);
    // _orig is the original object : writing it back verbatim would undo the deletion
    expect(out.GROUP).not.toEqual({ A: '1', B: '2' });
  });
});

describe('value coercion', () => {
  it('reads the obvious scalars', () => {
    expect(coerceConstantValue('true')).toBe(true);
    expect(coerceConstantValue('false')).toBe(false);
    expect(coerceConstantValue('null')).toBe(null);
    expect(coerceConstantValue('42')).toBe(42);
    expect(coerceConstantValue('1.5')).toBe(1.5);
  });

  it('leaves anything whose text would not round-trip as a string', () => {
    for (const s of ['007', '1e5', '1.10', '+1', ' 42', '42 ', '0x10']) {
      expect(coerceConstantValue(s), `${s} must stay a string`).toBe(s);
    }
  });

  it('parses json objects and arrays, and keeps malformed json as text', () => {
    expect(coerceConstantValue('{"a":1}')).toEqual({ a: 1 });
    expect(coerceConstantValue('[1,2]')).toEqual([1, 2]);
    expect(coerceConstantValue('{not json')).toBe('{not json');
  });
});

// A constant is not only a key/value pair : config.yaml is yaml, so a value can be a
// list or a nested object, and forms use those (a list of servers behind $(SERVERS), a
// list of objects feeding an enum). The editors only ever parsed JSON, so a yaml list
// typed into the box was stored as its own SOURCE TEXT - the config saved, the constant
// resolved, and the form got the string "- one\n- two" instead of two items.
describe('structured values', () => {
  it('reads a block list', () => {
    expect(coerceConstantValue('- one\n- two')).toEqual(['one', 'two']);
  });

  it('reads a list of objects', () => {
    expect(coerceConstantValue('- name: a\n  id: 1\n- name: b\n  id: 2')).toEqual([
      { name: 'a', id: 1 },
      { name: 'b', id: 2 },
    ]);
  });

  it('reads a block map, which the tree then shows as subkeys', () => {
    expect(coerceConstantValue('host: srv1\nport: 8080')).toEqual({ host: 'srv1', port: 8080 });
  });

  it('reads yaml flow style, not only json', () => {
    // {a: 1} is not json : JSON.parse threw and the whole thing was kept as a string
    expect(coerceConstantValue('{a: 1}')).toEqual({ a: 1 });
    expect(coerceConstantValue('[one, two]')).toEqual(['one', 'two']);
  });

  it('still reads json, which is what the box accepted before', () => {
    expect(coerceConstantValue('{"a":1}')).toEqual({ a: 1 });
    expect(coerceConstantValue('[1,2]')).toEqual([1, 2]);
  });

  it('keeps a multi-line STRING as it was typed', () => {
    // yaml folds this into one line, and taking that would rewrite the value : only a
    // list or a map is taken from the parse
    const text = 'first line\nsecond line';
    expect(coerceConstantValue(text)).toBe(text);
  });

  it('keeps a single line that merely contains a colon', () => {
    expect(coerceConstantValue('note: not a map')).toBe('note: not a map');
  });

  it('round-trips a list through the editor untouched', () => {
    const original = { SERVERS: ['srv1', 'srv2'], MATRIX: [{ name: 'a', tags: ['x'] }] };
    expect(arrayToConstants(constantsToArray(original))).toEqual(original);
  });

  it('round-trips a list that WAS edited, through display and back', () => {
    const rows = constantsToArray({ SERVERS: ['srv1', 'srv2'] });
    // the display is what sits in the box : re-reading it must give the list back
    expect(coerceConstantValue(rows[0].value)).toEqual(['srv1', 'srv2']);
    rows[0].value += '\n- srv3';
    expect(arrayToConstants(rows).SERVERS).toEqual(['srv1', 'srv2', 'srv3']);
  });

  it('shows a list as yaml, not as one line of json', () => {
    expect(constantValueDisplay(['srv1', 'srv2'])).toBe('- srv1\n- srv2');
    expect(constantValueDisplay([])).toBe('[]');
    // a map is still empty : the tree renders it as subkey rows
    expect(constantValueDisplay({ a: 1 })).toBe('');
  });
});

// A broken list stored as its own text is the failure this prevents : it saves, it
// resolves, and it is a string. The editors refuse the save and name the key instead.
describe('reporting an unreadable value', () => {
  it('reports yaml that cannot be parsed', () => {
    expect(constantValueError('- a\n- b\n  c: 1')).toBeTruthy(); // indentation
    expect(constantValueError('[1, 2')).toBeTruthy(); // never closed
    expect(constantValueError('{not: yaml: at all}')).toBeTruthy();
  });

  it('cannot catch yaml that is valid but not what was meant', () => {
    // '- one\n - two' is a LIST OF ONE : yaml folds the indented line into the first
    // item. Nothing can flag that, which is the argument for showing the value back as
    // yaml after a save - the row then reads as what was actually stored.
    expect(constantValueError('- one\n - two\n- three')).toBe(null);
    expect(coerceConstantValue('- one\n - two\n- three')).toEqual(['one - two', 'three']);
  });

  it('is silent about anything that is simply a string', () => {
    for (const s of ['hello', '007', '1.10', 'note: not a map', 'first\nsecond']) {
      expect(constantValueError(s), `${s} is a value, not an error`).toBe(null);
    }
  });

  it('is silent about a value it can read', () => {
    expect(constantValueError('- one\n- two')).toBe(null);
    expect(constantValueError('{"a":1}')).toBe(null);
    expect(constantValueError('')).toBe(null);
  });
});

describe('the value box height', () => {
  it('stays a single line for a plain value, so it reads as an input', () => {
    expect(constantValueRows('hello')).toBe(1);
    expect(constantValueRows('')).toBe(1);
    expect(constantValueRows(undefined)).toBe(1);
  });

  it('grows to fit a structure, but not without limit', () => {
    expect(constantValueRows('- a\n- b')).toBe(3);
    expect(constantValueRows(Array.from({ length: 6 }, (_, i) => `- ${i}`).join('\n'))).toBe(6);
    expect(constantValueRows(Array.from({ length: 40 }, (_, i) => `- ${i}`).join('\n'))).toBe(12);
  });
});

describe('flattenConstants', () => {
  it('returns the ORIGINAL row objects, so indexOf and mutation work', () => {
    const rows = constantsToArray({ GROUP: { A: '1' } });
    const flat = flattenConstants(rows);
    expect(flat.map((f) => f.depth)).toEqual([0, 1]);
    expect(flat[0].row).toBe(rows[0]);
    expect(flat[1].row).toBe(rows[0].children[0]);
  });
});
