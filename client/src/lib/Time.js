// Dates and times in the time zone the user picked (Profile > Preferences).
//
// Every server timestamp arrives as an ISO string with its zone - 'Z' for the database
// columns, an explicit offset for the dates the server already put in LOG_TZ (backups) -
// so it can be converted to any zone without guessing. The preference is 'UTC' (the
// default, how the jobs page always showed its times), 'browser' (this browser's own zone)
// or an IANA zone name ('Europe/Madrid').
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
  // a server timestamp (ISO string, Date or epoch ms) in the user's zone
  format(value, pattern = DEFAULT_FORMAT) {
    if (value === null || value === undefined || value === '') return '';
    const d = dayjs(value);
    if (!d.isValid()) return '';
    try {
      return d.tz(Time.zone()).format(pattern);
    } catch {
      // an unknown zone name (hand-edited storage) : fall back to UTC rather than nothing
      return d.utc().format(pattern);
    }
  },
};

export default Time;
