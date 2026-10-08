<script>
/******************************************************************/
/*                                                                */
/*  Bootstrap Cron editor component                               */
/*                                                                */
/*  Imports and module-scope state live in this plain block so    */
/*  the scheduler timezone is resolved once per page load and     */
/*  shared by every BsCron instance.                              */
/*                                                                */
/******************************************************************/

import axios from 'axios';

// The server registers cron jobs in its own timezone (LOG_TZ, exposed as
// `logTz` on the unauthenticated app config endpoint). Previewing the next runs
// in the browser zone would show a different wall clock than the one the job
// actually fires at, so resolve the server zone once and share the result with
// every instance instead of refetching per mount.
let resolvedTimeZone; // undefined until resolved, then string or null
let timeZoneRequest = null;

function loadServerTimeZone() {
  if (resolvedTimeZone !== undefined) return Promise.resolve(resolvedTimeZone);
  if (!timeZoneRequest) {
    timeZoneRequest = axios
      .get('/api/v2/app/config')
      .then((res) => {
        resolvedTimeZone = res.data?.logTz || null;
        return resolvedTimeZone;
      })
      .catch(() => {
        resolvedTimeZone = null;
        return null;
      }); // fall back to the browser zone
  }
  return timeZoneRequest;
}
</script>
<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { normalizeParts, cronValidationMessage } from '@/config/cron';

const { t, locale } = useI18n();
const emit = defineEmits(['update:modelValue']);

const props = defineProps({
  modelValue: { type: String, default: '' },
  hasError: { type: Boolean, default: false },
  icon: { type: String, default: 'stopwatch' },
});

// Zone the badges are computed and rendered in: the server's scheduler zone when
// known, the browser zone until (or unless) that is available.
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverTimeZone = ref(resolvedTimeZone ?? null);
const timeZone = computed(() => serverTimeZone.value || browserTimeZone);

const PRESETS = computed(() => [
  { label: t('settings.cron.preset1min'), cron: '* * * * *' },
  { label: t('settings.cron.preset5min'), cron: '*/5 * * * *' },
  { label: t('settings.cron.preset15min'), cron: '*/15 * * * *' },
  { label: t('settings.cron.preset30min'), cron: '*/30 * * * *' },
  { label: t('settings.cron.preset1hour'), cron: '0 * * * *' },
  { label: t('settings.cron.preset6hours'), cron: '0 */6 * * *' },
  { label: t('settings.cron.preset12hours'), cron: '0 */12 * * *' },
  { label: t('settings.cron.presetDaily'), cron: '0 0 * * *' },
  { label: t('settings.cron.presetWeekly'), cron: '0 0 * * 1' },
  { label: t('settings.cron.presetMonthly'), cron: '0 0 1 * *' },
]);

// croner accepts 5 fields (minute..weekday) and 6 with a leading seconds field,
// so a 6-field value has to survive the round trip. Reading it as 5 fields would
// shift every field one position left and destroy the schedule on first edit.
const segments = computed(() => {
  const raw = (props.modelValue || '').trim();
  const parts = raw ? raw.split(/\s+/) : [];
  const hasSeconds = parts.length > 5;
  const offset = hasSeconds ? 1 : 0;
  const at = (i) => parts[i + offset] || '*';
  return {
    hasSeconds,
    second: hasSeconds ? parts[0] || '*' : null,
    minute: at(0),
    hour: at(1),
    dom: at(2),
    month: at(3),
    dow: at(4),
  };
});

function serialize(s) {
  const core = `${s.minute} ${s.hour} ${s.dom} ${s.month} ${s.dow}`;
  return s.hasSeconds ? `${s.second} ${core}` : core;
}

function updateSegment(key, val) {
  // Every segment must stay exactly one token: an emptied box falls back to
  // '*' and pasted/typed whitespace is collapsed. Emitting a blank segment
  // would drop a field, shifting every later field one position left into a
  // different - but still valid - schedule.
  const token =
    String(val ?? '')
      .trim()
      .split(/\s+/)[0] || '*';
  emit('update:modelValue', serialize({ ...segments.value, [key]: token }));
}

