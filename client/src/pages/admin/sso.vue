<script setup>
/******************************************************************/
/*                                                                */
/*  Settings > SSO, in two tabs, the tab kept in the url :        */
/*  General - single sign-on switched on or off as a whole        */
/*            (ENABLE_SSO, applied without a restart), as LDAP's  */
/*  Providers - the SSO providers (Entra ID, OpenID Connect) ;    */
/*            the active one of each type is the one users sign   */
/*            in with (Use for sign-in in its row menu)           */
/*                                                                */
/******************************************************************/
import { ref, computed, onMounted } from 'vue';
import Profile from '@/lib/Profile';
import getSettings from '@/config/settings';
import { useI18n } from 'vue-i18n';
import { useEnvVars } from '@/composables/useEnvVars';
import { useRouteTab } from '@/composables/useRouteTab';

const { t } = useI18n();
const settings = computed(() => getSettings(t));
const authenticated = ref(false);

// ─── tabs ─────────────────────────────────────────────────────────────────────
const pageTabs = computed(() => [
  { key: 'general', label: t('settings.common.tabGeneral'), icon: 'sliders' },
  { key: 'providers', label: t('settings.oauth2.tabProviders'), icon: 'right-to-bracket' },
]);
const { activeTab } = useRouteTab('general', (key) => ['general', 'providers'].includes(key));
// the title says the tab : SSO › General, SSO › Providers, each step a link
const crumbs = computed(() => {
  const tab = pageTabs.value.find((x) => x.key === activeTab.value);
  return [
    { title: t('sidebar.oauth2'), icon: 'right-to-bracket', to: '/admin/sso' },
    { title: tab.label, icon: tab.icon, to: { path: '/admin/sso', query: { tab: tab.key } } },
  ];
});

// ─── General : the switch ─────────────────────────────────────────────────────
const { envItems, envEdits, envDirty, envRestartPending, loadEnvironmentVariables, saveEnvironmentVariables } =
  useEnvVars(['ENABLE_SSO']);

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await loadEnvironmentVariables();
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <!-- PROVIDERS : the providers' list, the page's tabs above it -->
      <AppAdminMulti
        v-if="authenticated && activeTab === 'providers'"
        :apiVersion="2"
        :settings="settings.oauth2_providers"
        :crumbs="crumbs"
      >
        <template #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="tab in pageTabs" :key="tab.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === tab.key }"
                href="#"
                @click.prevent="activeTab = tab.key"
              >
                <FaIcon :icon="tab.icon" class="me-1" />
                {{ tab.label }}
              </a>
            </li>
          </ul>
        </template>
      </AppAdminMulti>
      <!-- GENERAL : single sign-on on or off, as LDAP's switch -->
      <AppSettings
        v-else-if="authenticated"
        icon="right-to-bracket"
        :title="t('sidebar.oauth2')"
        :crumbs="crumbs"
        :description="t('settings.oauth2.description')"
      >
        <template #tabs>
          <ul class="nav nav-tabs mb-0">
            <li v-for="tab in pageTabs" :key="tab.key" class="nav-item">
              <a
                class="nav-link"
                :class="{ active: activeTab === tab.key }"
                href="#"
                @click.prevent="activeTab = tab.key"
              >
                <FaIcon :icon="tab.icon" class="me-1" />
                {{ tab.label }}
              </a>
            </li>
          </ul>
        </template>
        <template #default>
          <div v-if="envRestartPending.length" class="alert alert-warning py-2">
            <FaIcon icon="triangle-exclamation" class="me-2" />
            {{ t('settings.settingsPage.envRestartPending', { names: envRestartPending.join(', ') }) }}
          </div>
          <AppEnvField v-for="e in envItems" :key="e.name" v-model="envEdits[e.name]" :e="e" :asSwitch="true" />
        </template>
        <template #actions>
          <BsButton
            icon="save"
            :colorClass="envDirty ? 'primary' : 'secondary'"
            :disabled="!envDirty"
            @click="saveEnvironmentVariables()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<route lang="yaml">
meta:
  layout: settings
</route>
