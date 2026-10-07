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

      // the client's own build, baked into the bundle by vite.config.mjs : it identifies the code
      // running in this tab, so a tab left open across an upgrade shows a mismatch. 'dev' when
      // the bundle was built without build-info.json, or under test (no vite define)
      store.clientBuild =
        typeof __CLIENT_BUILD__ !== 'undefined' ? __CLIENT_BUILD__ : { gitSha: 'dev', dirty: false, buildTime: null };
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

  // who holds the designer lock, for the lock icon on the header's Designer link ; only for
  // a user who sees the designer (the lock api answers 403 to the others)
  async refreshDesignerLock() {
    const store = useAppStore();
    if (!store.profile?.options?.showDesigner) {
      store.designerLock = null;
      return;
    }
    try {
      const res = await axios.get('/api/v2/lock', TokenStorage.getAuthentication());
      store.designerLock = res?.data || null;
    } catch (err) {
      // the designer is disabled, or the server is down : no icon rather than a wrong one
      store.designerLock = null;
    }
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