// The '*' fallback above is itself a listed option, so an emptied box would flip
// segmentIsCustom back to false and swap the text input for the dropdown while it
// still has focus - and would also redraw the box with a '*' the user did not
// type. Keeping the raw text of the segment being edited avoids both: it holds
// the box in custom mode and shows what was typed until focus leaves.
const segmentDrafts = ref({});

function editSegment(key, val) {
  segmentDrafts.value = { ...segmentDrafts.value, [key]: val };
  updateSegment(key, val);
}

function commitSegment(key) {
  if (!(key in segmentDrafts.value)) return;
  const drafts = { ...segmentDrafts.value };
  delete drafts[key];
  segmentDrafts.value = drafts;
}

function applyPreset(cron) {
  segmentDrafts.value = {};
  emit('update:modelValue', cron);
}

const isActivePreset = computed(() => {
  const v = (props.modelValue || '').trim();
  return (cron) => v === cron;
});

// Validation, name normalisation and the field bounds live in config/cron.js : the SAVE
// validator on the repositories and schedules pages needs exactly the same
// answer, and when it was a separate hand written regex the two disagreed - an inverted
// range saved and then silently never fired, and a weekday NAME previewed here as valid
// could not be saved at all. One implementation, two callers.
const expressionError = computed(() => cronValidationMessage(t, props.modelValue));

// Locale-aware short names, derived the same way as the next-run badges
// (Intl.DateTimeFormat) so the whole widget follows the active language.
// Values stay numeric ('0'-'6', '1'-'12'); only the display labels localize.
const monthNames = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { month: 'short' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2021, i, 1)));
});
const dowNames = computed(() => {
  // 2021-08-01 is a Sunday, so index 0..6 maps to Sun..Sat (getDay() order).
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2021, 7, 1 + i)));
});

const minuteOptions = computed(() => [
  { value: '*', label: t('settings.cron.every') },
  { value: '*/2', label: t('settings.cron.everyN', { n: 2 }) },
  { value: '*/5', label: t('settings.cron.everyN', { n: 5 }) },
  { value: '*/10', label: t('settings.cron.everyN', { n: 10 }) },
  { value: '*/15', label: t('settings.cron.everyN', { n: 15 }) },
  { value: '*/20', label: t('settings.cron.everyN', { n: 20 }) },
  { value: '*/30', label: t('settings.cron.everyN', { n: 30 }) },
  { value: '0', label: ':00' },
  { value: '5', label: ':05' },
  { value: '10', label: ':10' },
  { value: '15', label: ':15' },
  { value: '20', label: ':20' },
  { value: '25', label: ':25' },
  { value: '30', label: ':30' },
  { value: '35', label: ':35' },
  { value: '40', label: ':40' },
  { value: '45', label: ':45' },
  { value: '50', label: ':50' },
  { value: '55', label: ':55' },
]);
const hourOptions = computed(() => [
  { value: '*', label: t('settings.cron.every') },
  { value: '*/2', label: t('settings.cron.everyN', { n: 2 }) },
  { value: '*/3', label: t('settings.cron.everyN', { n: 3 }) },
  { value: '*/4', label: t('settings.cron.everyN', { n: 4 }) },
  { value: '*/6', label: t('settings.cron.everyN', { n: 6 }) },
  { value: '*/8', label: t('settings.cron.everyN', { n: 8 }) },
  { value: '*/12', label: t('settings.cron.everyN', { n: 12 }) },
  ...Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') })),
]);
const domOptions = computed(() => [
  { value: '*', label: t('settings.cron.every') },
  ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
  { value: 'L', label: t('settings.cron.lastShort') },
]);
const monthOptions = computed(() => [
  { value: '*', label: t('settings.cron.every') },
  ...monthNames.value.map((m, i) => ({ value: String(i + 1), label: m })),
]);
const dowOptions = computed(() => [
  { value: '*', label: t('settings.cron.every') },
  ...dowNames.value.map((d, i) => ({ value: String(i), label: d })),
]);

const segmentIsCustom = computed(() => {
  const drafts = segmentDrafts.value;
  const check = (key, opts) => key in drafts || !opts.some((o) => o.value === segments.value[key]);
  return {
    minute: check('minute', minuteOptions.value),
    hour: check('hour', hourOptions.value),
    dom: check('dom', domOptions.value),
    month: check('month', monthOptions.value),
    dow: check('dow', dowOptions.value),
  };
});

