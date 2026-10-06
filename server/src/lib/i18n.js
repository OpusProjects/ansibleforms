/**
 * Lightweight i18n module for the backend.
 * 
 * Resolves translations based on:
 *   1. `af_language` cookie
 *   2. Accept-Language header
 *   3. DEFAULT_LANGUAGE env var
 *   4. Fallback to 'en'
 */

import en from '../locales/en.js';
import nl from '../locales/nl.js';
import fr from '../locales/fr.js';
import it from '../locales/it.js';
import de from '../locales/de.js';
import es from '../locales/es.js';
import ca from '../locales/ca.js';
import pt from '../locales/pt.js';
import ja from '../locales/ja.js';
import zh from '../locales/zh.js';
import pl from '../locales/pl.js';

const messages = { en, nl, fr, it, de, es, ca, pt, ja, zh, pl };
const supportedLocales = Object.keys(messages);
// `let`, with a setter, so the settings page can change DEFAULT_LANGUAGE without a restart.
// The /api/v2/app/config route already reads process.env per request, so without this the
// visible default would change while this fallback kept the old one.
let defaultLocale = process.env.DEFAULT_LANGUAGE || 'en';

export function setDefaultLocale(locale) {
  if (locale && supportedLocales.includes(locale)) { defaultLocale = locale; return true; }
  return false;
}

/**
 * Get the locale from a request object.
 */
function getLocaleFromRequest(req) {
  // 1. Check af_language cookie
  const cookies = parseCookies(req.headers?.cookie || '');
  if (cookies.af_language && supportedLocales.includes(cookies.af_language)) {
    return cookies.af_language;
  }

  // 2. Check Accept-Language header
  const acceptLang = req.headers?.['accept-language'];
  if (acceptLang) {
    const preferred = acceptLang.split(',')
      .map(part => part.split(';')[0].trim().substring(0, 2).toLowerCase())
      .find(lang => supportedLocales.includes(lang));
    if (preferred) return preferred;
  }

  // 3. Default
  return defaultLocale;
}

/**
 * Simple cookie parser (no dependency needed).
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      // decodeURIComponent THROWS a URIError on a stray '%' ("foo=100%", "x=abc%zz").
      // parseCookies runs for every t(req, ...) - 189 call sites - so one malformed
      // cookie anywhere in the caller's jar turned every translated response into a 500.
      // Worst in middleware.js, whose catch calls t() again: the guard threw twice and
      // escaped, so a permission check became an unconditional 500 rather than a 403.
      // A value that is not valid percent-encoding is simply a literal.
      cookies[safeDecode(name)] = safeDecode(rest.join('='));
    }
  });
  return cookies;
}

/**
 * Get a nested translation value by dot-path.
 * Example: t(req, 'errors.noAccess')
 * Example with interpolation: t(req, 'config.lockedBy', { username: 'admin' })
 */
function t(req, key, params) {
  const locale = req ? getLocaleFromRequest(req) : defaultLocale;
  const keys = key.split('.');
  let value = messages[locale];
  for (const k of keys) {
    value = value?.[k];
  }
  // fallback to English if not found
  if (value === undefined) {
    value = messages.en;
    for (const k of keys) {
      value = value?.[k];
    }
  }
  const result = value || key;
  if (params && typeof result === 'string') {
    return result.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
  }
  return result;
}

export default { t, getLocaleFromRequest, supportedLocales, defaultLocale };
