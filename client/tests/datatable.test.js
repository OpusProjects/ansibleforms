// The pure parts of BsDataTable : the number filter and the CSV export cells.
import { describe, it, expect } from 'vitest';
import { parseNumberFilter, csvCell } from '../src/lib/dataTable.js';

describe('the number filter', () => {
  const pass = (expr, v) => parseNumberFilter(expr)(v);

  it('compares', () => {
    expect(pass('>50', 51)).toBe(true);
    expect(pass('>50', 50)).toBe(false);
    expect(pass('>=50', 50)).toBe(true);
    expect(pass('<20', 19)).toBe(true);
    expect(pass('<=20', 21)).toBe(false);
  });

  it('a bare number means equals, comma decimals included', () => {
    expect(pass('36', 36)).toBe(true);
    expect(pass('36,00', 36)).toBe(true);
    expect(pass('=0', 0)).toBe(true);
    expect(pass('36', 37)).toBe(false);
  });

  it('a range, in either order', () => {
    expect(pass('10-50', 10)).toBe(true);
    expect(pass('50-10', 30)).toBe(true);
    expect(pass('10-50', 51)).toBe(false);
  });

  it('anything else is not a number filter, so the text filter applies', () => {
    expect(parseNumberFilter('abc')).toBe(null);
    expect(parseNumberFilter('')).toBe(null);
    expect(parseNumberFilter('>')).toBe(null);
  });
});

describe('a CSV cell', () => {
  it('quotes what needs quoting', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  it('shows the text, not the escaped html', () => {
    expect(csvCell('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });

  it('never lets a cell run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('a negative number stays a number', () => {
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('-5.25')).toBe('-5.25');
    expect(csvCell('-cmd')).toBe("'-cmd");
  });
});
