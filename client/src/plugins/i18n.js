import { createI18n } from 'vue-i18n';
import en from '@/locales/en.js';
import nl from '@/locales/nl.js';
import fr from '@/locales/fr.js';
import it from '@/locales/it.js';
import de from '@/locales/de.js';
import es from '@/locales/es.js';
import Helpers from '@/lib/Helpers';

// Get language from cookie (set later from server default if no cookie exists)
const savedLocale = Helpers.getCookie('af_language') || 'en';

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: {
    en,
    nl,
    fr,
    it,
    de,
    es,
  },
});

/**
 * Set the default language from server config (called after app/config fetch).
 * Only applies if the user has not explicitly chosen a language (no cookie).
 */
export function applyDefaultLanguage(defaultLang) {
  if (!Helpers.getCookie('af_language') && defaultLang && ['en', 'nl', 'fr', 'it', 'de', 'es'].includes(defaultLang)) {
    i18n.global.locale.value = defaultLang;
  }
}

export default i18n;