// What the boxes show: the raw draft of the segment being edited, the parsed
// segment for all the others.
const segmentValues = computed(() => {
  const drafts = segmentDrafts.value;
  const pick = (key) => (key in drafts ? drafts[key] : segments.value[key]);
  return {
    second: pick('second'),
    minute: pick('minute'),
    hour: pick('hour'),
    dom: pick('dom'),
    month: pick('month'),
    dow: pick('dow'),
  };
});

const humanDescription = computed(() => {
  const v = (props.modelValue || '').trim();
  if (!v || expressionError.value) return '';
  const all = v.split(/\s+/);
  const sec = all.length === 6 ? all[0] : null;
  const [min, hr, dom, mon, dow] = normalizeParts(all);

  // Wildcard check
  if (sec === null && all.every((p) => p === '*')) return t('settings.cron.everyMinute');

  let pieces = [];

  // Time part - a repeating seconds field already implies "every minute"
  const secEvery = sec !== null && (sec === '*' || sec.startsWith('*/'));
  if (secEvery) {
    pieces.push(sec === '*' ? t('settings.cron.everySecond') : t('settings.cron.everyNSeconds', { n: sec.slice(2) }));
  }
  if (min === '*' && hr === '*') {
    if (!secEvery) pieces.push(t('settings.cron.everyMinute'));
  } else if (min.startsWith('*/')) {
    pieces.push(t('settings.cron.everyNMinutes', { n: min.slice(2) }));
    // the hour restriction still applies to a repeating minute field
    if (hr.startsWith('*/')) {
      pieces.push(t('settings.cron.everyNHours', { n: hr.slice(2) }));
    } else if (hr !== '*') {
      pieces.push(t('settings.cron.atHour', { hr }));
    }
  } else if (hr.startsWith('*/')) {
    // a wildcard minute fires 60 times per matching hour, so it has to be
    // named: only a fixed minute 0 is implied by "every N hours"
    if (min === '*' && !secEvery) pieces.push(t('settings.cron.everyMinute'));
    pieces.push(t('settings.cron.everyNHours', { n: hr.slice(2) }));
    if (min !== '0' && min !== '*') pieces.push(t('settings.cron.atMinute', { min }));
  } else if (hr !== '*' && min !== '*') {
    pieces.push(t('settings.cron.atTime', { hr: hr.padStart(2, '0'), min: min.padStart(2, '0') }));
  } else if (hr !== '*') {
    if (!secEvery) pieces.push(t('settings.cron.everyMinute'));
    pieces.push(t('settings.cron.atHour', { hr }));
  } else if (min !== '*') {
    pieces.push(t('settings.cron.atMinute', { min }));
  }
  if (sec !== null && !secEvery && sec !== '0') {
    pieces.push(t('settings.cron.atSecond', { sec }));
  }

  // Day of month - croner strips every 'L' from the field and matches the last
  // day of the month in addition to whatever remains ('15L' -> 15 or the last)
  let domPiece = null;
  if (dom !== '*') {
    const bare = dom.replace(/L/gi, '');
    domPiece = [
      bare === '' ? null : t('settings.cron.onDay', { day: bare }),
      bare === dom ? null : t('settings.cron.lastDayOfMonth'),
    ]
      .filter(Boolean)
      .join(` ${t('settings.cron.or')} `);
  }

  // Day of week
  let dowPiece = null;
  if (dow !== '*') {
    // croner treats 7 as Sunday (same index as 0)
    const dowName = (val) => {
      const n = parseInt(val);
      if (n === 7) return dowNames.value[0];
      return n >= 0 && n <= 6 ? dowNames.value[n] : val;
    };
    const names = dow.split(',').map((part) => {
      // step ('a-b/s' or '*/s'): leave raw, ranges/steps don't name cleanly
      if (part.includes('/')) return part;
      // nth ('1#2') or last ('5L') occurrence of the weekday in the month
      let token = part;
      let suffix = '';
      if (token.includes('#')) {
        const nth = token.split('#')[1];
        token = token.split('#')[0];
        // croner ignores an empty nth, so '1#' is just '1'
        if (nth) suffix = /^L$/i.test(nth) ? ` (${t('settings.cron.last')})` : ` #${nth}`;
      } else if (/L$/i.test(token)) {
        token = token.slice(0, -1);
        suffix = ` (${t('settings.cron.last')})`;
      }
      // plain range 'a-b': name both ends
      if (token.includes('-')) {
        const [a, b] = token.split('-');
        return `${dowName(a)}-${dowName(b)}${suffix}`;
      }
      return `${dowName(token)}${suffix}`;
    });
    dowPiece = t('settings.cron.onWeekday', { day: names.join(', ') });
  }

  // when both day fields are restricted, cron fires when EITHER matches
  if (domPiece && dowPiece) {
    pieces.push(`${domPiece} ${t('settings.cron.or')} ${dowPiece}`);
  } else if (domPiece) {
    pieces.push(domPiece);
  } else if (dowPiece) {
    pieces.push(dowPiece);
  }

  // Month
  if (mon !== '*') {
    const monName = (val) => {
      const n = parseInt(val);
      return n >= 1 && n <= 12 ? monthNames.value[n - 1] : val;
    };
    const names = mon.split(',').map((part) => {
      // step ('a-b/s' or '*/s'): leave raw
      if (part.includes('/')) return part;
      // plain range 'a-b': name both ends
      if (part.includes('-')) {
        const [a, b] = part.split('-');
        return `${monName(a)}-${monName(b)}`;
      }
      return monName(part);
    });
    pieces.push(t('settings.cron.inMonth', { month: names.join(', ') }));
  }

  return pieces.join(', ');
});

