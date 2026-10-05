// Utilities
import { defineStore } from 'pinia';
import { ref } from 'vue';

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
  };
});
