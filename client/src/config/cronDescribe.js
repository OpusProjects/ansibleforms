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
    return cronstrue.toString(expr, {
      locale: CRONSTRUE_LOCALES[locale] || locale,
      // a 24 hour clock, as every other time in the app ; English keeps its AM / PM
      use24HourTimeFormat: locale !== 'en',
      throwExceptionOnParseError: true,
    });
  } catch {
    return '';
  }
}
