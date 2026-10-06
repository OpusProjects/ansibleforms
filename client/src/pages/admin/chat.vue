<script setup>
import { toast } from 'vue-sonner';
import axios from 'axios';
import getSettings from '@/config/settings';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import Profile from '@/lib/Profile';
import State from '@/lib/State';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
const authenticated = ref(false);
const testing = ref(false);

// one round trip to the provider with what is on the page (a masked key means the stored one)
async function testProvider(item) {
  testing.value = true;
  try {
    const result = await axios.post('/api/v2/chatsettings/check/', item, TokenStorage.getAuthentication());
    toast.success(t('settings.chat.checkOk', { reply: result.data?.reply || 'OK' }));
  } catch (err) {
    toast.error(Helpers.parseAxiosResponseError(err, t('settings.chat.checkFailed')));
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppAdminSingle
        v-if="authenticated"
        apiVersion="2"
        :settings="settings.chat"
        @test="testProvider"
        @saved="State.loadChatConfig()"
      />
    </main>
  </div>
</template>
<route lang="yaml">
meta:
  layout: settings
</route>
