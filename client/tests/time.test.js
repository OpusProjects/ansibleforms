// Dates in the user's time zone (lib/Time.js), and Helpers.formatServerDate which uses it.
//
// The server sends ISO strings with their zone : 'Z' for database columns, an explicit offset
// for the dates it already put in LOG_TZ (backups). Those convert exactly to whatever zone the
// user picked. A string without a zone cannot be placed in time, so its wall clock is shown as
// written. Neither formatter may ever echo its input : BsDataTable renders a column's render()
// result as HTML.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import Time, { BROWSER } from '@/lib/Time';
import Helpers from '@/lib/Helpers';

// no pinia store in these tests : Time reads the preference from the browser storage, which
// the test environment does not provide - a small in-memory one stands in for it
const storage = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
});

function prefer(zone) {
  localStorage.setItem('af_timezone', zone);
}

describe('Time.format', () => {
  beforeEach(() => localStorage.removeItem('af_timezone'));

  test('shows UTC when nothing is picked', () => {
    expect(Time.format('2026-10-06T00:23:03.000Z')).toBe('2026-10-06 00:23:03 UTC');
  });

  test('converts to the picked zone', () => {
    prefer('Europe/Madrid'); // UTC+2 in October
    expect(Time.format('2026-10-06T00:23:03.000Z')).toBe('2026-10-06 02:23:03 CEST');
    prefer('America/New_York'); // UTC-4 in October : the day changes
    expect(Time.format('2026-10-06T00:23:03.000Z')).toBe('2026-10-05 20:23:03 EDT');
  });

  test('honours an explicit offset in the input', () => {
    // a backup date the server put in LOG_TZ = Europe/Madrid
    expect(Time.format('2026-07-26T02:21:46.000+02:00')).toBe('2026-07-26 00:21:46 UTC');
  });

  test('"browser" follows the browser zone', () => {
    prefer(BROWSER);
    expect(Time.zone()).toBe(Time.browserZone());
  });

  test('takes a pattern, a Date and epoch milliseconds', () => {
    expect(Time.format('2026-10-06T00:23:03Z', 'HH:mm')).toBe('00:23 UTC');
    // a date alone has no zone name
    expect(Time.format('2026-10-06T00:23:03Z', 'YYYY-MM-DD')).toBe('2026-10-06');
    expect(Time.format(new Date('2026-10-06T00:23:03Z'))).toBe('2026-10-06 00:23:03 UTC');
    expect(Time.format(Date.UTC(2026, 9, 6, 0, 23, 3))).toBe('2026-10-06 00:23:03 UTC');
  });

  test('an unknown zone falls back to UTC instead of failing', () => {
    prefer('Not/AZone');
    expect(Time.format('2026-10-06T00:23:03Z')).toBe('2026-10-06 00:23:03 UTC');
  });

  test('names the zone the way its own region does, and its season', () => {
    const d = (iso) => new Date(iso);
    expect(Time.zoneName(d('2026-10-06T12:00:00Z'), 'Europe/Madrid')).toBe('CEST');
    expect(Time.zoneName(d('2026-01-06T12:00:00Z'), 'Europe/Madrid')).toBe('CET');
    expect(Time.zoneName(d('2026-07-06T12:00:00Z'), 'Europe/London')).toBe('BST');
    expect(Time.zoneName(d('2026-10-06T12:00:00Z'), 'Asia/Kolkata')).toBe('IST');
    expect(Time.zoneName(d('2026-01-06T12:00:00Z'), 'America/Los_Angeles')).toBe('PST');
    expect(Time.zoneName(d('2026-01-06T12:00:00Z'), 'Australia/Sydney')).toBe('AEDT');
    // no locale names it : its offset
    expect(Time.zoneName(d('2026-10-06T12:00:00Z'), 'Asia/Tokyo')).toBe('GMT+9');
    expect(Time.zoneName(d('2026-10-06T12:00:00Z'), 'UTC')).toBe('UTC');
  });

  test('never echoes what it cannot read', () => {
    expect(Time.format('')).toBe('');
    expect(Time.format(null)).toBe('');
    expect(Time.format('<img src=x onerror=alert(1)>')).toBe('');
  });
});

describe('Helpers.formatServerDate', () => {
  beforeEach(() => prefer('Europe/Madrid'));

  test('converts zoned timestamps to the user zone', () => {
    expect(Helpers.formatServerDate('2026-10-06T00:23:03.000Z')).toBe('2026-10-06 02:23:03 CEST');
    expect(Helpers.formatServerDate('2026-07-26T02:21:46.000+02:00')).toBe('2026-07-26 02:21:46 CEST');
  });

  test('keeps the wall clock of a timestamp without a zone', () => {
    expect(Helpers.formatServerDate('2026-07-26 00:21:46')).toBe('2026-07-26 00:21:46');
  });

  test('never echoes its input', () => {
    expect(Helpers.formatServerDate('<img src=x onerror=alert(1)>')).toBe('');
    expect(Helpers.formatServerDate('')).toBe('');
  });
});
