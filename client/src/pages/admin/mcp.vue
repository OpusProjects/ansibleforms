<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import Profile from '@/lib/Profile';
import TokenStorage from '@/lib/TokenStorage';
import BaseUrl from '@/lib/BaseUrl';
import { useEnvVars } from '@/composables/useEnvVars';
import { useRouteTab } from '@/composables/useRouteTab';

/******************************************************************/
/*                                                                */
/*  Settings > Connections > MCP : the MCP server for AI agents   */
/*  (its switch and its two options, environment variables that   */
/*  apply without a restart), and how a client connects to it     */
/*                                                                */
/******************************************************************/

const { t } = useI18n();

// INIT

const authenticated = ref(false);

// the tab shown, kept in the url (?tab=) : a link can open the client configuration directly
const { activeTab } = useRouteTab('general', (key) => ['general', 'clients'].includes(key));
const pageTabs = computed(() => [
  { key: 'general', label: t('settings.settingsPage.mcpTabGeneral'), icon: 'sliders' },
  { key: 'clients', label: t('settings.settingsPage.mcpClientConfig'), icon: 'plug' },
]);

// the variables of the page : the switch first, then what it decides while on
const { envItems, envEdits, envDirty, envRestartPending, loadEnvironmentVariables, saveEnvironmentVariables } =
  useEnvVars(['ENABLE_MCP', 'MCP_READ_ONLY', 'MCP_CHAT_FORMS_ONLY']);

// the MCP server switched on, as the page shows it (before Save too) : its options follow
const mcpOn = computed(() => String(envEdits.value.ENABLE_MCP ?? '0') === '1');

// how an MCP client connects : the endpoint under the public root url (Settings > Mail &
// URL), or this page's own address when none is set
const publicUrl = ref('');
const mcpEndpoint = computed(() => {
  const root = (publicUrl.value || window.location.origin + BaseUrl).replace(/\/+$/, '');
  return root + '/api/v2/mcp';
});

// the configuration of each client, in its own file and format, the endpoint filled in : a
// tab each (their documentation : Claude Code .mcp.json, Cursor mcp.json, VS Code
// .vscode/mcp.json with a prompted token, Codex config.toml with the token from the environment)
const json = (o) => JSON.stringify(o, null, 2);
const mcpClients = computed(() => {
  const url = mcpEndpoint.value;
  const bearer = 'Bearer <your-token>';
  return [
    {
      key: 'claude',
      label: 'Claude Code',
      file: '.mcp.json',
      text: json({ mcpServers: { ansibleforms: { type: 'http', url, headers: { Authorization: bearer } } } }),
      // the same, as a command (the note above it introduces it)
      extra: `claude mcp add --transport http ansibleforms ${url} --header "Authorization: ${bearer}"`,
    },
    {
      key: 'cursor',
      label: 'Cursor',
      file: '~/.cursor/mcp.json',
      text: json({ mcpServers: { ansibleforms: { url, headers: { Authorization: bearer } } } }),
    },
    {
      key: 'vscode',
      label: 'VS Code',
      file: '.vscode/mcp.json',
      text: json({
        inputs: [{ type: 'promptString', id: 'ansibleforms-token', description: 'AnsibleForms token', password: true }],
        servers: {
          ansibleforms: { type: 'http', url, headers: { Authorization: 'Bearer ${input:ansibleforms-token}' } },
        },
      }),
      note: t('settings.settingsPage.mcpNoteVscode'),
    },
    {
      key: 'codex',
      label: 'Codex',
      file: '~/.codex/config.toml',
      text: `[mcp_servers.ansibleforms]\nurl = "${url}"\nbearer_token_env_var = "ANSIBLEFORMS_TOKEN"`,
      note: t('settings.settingsPage.mcpNoteCodex'),
    },
  ];
});
const mcpClient = ref('claude');
const mcpCurrent = computed(() => mcpClients.value.find((c) => c.key === mcpClient.value) || mcpClients.value[0]);

// METHODS

/**
 * Copies a text to the clipboard.
 *
 * Args:
 *   text (string): the endpoint or the client configuration.
 */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('settings.settingsPage.mcpCopied'));
  } catch {
    // no clipboard access (plain http) : the text stays selectable
  }
}

// HOOKS

