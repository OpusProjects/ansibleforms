// Utilities
import { defineStore } from 'pinia';
import { ref } from 'vue';

// the user's time zone preference, kept in this browser like the theme ; storage can be
// unavailable (private mode), then the default applies
function loadTimezone() {
  try {
    return localStorage.getItem('af_timezone') || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const useAppStore = defineStore('app', () => {
  const theme = ref('light'); // default theme
  const profile = ref(null);
  const authenticated = ref(false);
  const isAdmin = ref(false);
  const version = ref('');
  const customLogo = ref(null); // logo data url shown in the navbar
  const logoIsDefault = ref(true); // true while the seeded default logo is active
  const serverBuild = ref(null);
  const clientBuild = ref(null);
  const approvals = ref(0);
  const errorMessage = ref('');
  const schemaData = ref(null);
  const chatEnabled = ref(false); // ENABLE_CHAT and a configured provider (/api/v2/app/config)
  // the time zone dates are shown in : 'UTC', 'browser' or an IANA zone (lib/Time.js) ; read
  // here so every page re-renders its dates when the user picks another one
  const timezone = ref(loadTimezone());
  // the server runs a newer build than this tab (App.vue's response interceptor) ; the banner
  // under the header offers a reload, and can be dismissed for the rest of this visit
  const newVersionAvailable = ref(false);
  const newVersionDismissed = ref(false);

  // const doubleCount = computed(() => count.value * 2)
  // function increment() {
  //   count.value++
  // }

  return {
    theme,
    profile,
    authenticated,
    isAdmin,
    version,
    customLogo,
    logoIsDefault,
    serverBuild,
    clientBuild,
    approvals,
    errorMessage,
    schemaData,
    chatEnabled,
    timezone,
    newVersionAvailable,
    newVersionDismissed,
  };
});
