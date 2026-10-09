<script setup>
import { toast } from 'vue-sonner';
import axios from 'axios';
import getSettings from '@/config/settings';
import TokenStorage from '@/lib/TokenStorage';
import Helpers from '@/lib/Helpers';
import Profile from '@/lib/Profile';
import State from '@/lib/State';
import { useI18n } from 'vue-i18n';
import { useEnvVars } from '@/composables/useEnvVars';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
const authenticated = ref(false);
const testing = ref(false);

// the page in tabs : General (the switch and what the assistant may do), the model provider,
// and the limits of a conversation ; each field of settings.chat names its tab
const tabs = computed(() => [
  { key: 'general', label: t('settings.chat.tabGeneral'), icon: 'sliders' },
  { key: 'provider', label: t('settings.chat.tabProvider'), icon: 'robot' },
  { key: 'limits', label: t('settings.chat.tabLimits'), icon: 'gauge' },
]);

// the switch of the chat assistant : an environment variable, applied without a restart
const { envItems, envEdits, envDirty, envRestartPending, loadEnvironmentVariables, saveEnvironmentVariables } =
  useEnvVars(['ENABLE_CHAT']);
// switched on, as the page shows it (before Save too) : the settings below wait for it
const chatOn = computed(() => String(envEdits.value.ENABLE_CHAT ?? '0') === '1');

// Save : the switch, then the chat button of the header follows without a reload
async function saveSwitch() {
  await saveEnvironmentVariables();
  State.loadChatConfig();
}

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
  if (authenticated.value) await loadEnvironmentVariables();
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
        :tabs="tabs"
        :locked="!chatOn"
        :extraDirty="envDirty"
        @test="testProvider"
        @saved="State.loadChatConfig()"
        @saveExtra="saveSwitch()"
      >
        <!-- General : the switch first, as on the MCP page ; the settings wait for it -->
        <template #tab-top-general>
          <div v-if="envRestartPending.length" class="alert alert-warning py-2">
            <FaIcon icon="triangle-exclamation" class="me-2" />
            {{ t('settings.settingsPage.envRestartPending', { names: envRestartPending.join(', ') }) }}
          </div>
          <AppEnvField v-for="e in envItems" :key="e.name" v-model="envEdits[e.name]" :e="e" :asSwitch="true" />
        </template>
      </AppAdminSingle>
    </main>
  </div>
</template>
<route lang="yaml">
meta:
  layout: settings
</route>
