// A cron expression in words, for the tables' popovers ('0 6 * * 0' is 'At 06:00 AM, only on
// Sunday'), with the cronstrue library and the app's languages.
//
// Apart from config/cron.js on purpose : the server's tests import that one to check the two
// agree with croner, and the server does not install the client's packages.
import cronstrue from 'cronstrue';
// the languages of the app ; each registers itself with cronstrue (English is built in)
import 'cronstrue/locales/de';
import 'cronstrue/locales/fr';
import 'cronstrue/locales/it';
import 'cronstrue/locales/es';
import 'cronstrue/locales/nl';
import 'cronstrue/locales/ca';
import 'cronstrue/locales/pt_PT';
import 'cronstrue/locales/ja';
import 'cronstrue/locales/zh_CN';
import 'cronstrue/locales/pl';
import { cronError } from './cron';

// the app's language codes that cronstrue spells differently
const CRONSTRUE_LOCALES = { pt: 'pt_PT', zh: 'zh_CN' };

// 'every day', in the app's languages : cronstrue leaves it out of a daily cron ('0 2 * * *' is
// only 'At 02:00 AM'), which reads as once
const EVERY_DAY = {
  en: 'every day',
  de: 'jeden Tag',
  fr: 'tous les jours',
  it: 'ogni giorno',
  es: 'todos los días',
  nl: 'elke dag',
  ca: 'cada dia',
  pt: 'todos os dias',
  ja: '毎日',
  zh: '每天',
  pl: 'codziennie',
};

/**
 * Whether a cron runs at set times on every day : its hours fixed (no *), any day of the
 * month and any weekday - in every month, or in some ('0 2 * * *', '0 4 * 1 *').
 *
 * Args:
 *   expr (string): the cron expression, 5 fields or 6 (seconds first).
 *
 * Returns:
 *   boolean: true when it runs at set times every day.
 */
function isDaily(expr) {
  const fields = expr.split(/\s+/);
  const f = fields.length === 6 ? fields.slice(1) : fields;
  if (f.length !== 5) return false;
  const [, hour, day, , weekday] = f;
  return !hour.includes('*') && day === '*' && (weekday === '*' || weekday === '?');
}

// the weekdays in the week's order, Monday first : a list of them reads in that order
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * A list of words as English writes it : 'a', 'a and b', 'a, b, and c'.
 *
 * Args:
 *   items (string[]): the words.
 *
 * Returns:
 *   string: the list.
 */
function englishList(items) {
  if (items.length < 3) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * cronstrue's English, as a repeating schedule reads : weekdays in the plural and the week's
 * order ('only on Monday' read as a single Monday), months without 'only', a whole hour's
 * interval without 'At 0 minutes past the hour', and days of the month in the plural.
 *
 * Args:
 *   words (string): cronstrue's description.
 *
 * Returns:
 *   string: the description.
 */
function polishEnglish(words) {
  return (
    words
      // ', only on Sunday and Saturday' -> ', on Saturdays and Sundays'
      .replace(/, only on ((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day(?:,? and |, )?)+/, (all) => {
        const list = all.replace(/^, only on /, '');
        const days = list
          .split(/,? and |, /)
          .map((d) => d.trim())
          .filter(Boolean);
        if (!days.every((d) => WEEKDAYS.includes(d))) return all;
        days.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
        return `, on ${englishList(days.map((d) => `${d}s`))}`;
      })
      // ', only in January' -> ', in January'
      .replace(/, only in /, ', in ')
      // 'At 0 minutes past the hour, every 2 hours' -> 'Every 2 hours'
      .replace(/^At 0 minutes past the hour, every /, 'Every ')
      // 'on day 1 and 15 of the month' -> 'on days 1 and 15 of the month'
      .replace(/\bon day (\d+(?:, \d+)*,? and \d+) of the month/, 'on days $1 of the month')
  );
}

/**
 * A cron expression in words, in the app's language : '0 6 * * 0' is 'At 06:00 AM, only on
 * Sunday'. Shown when hovering a cron in a table.
 *
 * Args:
 *   expression (string): the cron expression.
 *   locale (string): the app's language code (en, de, pt, zh ...).
 *
 * Returns:
 *   string: the description, or '' for an empty or invalid expression.
 */
export function describeCron(expression, locale = 'en') {
  const expr = String(expression ?? '').trim();
  if (!expr || cronError(expr)) return '';
  try {
    const words = cronstrue.toString(expr, {
      locale: CRONSTRUE_LOCALES[locale] || locale,
      // a 24 hour clock, as every other time in the app ; English keeps its AM / PM
      use24HourTimeFormat: locale !== 'en',
      throwExceptionOnParseError: true,
    });
    let text = locale === 'en' ? polishEnglish(words) : words;
    // a daily cron says so, right after its times : 'At 02:00 AM, every day', 'At 04:00 AM,
    // every day, in January'
    if (isDaily(expr)) {
      const everyDay = EVERY_DAY[locale] || EVERY_DAY.en;
      const cut = text.indexOf(', ', text.search(/\d/));
      text = cut === -1 ? `${text}, ${everyDay}` : `${text.slice(0, cut)}, ${everyDay}${text.slice(cut)}`;
    }
    return text;
  } catch {
    return '';
  }
}