onMounted(async () => {
  authenticated.value = !!(await Profile.load());
  if (!authenticated.value) return;
  await loadEnvironmentVariables();
  try {
    publicUrl.value = (await axios.get('/api/v2/settings/', TokenStorage.getAuthentication())).data?.url || '';
  } catch {
    // no public url : the page's own address stands in
  }
});
</script>
<template>
  <AppNav />
  <div class="flex-shrink-0">
    <main class="d-flex flex-nowrap af-settings-layout">
      <AppSidebar />
      <AppSettings
        v-if="authenticated"
        icon="robot"
        :title="t('sidebar.mcp')"
        :description="t('settings.settingsPage.mcpDescription')"
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
        <!-- Save : the switches of the General tab only -->
        <template v-if="activeTab === 'general'" #actions>
          <BsButton
            icon="save"
            :colorClass="envDirty ? 'primary' : 'secondary'"
            :disabled="!envDirty"
            @click="saveEnvironmentVariables()"
            >{{ t('settings.common.save') }}</BsButton
          >
        </template>
        <template #default>
          <!-- GENERAL : the switch, and the options waiting for it while the server is off -->
          <div v-show="activeTab === 'general'">
            <div v-if="envRestartPending.length" class="alert alert-warning py-2">
              <FaIcon icon="triangle-exclamation" class="me-2" />
              {{ t('settings.settingsPage.envRestartPending', { names: envRestartPending.join(', ') }) }}
            </div>
            <template v-for="(e, i) in envItems" :key="e.name">
              <div v-if="i > 0" class="mt-4"></div>
              <AppEnvField
                v-model="envEdits[e.name]"
                :e="e"
                :asSwitch="true"
                :disabled="e.name !== 'ENABLE_MCP' && !mcpOn"
              />
            </template>
          </div>

          <!-- CLIENT CONFIGURATION : the endpoint, and each client's configuration -->
          <div v-show="activeTab === 'clients'">
            <!-- as wide as the endpoint and the configuration under it -->
            <div v-if="!mcpOn" class="alert alert-warning py-2 af-mcp-config">
              <FaIcon icon="triangle-exclamation" class="me-2" />{{ t('settings.settingsPage.mcpOffNote') }}
            </div>
            <label class="form-label fw-bold">{{ t('settings.settingsPage.mcpEndpoint') }}</label>
            <div class="input-group af-mcp-endpoint">
              <span class="input-group-text text-gray-500"><FaIcon :fixedwidth="true" icon="link" /></span>
              <input class="form-control font-monospace" readonly :value="mcpEndpoint" />
              <BsButton icon="copy" @click="copy(mcpEndpoint)">{{ t('profilePage.token.copy') }}</BsButton>
            </div>
            <div class="form-text mb-4">{{ t('settings.settingsPage.mcpConnectHelp') }}</div>
            <label class="form-label fw-bold">{{ t('settings.settingsPage.mcpClientConfig') }}</label>
            <!-- a tab per client : its file, its format -->
            <ul class="nav nav-tabs af-mcp-tabs af-mcp-config mb-0">
              <li v-for="c in mcpClients" :key="c.key" class="nav-item">
                <a
                  class="nav-link"
                  :class="{ active: mcpClient === c.key }"
                  href="#"
                  @click.prevent="mcpClient = c.key"
                  >{{ c.label }}</a
                >
              </li>
            </ul>
            <div class="position-relative af-mcp-config">
              <pre class="form-control font-monospace mb-0">{{ mcpCurrent.text }}</pre>
              <BsButton icon="copy" cssClass="position-absolute top-0 end-0 m-2" @click="copy(mcpCurrent.text)">{{
                t('profilePage.token.copy')
              }}</BsButton>
            </div>
            <div class="form-text">
              {{ t('settings.settingsPage.mcpConfigFile') }} <code>{{ mcpCurrent.file }}</code>
              <template v-if="mcpCurrent.note"> {{ mcpCurrent.note }}</template>
            </div>
            <!-- the command alternative : a field as the endpoint's, the Copy button beside it -->
            <template v-if="mcpCurrent.extra">
              <div class="form-text mt-2">{{ t('settings.settingsPage.mcpNoteClaude') }}</div>
              <div class="input-group af-mcp-endpoint mt-1">
                <span class="input-group-text text-gray-500"><FaIcon :fixedwidth="true" icon="terminal" /></span>
                <input class="form-control font-monospace" readonly :value="mcpCurrent.extra" />
                <BsButton icon="copy" @click="copy(mcpCurrent.extra)">{{ t('profilePage.token.copy') }}</BsButton>
              </div>
            </template>
            <div class="form-text mt-3">
              {{ t('settings.settingsPage.mcpTokenHint') }}
              <router-link :to="{ path: '/profile', query: { view: 'token' } }">{{
                t('settings.settingsPage.mcpCreateToken')
              }}</router-link>
            </div>
          </div>
        </template>
      </AppSettings>
    </main>
  </div>
</template>
<style scoped>
/* the endpoint and the configuration as wide as the wide fields (a path, a command) */
.af-mcp-endpoint,
.af-mcp-config {
  max-width: 40rem;
}
.af-mcp-config pre {
  background-color: var(--bs-tertiary-bg);
  white-space: pre;
  overflow-x: auto;
}
/* the tabs sit on the snippet : its top corners square, as a tabbed card's */
.af-mcp-tabs + .af-mcp-config pre {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-top: 0;
}
</style>
<route lang="yaml">
meta:
  layout: settings
</route>
