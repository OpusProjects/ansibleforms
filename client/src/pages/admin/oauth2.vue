<script setup>
import { ref, onMounted } from 'vue';
// import { toast } from 'vue-sonner';
import Profile from '@/lib/Profile';
// import axios from 'axios';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
// import TokenStorage from '@/lib/TokenStorage';

//
const authenticated = ref(false);

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) {
    return;
  }
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <div class="d-flex flex-column w-100">
        <AppAdminMulti v-if="authenticated" :apiVersion="2" :settings="settings.oauth2_providers" />
      </div>
    </main>
  </div>
</template>
