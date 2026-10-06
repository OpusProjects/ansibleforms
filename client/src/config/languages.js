// Canonical list of supported UI languages.
// Used by AppNav (language switcher) and the profile page (language).
// Kept in alphabetical order of the label, the order the menus show them in.

export const languages = [
  { code: 'ca', label: 'Català', flag: '🏴' }, // no emoji for the Senyera; AppFlag draws it
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
];

// the language shown when the current one is not in the list : the i18n fallback
export const fallbackLanguage = languages.find((l) => l.code === 'en');