// A "wall clock" below is a millisecond value whose UTC fields hold the local
// date and time of the scheduler zone, i.e. exactly what a cron pattern matches
// on. Only the handful of runs that end up on screen are converted back to real
// instants, so the scan itself never pays for an Intl lookup.
let zoneFmt = null;
let zoneFmtTz;

function zoneFormatter(tz) {
  if (zoneFmtTz !== tz) {
    zoneFmtTz = tz;
    try {
      zoneFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      zoneFmt = null; // unknown zone: fall back to the browser's own clock
    }
  }
  return zoneFmt;
}

// Wall clock shown in `tz` at real instant `ms`.
function wallClockAt(ms, tz) {
  const fmt = zoneFormatter(tz);
  if (!fmt) return ms - new Date(ms).getTimezoneOffset() * 60000;
  const p = fmt.formatToParts(new Date(ms)).reduce((acc, x) => {
    acc[x.type] = x.value;
    return acc;
  }, {});
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

// Real instant a wall clock in `tz` refers to. Away from a DST transition the
// first guess already lands on it. Next to one, the two offsets in play give two
// candidates: when the clock went backwards both are real and the earlier one is
// taken, and when it jumped forward neither is - that wall clock never happened,
// so it is resolved with the offset from before the jump, which lands on the hour
// the clock jumped to. croner reports those runs the same way.
function instantFromWallClock(wall, tz) {
  const offset = (ms) => wallClockAt(ms, tz) - ms;
  const before = offset(wall);
  const candidate = wall - before;
  const after = offset(candidate);
  if (after === before) return candidate;
  const valid = [candidate, wall - after].filter((ms) => wallClockAt(ms, tz) === wall);
  return valid.length ? Math.min(...valid) : wall - Math.min(before, after);
}

// Wall clock "now", floored to the second (wallClockAt has second resolution).
function wallClockNow(tz) {
  return wallClockAt(Date.now(), tz);
}

// Every value a single field matches, ascending.
function fieldValues(expr, min, max) {
  const values = [];
  for (let v = min; v <= max; v++) if (matchField(v, expr, min, max)) values.push(v);
  return values;
}

// How far ahead the preview looks. Sparse schedules need real headroom: '0 0 1 1 *'
// spans five years and '0 0 29 2 *' close to twenty, both of which a one-year scan
// reported as "never runs". The scan steps whole days and only visits the matching
// times of a matching day, so the bound costs ~11000 cheap iterations instead of
// the 525600 minutes (never affordable) the previous minute-by-minute walk needed.
const SCAN_YEARS = 30;
const SCAN_DAYS = Math.ceil(SCAN_YEARS * 365.25);
const DAY_MS = 86400000;

// Returns the next `count` runs as real Dates, and whether the scan was cut short
// before finding them (in which case an empty result means "unknown", not "never").
// four : on one line in a dialog
function getNextRuns(cronStr, count = 4) {
  if (!cronStr || !cronStr.trim() || expressionError.value) return { runs: [], truncated: false };
  const all = cronStr.trim().split(/\s+/);
  const [minExpr, hrExpr, domExpr, monExpr, dowExpr] = normalizeParts(all);
  const secExpr = all.length === 6 ? all[0] : null;
  const tz = timeZone.value;

  try {
    // every matching time of day, as an offset from midnight, ascending
    const hours = fieldValues(hrExpr, 0, 23);
    const minutes = fieldValues(minExpr, 0, 59);
    const seconds = secExpr === null ? [0] : fieldValues(secExpr, 0, 59);
    const offsets = [];
    for (const h of hours) {
      for (const m of minutes) {
        for (const s of seconds) offsets.push(h * 3600000 + m * 60000 + s * 1000);
      }
    }
    if (!offsets.length) return { runs: [], truncated: false };

    const now = wallClockNow(tz);
    const first = now + 1000; // the current second has already started
    let day = now - (now % DAY_MS);
    const runs = [];
    // Safety net only: the day walk is cheap enough that this is unreachable
    // in practice, but a truncated scan must not be reported as "never runs".
    const deadline = performance.now() + 50;
    let truncated = false;

    for (let d = 0; d < SCAN_DAYS && runs.length < count; d++) {
      if (matchDate(new Date(day), domExpr, monExpr, dowExpr)) {
        for (const offset of offsets) {
          const wall = day + offset;
          if (wall < first) continue;
          const instant = instantFromWallClock(wall, tz);
          // two wall clocks can collapse onto one instant when a DST
          // forward jump skips an hour the pattern also matches
          if (runs.length && instant <= runs[runs.length - 1].getTime()) continue;
          runs.push(new Date(instant));
          if (runs.length >= count) break;
        }
      }
      day += DAY_MS;
      if ((d & 255) === 0 && performance.now() > deadline) {
        truncated = true;
        break;
      }
    }
    return { runs, truncated };
  } catch {
    return { runs: [], truncated: true };
  }
}

// `date` is a wall-clock pseudo-date (see above), so every field is read with a
// getUTC* accessor.
function matchDate(date, domExpr, monExpr, dowExpr) {
  return matchField(date.getUTCMonth() + 1, monExpr, 1, 12) && matchDayFields(date, domExpr, dowExpr);
}

// Mirrors croner's default (domAndDow: false) / Vixie-cron behavior: when both
// day-of-month and day-of-week are restricted, a match on EITHER field fires.
// When only one is restricted, that one must match; when neither, always true.
function matchDayFields(date, domExpr, dowExpr) {
  const domRestricted = domExpr !== '*';
  const dowRestricted = dowExpr !== '*';
  if (domRestricted && dowRestricted) {
    return matchDom(date, domExpr) || matchDow(date, dowExpr);
  }
  if (domRestricted) return matchDom(date, domExpr);
  if (dowRestricted) return matchDow(date, dowExpr);
  return true;
}

function daysInMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

// croner accepts 7 as Sunday (it maps 7 -> 0 internally, and ranges like '5-7'
// include Sunday). getUTCDay() only reports Sunday as 0, so also test it as 7.
// '1#2' picks the 2nd Monday of the month and '5L' the last Friday: croner's
// isNthWeekdayOfMonth counts how many days of the same weekday precede the date,
// which is ceil(day / 7), and treats 'L' as "no later day of the same weekday
// exists", i.e. the date falls in the final 7 days of its month. Both modifiers
// also apply to a range ('1-5#2'), so they are stripped before matching the value.
function matchDow(date, dowExpr) {
  if (dowExpr === '*') return true;
  const d = date.getUTCDay();
  const dom = date.getUTCDate();
  return dowExpr.split(',').some((part) => {
    let token = part;
    let nth = null;
    if (token.includes('#')) {
      nth = token.split('#')[1] || null; // croner ignores an empty nth
      token = token.split('#')[0];
    } else if (/L$/i.test(token)) {
      nth = 'L';
      token = token.slice(0, -1);
    }
    if (nth !== null) {
      const matchesNth = /^L$/i.test(nth) ? dom > daysInMonth(date) - 7 : Number(nth) === Math.ceil(dom / 7);
      if (!matchesNth) return false;
    }
    if (matchField(d, token, 0, 7)) return true;
    return d === 0 && matchField(7, token, 0, 7);
  });
}

// croner strips every 'L' from the day-of-month field and raises its
// lastDayOfMonth flag, so 'L' matches the last day of the month in addition to
// whatever the rest of the field matches ('15L' -> day 15 or the last day).
function matchDom(date, expr) {
  if (expr === '*') return true;
  const dom = date.getUTCDate();
  if (/L/i.test(expr)) {
    return dom === daysInMonth(date) || matchField(dom, expr.replace(/L/gi, ''), 1, 31);
  }
  return matchField(dom, expr, 1, 31);
}

function matchField(value, expr, min, max) {
  if (expr === '*') return true;
  return expr.split(',').some((part) => {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const s = parseInt(step);
      if (isNaN(s) || s <= 0) return false;
      // '*/s' -> min..max with stride s
      if (range === '*') {
        return value >= min && value <= max && (value - min) % s === 0;
      }
      // 'a-b/s' -> a..b with stride s (upper bound enforced)
      if (range.includes('-')) {
        const [a, b] = range.split('-').map(Number);
        if (isNaN(a) || isNaN(b)) return false;
        return value >= a && value <= b && (value - a) % s === 0;
      }
      // 'a/s' -> croner refuses to compile a numeric stepping prefix, so
      // nothing can ever match it. expressionError() already reports it;
      // this is only a guard for a value that slipped past.
      return false;
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      return value >= a && value <= b;
    }
    // modifiers ('L', '#n') are stripped by matchDom/matchDow before this
    return /^\d+$/.test(part) && Number(part) === value;
  });
}

