// The form engine shared with the server (server/src/lib/formEngine, imported as @engine)
// against the browser helpers. Helpers.buildFormOutput and getFieldValue delegate to the
// engine since 6.4.1 ; these keep the browser's callers pinned to what the engine returns.
import { describe, it, expect } from 'vitest';
import * as engine from '@engine/index.js';
import Helpers from '@/lib/Helpers.js';

const subforms = [
  { name: 'disk', type: 'subform', fields: [
    { name: 'size', type: 'number', model: 'spec.size' },
    { name: 'tier', type: 'enum', valueColumn: 'name' },
  ] },
];

const fields = [
  { name: 'cluster', type: 'enum', valueColumn: 'name' },
  { name: 'name', type: 'text', model: ['volume.name', 'meta.label'] },
  { name: 'size', type: 'number', model: 'volume.size' },
  { name: 'secret', type: 'password' },
  { name: 'hidden', type: 'text' },
  { name: 'nooutput', type: 'text', output: false },
  { name: 'data', type: 'expression' },
  { name: 'when', type: 'datetime', dateType: 'month' },
  { name: 'disks', type: 'list', subform: 'disk' },
  { name: 'picked', type: 'enum', multiple: true, valueColumn: 'id' },
];

const raw = {
  cluster: { name: 'c1', ip: '10.0.0.1' },
  name: 'vol1',
  size: 10,
  secret: 's3cr3t',
  hidden: 'not sent',
  nooutput: 'x',
  data: { a: [1, 2] },
  when: { year: 2026, month: 8 },
  disks: [{ size: 5, tier: { name: 'gold', id: 1 } }, { size: 7, tier: { name: 'silver', id: 2 } }],
  picked: [{ id: 1 }, { id: 2 }],
};

describe('@engine is importable in the browser build', () => {
  it('exposes the browser-safe surface and nothing node-only', () => {
    for (const name of ['buildFormOutput', 'replacePlaceholderInString', 'checkDependencies', 'req', 'requiredReq', 'humanFileSize']) {
      expect(typeof engine[name]).toBe('function');
    }
    expect(engine.sha256).toBeUndefined();
    expect(engine.evalSandbox).toBeUndefined();
  });
});

describe('engine mirrors of client/src/lib/Helpers.js', () => {
  it('buildFormOutput models the same extravars', () => {
    const isVisible = (f) => f.name !== 'hidden';
    const opts = { isVisible, subforms };
    expect(engine.buildFormOutput(fields, raw, opts)).toEqual(Helpers.buildFormOutput(fields, raw, opts));
  });

  it('getFieldValue reads the same column', () => {
    const cases = [
      [{ name: 'c1', ip: 'x' }, 'name', false],
      [{ name: 'c1', ip: 'x' }, '', false],
      [[{ name: 'a' }, { name: 'b' }], 'name', true],
      [[{ name: 'a' }], 'name', false],
      ['__auto__', '', false],
      ['plain', '', false],
    ];
    for (const [v, col, keep] of cases) {
      expect(engine.getFieldValue(v, col, keep)).toEqual(Helpers.getFieldValue(v, col, keep));
    }
  });

  it('humanFileSize formats the same', () => {
    for (const n of [undefined, 0, 1, 1023, 1024, 1536, 5 * 1024 * 1024, 3 * 1024 ** 3]) {
      expect(engine.humanFileSize(n)).toBe(Helpers.humanFileSize(n));
    }
  });
});
