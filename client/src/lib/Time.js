// Dates and times in the time zone the user picked (Profile > Preferences).
//
// Every server timestamp arrives as an ISO string with its zone - 'Z' for the database
// columns, an explicit offset for the dates the server already put in LOG_TZ (backups) -
// so it can be converted to any zone without guessing. The preference is 'UTC' (the
// default, how the jobs page always showed its times), 'browser' (this browser's own zone)
// or an IANA zone name ('Europe/Madrid').
//
// A time is shown with its zone's short name after it (2026-10-12 09:00:00 CEST), so a date
// on any page says which clock it is on. A date alone (a pattern without hours) has none.
//
// format() only ever returns a formatted date string or '' : never its input. BsDataTable
// renders a column's render() result as HTML, so a formatter that echoed a value back would
// be an injection sink there.
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useAppStore } from '@/stores/app';

dayjs.extend(utc);
dayjs.extend(timezone);

export const BROWSER = 'browser';
const STORAGE_KEY = 'af_timezone';
const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm:ss';
// The locales asked for a zone's short name, in order : each knows the names of its own
// region only (en-US says EDT but GMT+2 for Madrid, en-GB says CEST, en-IN IST, en-AU AEDT).
// The first real name wins ; a zone none of them names (Tokyo, Sao Paulo) keeps its offset.
const ZONE_NAME_LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-AU'];
const zoneNames = new Map();

const Time = {
  // this browser's own zone, e.g. Europe/Madrid
  browserZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  },
  // the preference as stored : 'UTC', 'browser' or a zone name. From the store, so a change
  // re-renders the pages ; without an active store (unit tests, code that runs before the
  // app is mounted) from the browser storage, and else UTC
  preference() {
    try {
      return useAppStore().timezone || 'UTC';
    } catch {
      try {
        return localStorage.getItem(STORAGE_KEY) || 'UTC';
      } catch {
        return 'UTC';
      }
    }
  },
  // the zone the preference stands for
  zone() {
    const pref = Time.preference();
    return pref === BROWSER ? Time.browserZone() : pref;
  },
  setPreference(value) {
    try {
      useAppStore().timezone = value;
    } catch {
      // no active store : the stored value below is read instead
    }
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // storage unavailable : the choice holds for this visit
    }
  },
  // every zone this browser knows, for the picker
  zones() {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  },
  /**
   * The short name of a zone at a moment : CEST, BST, IST, EDT, UTC, or GMT+9 for a zone no
   * locale names. The moment matters : summer and winter have different names.
   *
   * Args:
   *   date (Date): the moment.
   *   zone (string): an IANA zone name.
   *
   * Returns:
   *   string: the short name, or '' when the zone is unknown.
   */
  zoneName(date, zone) {
    if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
    // the offset at that moment, so a zone is asked once per season, not once per date
    const key = `${zone}|${dayjs(date).tz(zone).utcOffset()}`;
    if (zoneNames.has(key)) return zoneNames.get(key);
    let name = '';
    for (const locale of ZONE_NAME_LOCALES) {
      try {
        const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
          .formatToParts(date)
          .find((p) => p.type === 'timeZoneName');
        if (!part) continue;
        if (!name) name = part.value;
        if (!/^GMT[+-]/.test(part.value)) {
          name = part.value;
          break;
        }
      } catch {
        // an unknown zone : no name
        break;
      }
    }
    zoneNames.set(key, name);
    return name;
  },
  /**
   * A server timestamp in the user's zone, with the zone's short name after a time.
   *
   * Args:
   *   value (string|Date|number): an ISO string with its zone, a Date or epoch ms.
   *   pattern (string): the dayjs pattern ; one with hours gets the zone's name.
   *
   * Returns:
   *   string: the formatted date, or '' (never the input).
   */
  format(value, pattern = DEFAULT_FORMAT) {
    if (value === null || value === undefined || value === '') return '';
    const d = dayjs(value);
    if (!d.isValid()) return '';
    const withZone = /[Hh]/.test(pattern);
    try {
      const zone = Time.zone();
      const text = d.tz(zone).format(pattern);
      const name = withZone ? Time.zoneName(d.toDate(), zone) : '';
      return name ? `${text} ${name}` : text;
    } catch {
      // an unknown zone name (hand-edited storage) : fall back to UTC rather than nothing
      return d.utc().format(pattern) + (withZone ? ' UTC' : '');
    }
  },
};

export default Time;
