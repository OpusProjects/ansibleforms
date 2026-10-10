import { describe, it, expect } from 'vitest';
import { describeCron } from '../src/config/cronDescribe.js';

describe('describeCron', () => {
  it('says every day for a cron at set times on every day', () => {
    expect(describeCron('0 2 * * *')).toBe('At 02:00 AM, every day');
    expect(describeCron('0 2,14 * * *')).toMatch(/, every day$/);
    expect(describeCron('0 0 2 * * *')).toMatch(/, every day$/);
  });

  it('says it in the app language', () => {
    expect(describeCron('0 2 * * *', 'de')).toMatch(/, jeden Tag$/);
    expect(describeCron('0 2 * * *', 'es')).toMatch(/, todos los días$/);
  });

  it('adds nothing to a cron that is not daily', () => {
    expect(describeCron('0 6 * * 0')).not.toMatch(/every day/);
    expect(describeCron('*/5 * * * *')).not.toMatch(/every day/);
    expect(describeCron('30 */2 * * *')).not.toMatch(/every day/);
    expect(describeCron('0 2 1 * *')).not.toMatch(/every day/);
  });

  it('describes nothing for an empty or invalid cron', () => {
    expect(describeCron('')).toBe('');
    expect(describeCron('not a cron')).toBe('');
  });
});

describe('describeCron in English, as a repeating schedule reads', () => {
  it('says weekdays in the plural, in the week order', () => {
    expect(describeCron('0 6 * * 0')).toBe('At 06:00 AM, on Sundays');
    expect(describeCron('0 6 * * 1,3,5')).toBe('At 06:00 AM, on Mondays, Wednesdays, and Fridays');
    expect(describeCron('0 22 * * 6,0')).toBe('At 10:00 PM, on Saturdays and Sundays');
  });

  it('says a whole hour interval simply', () => {
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hours');
    expect(describeCron('30 */2 * * *')).toBe('At 30 minutes past the hour, every 2 hours');
  });

  it('says every day in a month, without only', () => {
    expect(describeCron('0 4 * 1 *')).toBe('At 04:00 AM, every day, in January');
    expect(describeCron('0 0 1 1 *')).toBe('At 12:00 AM, on day 1 of the month, in January');
  });

  it('says days of the month in the plural', () => {
    expect(describeCron('0 3 1,15 * *')).toBe('At 03:00 AM, on days 1 and 15 of the month');
    expect(describeCron('0 3 1 * *')).toBe('At 03:00 AM, on day 1 of the month');
  });

  it('keeps the rest', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('At 09:00 AM, Monday through Friday');
    expect(describeCron('0 2 * * 1#1')).toBe('At 02:00 AM, on the first Monday of the month');
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
  });
});