// nextRuns walks up to 30 years of days per evaluation, so it's stored in a ref
// and refreshed via a debounced watch on modelValue, instead of a computed that
// would re-run the full scan on every keystroke.
const nextRuns = ref([]);
// true while an expression that compiles has no run at all within the scanned
// window - as opposed to a scan that was cut short and simply does not know
const noRunsFound = ref(false);
let nextRunsTimer = null;

function refreshNextRuns() {
  const { runs, truncated } = getNextRuns(props.modelValue);
  nextRuns.value = runs;
  noRunsFound.value = !runs.length && !truncated && !expressionError.value && !!(props.modelValue || '').trim();
}

watch(
  () => props.modelValue,
  () => {
    if (nextRunsTimer) clearTimeout(nextRunsTimer);
    nextRunsTimer = setTimeout(refreshNextRuns, 300);
  },
);

// the scheduler zone arrives asynchronously; recompute once it is known
watch(timeZone, refreshNextRuns);

onMounted(async () => {
  refreshNextRuns();
  serverTimeZone.value = await loadServerTimeZone();
});

// the pending debounce would otherwise run a main-thread scan and write to a
// ref of an unmounted component (closing the admin offcanvas mid-edit)
onUnmounted(() => {
  if (nextRunsTimer) {
    clearTimeout(nextRunsTimer);
    nextRunsTimer = null;
  }
});

