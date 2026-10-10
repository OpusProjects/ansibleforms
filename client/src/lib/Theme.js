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
  // The color theme : the header in the color picked, and every blue of the app - links, the
  // primary and outline buttons, the selected menu entry and its badges, the tabs, the pager,
  // checkboxes, switches and focus rings - in tones of it (styles/textColors.scss reads these
  // under [data-bs-theme=color]). The status pills keep their own colors : they say a state.
  applyColor(hex) {
    localStorage.setItem('themeColor', hex);
    const el = document.documentElement;
    el.style.setProperty('--af-bg-navbar', hex);
    el.style.setProperty('--af-navbar-link-hover-color', '#ffffff');
    el.style.setProperty('--af-navbar-link-active-color', '#ffffff');
    for (const [name, value] of Object.entries(Theme.tones(hex))) el.style.setProperty(name, value);
  },
  clearColor() {
    const el = document.documentElement;
    el.style.removeProperty('--af-bg-navbar');
    el.style.removeProperty('--af-navbar-link-hover-color');
    el.style.removeProperty('--af-navbar-link-active-color');
    for (const name of Object.keys(Theme.tones('#000000'))) el.style.removeProperty(name);
  },
  /**
   * The tones of a color the app's blue is replaced with : the color itself, darker ones for
   * text and links on white (readable) and for hover, and light tints for the subtle
   * backgrounds and borders.
   *
   * Args:
   *   hex (string): the color picked (#rrggbb).
   *
   * Returns:
   *   object: CSS custom properties and their values.
   */
  tones(hex) {
    const rgb = Theme.hexToRgb(hex) || [0, 140, 186];
    const mix = (to, amount) => rgb.map((c, i) => Math.round(c + (to[i] - c) * amount));
    const css = (c) => `rgb(${c.join(', ')})`;
    const black = [0, 0, 0];
    const white = [255, 255, 255];
    const text = mix(black, 0.25);
    const hover = mix(black, 0.15);
    return {
      '--bs-primary': hex,
      '--bs-primary-rgb': rgb.join(', '),
      '--bs-link-color': css(text),
      '--bs-link-color-rgb': text.join(', '),
      '--bs-link-hover-color': css(mix(black, 0.4)),
      '--bs-link-hover-color-rgb': mix(black, 0.4).join(', '),
      '--bs-primary-text-emphasis': css(mix(black, 0.5)),
      '--bs-primary-bg-subtle': css(mix(white, 0.85)),
      '--bs-primary-border-subtle': css(mix(white, 0.6)),
      '--bs-focus-ring-color': `rgba(${rgb.join(', ')}, 0.25)`,
      '--af-accent-hover': css(hover),
      '--af-accent-text': css(text),
    };
  },
  /**
   * A #rrggbb (or #rgb) color as its red, green and blue.
   *
   * Args:
   *   hex (string): the color.
   *
   * Returns:
   *   number[]|null: [r, g, b], or null when it is not a color.
   */
  hexToRgb(hex) {
    let h = String(hex || '')
      .trim()
      .replace(/^#/, '');
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
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
