// Routes

// Composables
import { createRouter, createWebHistory } from 'vue-router';
import { JOBS_STATUS_SLUGS } from '@/lib/jobsPath';
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
const profile = () => import('@/pages/profile.vue');
const schema = () => import('@/pages/schema.vue');
const error = () => import('@/pages/error.vue');

// admin
const credentials = () => import('@/pages/admin/credentials.vue');
const credential = () => import('@/pages/admin/credential.vue');
const sso = () => import('@/pages/admin/sso.vue');
const ssoProvider = () => import('@/pages/admin/sso-provider.vue');
const groups = () => import('@/pages/admin/groups.vue');
const group = () => import('@/pages/admin/group.vue');
const knownHosts = () => import('@/pages/admin/knownHosts.vue');
const ldap = () => import('@/pages/admin/ldap.vue');
const chatSettings = () => import('@/pages/admin/chat.vue');
const mcpSettings = () => import('@/pages/admin/mcp.vue');
const mailSettings = () => import('@/pages/admin/mailSettings.vue');
const mailServer = () => import('@/pages/admin/mail-server.vue');
const logo = () => import('@/pages/admin/logo.vue');
const repositories = () => import('@/pages/admin/repositories.vue');
const repository = () => import('@/pages/admin/repository.vue');
const schedules = () => import('@/pages/admin/schedules.vue');
const schedule = () => import('@/pages/schedule.vue');
const storedJobs = () => import('@/pages/admin/stored-jobs.vue');
const storedJob = () => import('@/pages/stored-job.vue');
const settings = () => import('@/pages/admin/settings.vue');
const status = () => import('@/pages/admin/status.vue');
const secretStores = () => import('@/pages/admin/secretStores.vue');
const secretStore = () => import('@/pages/admin/secret-store.vue');
const runners = () => import('@/pages/admin/runners.vue');
const runner = () => import('@/pages/admin/runner.vue');
const audit = () => import('@/pages/admin/audit.vue');
const roles = () => import('@/pages/admin/roles.vue');
const role = () => import('@/pages/admin/role.vue');
const ssh = () => import('@/pages/admin/ssh.vue');
const users = () => import('@/pages/admin/users.vue');
const user = () => import('@/pages/admin/user.vue');
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
  { path: '/profile', name: '/profile', component: profile },
  { path: '/logout', name: '/logout', component: logout },
  { path: '/jobs', name: '/jobs', component: jobs, beforeEnter: checkJobs },
  // the scheduled and stored jobs live with the jobs (their menu is the jobs menu) ; a fixed
  // segment outranks /jobs/:id, whatever the order
  { path: '/jobs/schedules', name: '/jobs/schedules', component: schedules, beforeEnter: allowScheduledJobs },
  {
    path: '/jobs/schedules/:id',
    name: '/jobs/schedules/:id',
    component: schedule,
    beforeEnter: allowScheduledJobs,
  },
  { path: '/jobs/stored', name: '/jobs/stored', component: storedJobs, beforeEnter: allowStoredJobs },
  { path: '/jobs/stored/:id', name: '/jobs/stored/:id', component: storedJob, beforeEnter: allowStoredJobs },
  // the jobs of a status (/jobs/running, /jobs/approval ...) ; a job's page by its number only,
  // so a status's name is never read as a job
  {
    path: `/jobs/:status(${JOBS_STATUS_SLUGS.join('|')})`,
    name: '/jobs/:status',
    component: jobs,
    beforeEnter: checkJobs,
  },
  { path: '/jobs/:id(\\d+)', name: '/jobs/:id', component: jobs, beforeEnter: checkJobs },
  // the server log : a settings page, under /settings as the others
  { path: '/settings/logs', name: '/settings/logs', component: logs, beforeEnter: checkLogs },
  { path: '/schema', name: '/schema', component: schema },
  { path: '/error', name: '/error', component: error },
  { path: '/api-docs', name: '/api-docs', component: apidocs },
  { path: '/:pathMatch(.*)*', name: '/unknown', component: unknown },

  // admin routes
  { path: '/settings/credentials', name: '/settings/credentials', component: credentials, beforeEnter: checkSettings },
  {
    path: '/settings/credentials/:id',
    name: '/settings/credentials/:id',
    component: credential,
    beforeEnter: checkSettings,
  },
  { path: '/settings/sso', name: '/settings/sso', component: sso, beforeEnter: checkSettings },
  // an SSO provider's page : its Details, Sign-in and Groups tabs
  { path: '/settings/sso/:id', name: '/settings/sso/:id', component: ssoProvider, beforeEnter: checkSettings },
  { path: '/settings/groups', name: '/settings/groups', component: groups, beforeEnter: checkSettings },
  // a group's page : its Details and Users tabs
  { path: '/settings/groups/:id', name: '/settings/groups/:id', component: group, beforeEnter: checkSettings },
  { path: '/settings/knownHosts', name: '/settings/knownHosts', component: knownHosts, beforeEnter: checkSettings },
  { path: '/settings/ldap', name: '/settings/ldap', component: ldap, beforeEnter: checkSettings },
  { path: '/settings/chat', name: '/settings/chat', component: chatSettings, beforeEnter: checkSettings },
  { path: '/settings/mcp', name: '/settings/mcp', component: mcpSettings, beforeEnter: checkSettings },
  {
    path: '/settings/mailSettings',
    name: '/settings/mailSettings',
    component: mailSettings,
    beforeEnter: checkSettings,
  },
  {
    path: '/settings/mailSettings/:id',
    name: '/settings/mailSettings/:id',
    component: mailServer,
    beforeEnter: checkSettings,
  },
  { path: '/settings/logo', name: '/settings/logo', component: logo, beforeEnter: checkSettings },
  {
    path: '/settings/repositories',
    name: '/settings/repositories',
    component: repositories,
    beforeEnter: checkSettings,
  },
  {
    path: '/settings/repositories/:name',
    name: '/settings/repositories/:name',
    component: repository,
    beforeEnter: checkSettings,
  },
  { path: '/settings/general', name: '/settings/general', component: settings, beforeEnter: checkSettings },
  { path: '/settings/roles', name: '/settings/roles', component: roles, beforeEnter: checkSettings },
  // a role's page : its General, Users and Groups tabs
  { path: '/settings/roles/:name', name: '/settings/roles/:name', component: role, beforeEnter: checkSettings },
  { path: '/settings/ssh', name: '/settings/ssh', component: ssh, beforeEnter: checkSettings },
  { path: '/settings/users', name: '/settings/users', component: users, beforeEnter: checkSettings },
  // a user's page : its Details and Groups tabs
  { path: '/settings/users/:id', name: '/settings/users/:id', component: user, beforeEnter: checkSettings },
  { path: '/settings/backups', name: '/settings/backups', component: backups, beforeEnter: allowBackupOps },
  // GET /api/v2/health is mounted behind checkSettingsMiddleware, so the guard
  // matches the permission the endpoint actually requires. The endpoint keeps the
  // 'health' name (it is the conventional one for a monitor to poll); the PAGE is
  // called Status because it states facts as well as verdicts.
  { path: '/settings/status', name: '/settings/status', component: status, beforeEnter: checkSettings },
  // /api/v2/secretstore is behind checkSettingsMiddleware, so the guard matches
  {
    path: '/settings/secretStores',
    name: '/settings/secretStores',
    component: secretStores,
    beforeEnter: checkSettings,
  },
  {
    path: '/settings/secretStores/:id',
    name: '/settings/secretStores/:id',
    component: secretStore,
    beforeEnter: checkSettings,
  },
  // /api/v2/runner is behind checkSettingsMiddleware, so the guard matches
  { path: '/settings/runners', name: '/settings/runners', component: runners, beforeEnter: checkSettings },
  { path: '/settings/runners/:id', name: '/settings/runners/:id', component: runner, beforeEnter: checkSettings },
  // GET /api/v2/audit is mounted behind checkSettingsMiddleware, so the guard matches
  { path: '/settings/audit', name: '/settings/audit', component: audit, beforeEnter: checkSettings },
];

const router = createRouter({
  history: createWebHistory(`${BaseUrl}/`), // honor the subpath the app is hosted under
  routes,
});

export default router;
