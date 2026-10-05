import { useAppStore } from '@/stores/app';

var Theme = {
  load() {
    const store = useAppStore();
    store.theme = localStorage.getItem('theme') || Theme.getMediaPreference();
    Theme.set(store.theme);
    if (store.theme === 'color') {
      const saved = localStorage.getItem('themeColor');
      if (saved) Theme.applyColor(saved);
    }
    return store.theme;
  },
  // Applies the server/env default, unless the user picked a theme themselves.
  // The "theme" key cannot be that marker: Theme.load() writes it on every load
  // (so a refresh keeps the rendered theme), which is why an explicit choice gets
  // its own key - the same split as the af_language cookie for the language.
  applyServerDefault(theme, color) {
    if (!theme) return;
    if (Theme.isUserChoice()) return;
    Theme.set(theme);
    if (theme === 'color' && color) {
      Theme.applyColor(color);
    } else {
      Theme.clearColor();
    }
  },
  isUserChoice() {
    return localStorage.getItem('themeChosen') === '1';
  },
  // the user picked this theme: remember the choice so the server default no
  // longer overrides it
  choose(theme) {
    localStorage.setItem('themeChosen', '1');
    Theme.set(theme);
  },
  set(theme) {
    const store = useAppStore();
    localStorage.setItem('theme', theme);
    store.theme = theme;
    const el = document.documentElement;
    el.setAttribute('data-bs-theme', theme);
  },
  applyColor(hex) {
    localStorage.setItem('themeColor', hex);
    const el = document.documentElement;
    el.style.setProperty('--af-bg-navbar', hex);
    el.style.setProperty('--af-navbar-link-hover-color', 'rgba(255,255,255,0.7)');
    el.style.setProperty('--af-navbar-link-active-color', 'rgba(255,255,255,0.7)');
  },
  clearColor() {
    const el = document.documentElement;
    el.style.removeProperty('--af-bg-navbar');
    el.style.removeProperty('--af-navbar-link-hover-color');
    el.style.removeProperty('--af-navbar-link-active-color');
  },
  getColor() {
    return localStorage.getItem('themeColor') || '#008cba';
  },
  themes() {
    return [
      { title: 'Light', value: 'light', icon: 'fac,brightness' },
      { title: 'Dark', value: 'dark', icon: 'moon' },
      { title: 'Color', value: 'color', icon: 'palette' },
    ];
  },
  getMediaPreference() {
    const hasDarkPreference = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (hasDarkPreference) {
      return 'dark';
    } else {
      return 'light';
    }
  },
};

export default Theme;
