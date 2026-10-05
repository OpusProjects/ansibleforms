// Routes

// Composables
import { createRouter, createWebHistory } from 'vue-router';
import BaseUrl from '@/lib/BaseUrl';

// Pages load on first visit rather than up front: each becomes its own chunk, so the first
// page view downloads the app shell and that page instead of the whole application.
const designer = () => import('@/pages/designer.vue');
const index = () => import('@/pages/index.vue');
const form = () => import('@/pages/form.vue');
const login = () => import('@/pages/login.vue');
const logout = () => import('@/pages/logout.vue');
const logs = () => import('@/pages/logs.vue');
const jobs = () => import('@/pages/jobs.vue');
const apidocs = () => import('@/pages/api-docs.vue');
const unknown = () => import('@/pages/unknown.vue');
const changePassword = () => import('@/pages/change-password.vue');
const schema = () => import('@/pages/schema.vue');
const error = () => import('@/pages/error.vue');

// admin
const aap = () => import('@/pages/admin/aap.vue');
const credentials = () => import('@/pages/admin/credentials.vue');
const oauth2 = () => import('@/pages/admin/oauth2.vue');
const groups = () => import('@/pages/admin/groups.vue');
const knownHosts = () => import('@/pages/admin/knownHosts.vue');
const ldap = () => import('@/pages/admin/ldap.vue');
const chatSettings = () => import('@/pages/admin/chat.vue');
const mailSettings = () => import('@/pages/admin/mailSettings.vue');
const logo = () => import('@/pages/admin/logo.vue');
const repositories = () => import('@/pages/admin/repositories.vue');
const schedules = () => import('@/pages/admin/schedules.vue');
const storedJobs = () => import('@/pages/admin/stored-jobs.vue');
const settings = () => import('@/pages/admin/settings.vue');
const status = () => import('@/pages/admin/status.vue');
const secretStores = () => import('@/pages/admin/secretStores.vue');
const audit = () => import('@/pages/admin/audit.vue');
const categories = () => import('@/pages/admin/categories.vue');
const roles = () => import('@/pages/admin/roles.vue');
const constants = () => import('@/pages/admin/constants.vue');
const ssh = () => import('@/pages/admin/ssh.vue');
const users = () => import('@/pages/admin/users.vue');
const backups = () => import('@/pages/admin/backups.vue');

import TokenStorage from '@/lib/TokenStorage.js';

const checkDesigner = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.showDesigner) {
    next();
  } else {
    next({ name: '/' });
  }
};
const checkLogs = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.showLogs) {
    next();
  } else {
    next({ name: '/' });
  }
};
const checkJobs = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.showJobs) {
    next();
  } else {
    next({ name: '/' });
  }
};
const checkSettings = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.showSettings) {
    next();
  } else {
    next({ name: '/' });
  }
};
// the schedule and stored-jobs apis are gated on their own option, not on
// showSettings : guard the pages the same way so a settings-only user is not
// sent to a page where every request comes back 401
const allowScheduledJobs = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.allowScheduledJobs) {
    next();
  } else {
    next({ name: '/' });
  }
};
const allowStoredJobs = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.allowStoredJobs) {
    next();
  } else {
    next({ name: '/' });
  }
};
const allowBackupOps = (to, from, next) => {
  var payload = TokenStorage.getPayload();
  if (payload?.user?.options?.allowBackupOps) {
    next();
  } else {
    next({ name: '/' });
  }
};

const routes = [
  // root routes
  { path: '/', name: '/', component: index },
  { path: '/designer', name: '/designer', component: designer, beforeEnter: checkDesigner },
  { path: '/form', name: '/form', component: form },
  { path: '/login', name: '/login', component: login },
  { path: '/change-password', name: '/change-password', component: changePassword },
  { path: '/logout', name: '/logout', component: logout },
  { path: '/jobs', name: '/jobs', component: jobs, beforeEnter: checkJobs },
  { path: '/jobs/:id', name: '/jobs/:id', component: jobs, beforeEnter: checkJobs },
  { path: '/logs', name: '/logs', component: logs, beforeEnter: checkLogs },
  { path: '/schema', name: '/schema', component: schema },
  { path: '/error', name: '/error', component: error },
  { path: '/api-docs', name: '/api-docs', component: apidocs },
  { path: '/:pathMatch(.*)*', name: '/unknown', component: unknown },

  // admin routes
  { path: '/admin/aap', name: '/admin/aap', component: aap, beforeEnter: checkSettings },
  { path: '/admin/credentials', name: '/admin/credentials', component: credentials, beforeEnter: checkSettings },
  { path: '/admin/oauth2', name: '/admin/oauth2', component: oauth2, beforeEnter: checkSettings },
  { path: '/admin/groups', name: '/admin/groups', component: groups, beforeEnter: checkSettings },
  { path: '/admin/knownHosts', name: '/admin/knownHosts', component: knownHosts, beforeEnter: checkSettings },
  { path: '/admin/ldap', name: '/admin/ldap', component: ldap, beforeEnter: checkSettings },
  { path: '/admin/chat', name: '/admin/chat', component: chatSettings, beforeEnter: checkSettings },
  { path: '/admin/mailSettings', name: '/admin/mailSettings', component: mailSettings, beforeEnter: checkSettings },
  { path: '/admin/logo', name: '/admin/logo', component: logo, beforeEnter: checkSettings },
  { path: '/admin/repositories', name: '/admin/repositories', component: repositories, beforeEnter: checkSettings },
  { path: '/admin/schedules', name: '/admin/schedules', component: schedules, beforeEnter: allowScheduledJobs },
  { path: '/admin/stored-jobs', name: '/admin/stored-jobs', component: storedJobs, beforeEnter: allowStoredJobs },
  { path: '/admin/settings', name: '/admin/settings', component: settings, beforeEnter: checkSettings },
  { path: '/admin/categories', name: '/admin/categories', component: categories, beforeEnter: checkSettings },
  { path: '/admin/roles', name: '/admin/roles', component: roles, beforeEnter: checkSettings },
  { path: '/admin/constants', name: '/admin/constants', component: constants, beforeEnter: checkSettings },
  { path: '/admin/ssh', name: '/admin/ssh', component: ssh, beforeEnter: checkSettings },
  { path: '/admin/users', name: '/admin/users', component: users, beforeEnter: checkSettings },
  { path: '/admin/backups', name: '/admin/backups', component: backups, beforeEnter: allowBackupOps },
  // GET /api/v2/health is mounted behind checkSettingsMiddleware, so the guard
  // matches the permission the endpoint actually requires. The endpoint keeps the
  // 'health' name (it is the conventional one for a monitor to poll); the PAGE is
  // called Status because it states facts as well as verdicts.
  { path: '/admin/status', name: '/admin/status', component: status, beforeEnter: checkSettings },
  // /api/v2/secretstore is behind checkSettingsMiddleware, so the guard matches
  { path: '/admin/secretStores', name: '/admin/secretStores', component: secretStores, beforeEnter: checkSettings },
  // GET /api/v2/audit is mounted behind checkSettingsMiddleware, so the guard matches
  { path: '/admin/audit', name: '/admin/audit', component: audit, beforeEnter: checkSettings },
];

const router = createRouter({
  history: createWebHistory(`${BaseUrl}/`), // honor the subpath the app is hosted under
  routes,
});

export default router;