const nextRunsLabel = computed(() => t('settings.cron.nextRunsIn', { tz: timeZone.value }));

// A sparse schedule spans years ('0 0 1 1 *' is five consecutive 1 January), where
// a day and month alone would print the very same badge five times.
const showYear = computed(() => {
  const years = nextRuns.value.map((d) => new Date(wallClockAt(d.getTime(), timeZone.value)).getUTCFullYear());
  return new Set(years).size > 1;
});

function formatDate(d) {
  const options = {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(showYear.value ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(segments.value.hasSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  };
  try {
    // `d` is a real instant, so it is rendered in the scheduler's own zone
    return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: timeZone.value }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale.value, options).format(d);
  }
}
</script>
<template>
  <div class="bs-cron">
    <!-- Preset buttons -->
    <div class="cron-presets mb-2">
      <button
        v-for="p in PRESETS"
        :key="p.cron"
        type="button"
        class="btn btn-sm me-1 mb-1"
        :class="isActivePreset(p.cron) ? 'btn-primary' : 'btn-outline-secondary'"
        @click="applyPreset(p.cron)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- Segment editors -->
    <div class="d-flex gap-2 mb-2">
      <!-- only rendered for 6-field expressions; croner allows them but they
                 are advanced, so the value is editable rather than dropped -->
      <div v-if="segments.hasSeconds" class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.second') }}</label>
        <input
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.second"
          @input="editSegment('second', $event.target.value)"
          @blur="commitSegment('second')"
        />
      </div>
      <div class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.minute') }}</label>
        <select
          v-if="!segmentIsCustom.minute"
          class="form-select form-select-sm"
          :value="segments.minute"
          @change="updateSegment('minute', $event.target.value)"
        >
          <option v-for="o in minuteOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.minute"
          @input="editSegment('minute', $event.target.value)"
          @blur="commitSegment('minute')"
        />
      </div>
      <div class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.hour') }}</label>
        <select
          v-if="!segmentIsCustom.hour"
          class="form-select form-select-sm"
          :value="segments.hour"
          @change="updateSegment('hour', $event.target.value)"
        >
          <option v-for="o in hourOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.hour"
          @input="editSegment('hour', $event.target.value)"
          @blur="commitSegment('hour')"
        />
      </div>
      <div class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.dayOfMonth') }}</label>
        <select
          v-if="!segmentIsCustom.dom"
          class="form-select form-select-sm"
          :value="segments.dom"
          @change="updateSegment('dom', $event.target.value)"
        >
          <option v-for="o in domOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.dom"
          @input="editSegment('dom', $event.target.value)"
          @blur="commitSegment('dom')"
        />
      </div>
      <div class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.month') }}</label>
        <select
          v-if="!segmentIsCustom.month"
          class="form-select form-select-sm"
          :value="segments.month"
          @change="updateSegment('month', $event.target.value)"
        >
          <option v-for="o in monthOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.month"
          @input="editSegment('month', $event.target.value)"
          @blur="commitSegment('month')"
        />
      </div>
      <div class="cron-segment flex-fill">
        <label class="form-label text-muted small mb-1">{{ t('settings.cron.dayOfWeek') }}</label>
        <select
          v-if="!segmentIsCustom.dow"
          class="form-select form-select-sm"
          :value="segments.dow"
          @change="updateSegment('dow', $event.target.value)"
        >
          <option v-for="o in dowOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input
          v-else
          type="text"
          class="form-control form-control-sm text-center font-monospace"
          :value="segmentValues.dow"
          @input="editSegment('dow', $event.target.value)"
          @blur="commitSegment('dow')"
        />
      </div>
    </div>

    <!-- Raw expression display -->
    <div class="d-flex align-items-center gap-2 mb-2">
      <div class="input-group input-group-sm">
        <span class="input-group-text"><FaIcon :icon="icon" /></span>
        <input
          type="text"
          class="form-control form-control-sm font-monospace"
          :class="{ 'is-invalid': hasError || !!expressionError }"
          :value="modelValue"
          @input="emit('update:modelValue', $event.target.value)"
          :placeholder="t('settings.cron.placeholder')"
        />
      </div>
    </div>

    <!-- Human description + next runs -->
    <div v-if="expressionError" class="mb-2">
      <small class="text-danger"><FaIcon icon="triangle-exclamation" class="me-1" />{{ expressionError }}</small>
    </div>
    <div v-else-if="humanDescription" class="mb-2">
      <small class="text-primary"><FaIcon icon="clock" class="me-1" />{{ humanDescription }}</small>
    </div>
    <div v-if="noRunsFound">
      <small class="text-warning"
        ><FaIcon icon="triangle-exclamation" class="me-1" />{{
          t('settings.cron.noRuns', { years: SCAN_YEARS })
        }}</small
      >
    </div>
    <div v-if="nextRuns.length">
      <small class="text-muted">{{ nextRunsLabel }}</small>
      <div class="d-flex flex-wrap gap-2 mt-1">
        <span v-for="(run, i) in nextRuns" :key="i" class="badge bg-body-secondary text-body-secondary border">
          {{ formatDate(run) }}
        </span>
      </div>
    </div>
  </div>
</template>
<style scoped>
.bs-cron {
  border: 1px solid var(--bs-border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  background-color: var(--bs-body-bg);
}
.cron-presets .btn {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
}
.cron-segment label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.cron-segment input {
  font-family: var(--bs-font-monospace);
}
</style>
