<script setup>
/******************************************************************/
/*                                                                */
/*  Settings > Mail : the SMTP servers the app sends its mail     */
/*  with, one of them active. A row opens the server's page       */
/*  (mail-server.vue), Add the wizard. A config seed that sets    */
/*  the mail settings is said above the list : the app sends with */
/*  those while no server is active.                              */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import getSettings from '@/config/settings';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
const authenticated = ref(false);
// the mail settings come from the config seed (a seeded instance)
const seeded = ref(false);

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  const res = await axios.get('/api/v2/settings/', TokenStorage.getAuthentication()).catch(() => null);
  seeded.value = !!(res?.data?.managed && res?.data?.mail_server);
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <div v-if="authenticated" class="flex-grow-1 d-flex flex-column">
        <div v-if="seeded" class="alert alert-secondary py-2 mx-4 mt-3 mb-0">
          <FaIcon icon="lock" class="me-2" />{{ t('settings.mailServers.fromSeed') }}
        </div>
        <AppAdminMulti :settings="settings.mailServers" :apiVersion="2" />
      </div>
    </main>
  </div>
</template>
