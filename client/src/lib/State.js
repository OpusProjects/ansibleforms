import axios from 'axios';
import { useAppStore } from '@/stores/app';
import TokenStorage from '@/lib/TokenStorage';
import Navigate from '@/lib/Navigate';

var State = {
  loadProfile() {
    const store = useAppStore();
    var payload = TokenStorage.getPayload();
    store.profile = payload.user || {};
  },

  refreshAuthenticated() {
    const store = useAppStore();
    store.authenticated = TokenStorage.isAuthenticated();
    // console.log("checking if is admin")
    var payload = TokenStorage.getPayload();
    store.isAdmin = payload?.user?.roles?.includes('admin') || false;
  },

  async loadVersion() {
    const store = useAppStore();
    try {
      // Get server version and build info
      const result = await axios.get(`/api/v2/version`);
      store.version = result.data.version || result.data; // handle both old and new formats
      store.serverBuild = result.data.server || null;

      // Get client build info
      try {
        const clientBuildResult = await axios.get(`/build-info.json`);
        if (clientBuildResult.data?.gitSha) {
          store.clientBuild = clientBuildResult.data;
        } else {
          store.clientBuild = { gitSha: 'dev', dirty: false, buildTime: null };
        }
      } catch (clientErr) {
        // build-info.json not found (dev environment)
        store.clientBuild = { gitSha: 'dev', dirty: false, buildTime: null };
      }
    } catch (err) {
      // silent fail
    }
  },
  async loadLogo() {
    const store = useAppStore();
    try {
      const result = await axios.get(`/api/v2/logo`, TokenStorage.getAuthentication());
      store.customLogo = result.data?.logo || null;
      store.logoIsDefault = result.data?.isDefault ?? true;
    } catch (err) {
      // silent fail, the bundled default logo is shown
      store.customLogo = null;
      store.logoIsDefault = true;
    }
  },
  // whether the chat button may show : the server says so (ENABLE_CHAT and a provider)
  async loadChatConfig() {
    const store = useAppStore();
    try {
      const result = await axios.get(`/api/v2/app/config`);
      store.chatEnabled = !!result.data?.chatEnabled;
    } catch (err) {
      store.chatEnabled = false;
    }
  },
  async refreshApprovals() {
    const store = useAppStore();
    const res = await axios.get('/api/v2/job/approvals', TokenStorage.getAuthentication());
    store.approvals = res?.data || 0;
  },

  // Check the schema and see what's missing.
  async checkDatabase() {
    // create timestamp to add to api call to prevent caching
    const timestamp = new Date().getTime();
    const store = useAppStore();
    try {
      const result = await axios.get(`/api/v2/schema?${timestamp}`);
      store.schemaData = result.data;
      return true;
    } catch (err) {
      let responseData = err?.response?.data;
      if (responseData && typeof responseData === 'object') {
        if (responseData.error) {
          store.errorMessage = responseData.error;
        } else if (responseData.message) {
          store.errorMessage = responseData.message;
        }
        if (responseData.result) {
          store.schemaData = responseData.result.data;
        }
        return false;
      } else {
        store.errorMessage = 'Failed to check AnsibleForms database schema\n\nUnknown error';
        throw new Error(store.errorMessage, { cause: err });
      }
    }
  },
  async init(router, route) {
    State.refreshAuthenticated();
    if (!TokenStorage.isAuthenticated()) {
      console.log('Not authenticated, redirecting to login');
      Navigate.toLogin(router, route);
    } else {
      State.loadProfile();
      State.loadVersion();
      State.loadLogo();
      State.loadChatConfig();
      State.refreshApprovals();
      Navigate.toOrigin(router, route);
    }
  },
};

export default State;
