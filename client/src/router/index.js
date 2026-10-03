// Routes

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import BaseUrl from '@/lib/BaseUrl'

import designer from "@/pages/designer.vue"
import index from "@/pages/index.vue"
import form from "@/pages/form.vue"
import login from "@/pages/login.vue"
import logout from "@/pages/logout.vue"
import logs from "@/pages/logs.vue"
import jobs from "@/pages/jobs.vue"
import apidocs from "@/pages/api-docs.vue"
import unknown from "@/pages/unknown.vue"
import changePassword from "@/pages/change-password.vue"  
import schema from "@/pages/schema.vue"
import error from "@/pages/error.vue"

// admin
import aap from "@/pages/admin/aap.vue"
import credentials from "@/pages/admin/credentials.vue"
import oauth2 from "@/pages/admin/oauth2.vue"
import groups from "@/pages/admin/groups.vue"
import knownHosts from "@/pages/admin/knownHosts.vue"
import ldap from "@/pages/admin/ldap.vue"
import chatSettings from "@/pages/admin/chat.vue"
import mailSettings from "@/pages/admin/mailSettings.vue"
import logo from "@/pages/admin/logo.vue"
import repositories from "@/pages/admin/repositories.vue"
import schedules from "@/pages/admin/schedules.vue"
import storedJobs from "@/pages/admin/stored-jobs.vue"
import settings from "@/pages/admin/settings.vue"
import status from "@/pages/admin/status.vue"
import secretStores from "@/pages/admin/secretStores.vue"
import audit from "@/pages/admin/audit.vue"
import categories from "@/pages/admin/categories.vue"
import roles from "@/pages/admin/roles.vue"
import constants from "@/pages/admin/constants.vue"
import ssh from "@/pages/admin/ssh.vue"
import users from "@/pages/admin/users.vue"
import backups from "@/pages/admin/backups.vue"

import TokenStorage from '@/lib/TokenStorage.js'

const checkDesigner=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.showDesigner){
    next()
  }else{
    next({ name: "/" })
  }
}
const checkLogs=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.showLogs){
    next()
  }else{
    next({ name: "/" })
  }
}
const checkJobs=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.showJobs){
    next()
  }else{
    next({ name: "/" })
  }
}
const checkSettings=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.showSettings){
    next()
  }else{
    next({ name: "/" })
  }
}
// the schedule and stored-jobs apis are gated on their own option, not on
// showSettings : guard the pages the same way so a settings-only user is not
// sent to a page where every request comes back 401
const allowScheduledJobs=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.allowScheduledJobs){
    next()
  }else{
    next({ name: "/" })
  }
}
const allowStoredJobs=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.allowStoredJobs){
    next()
  }else{
    next({ name: "/" })
  }
}
const allowBackupOps=(to, from, next) => {
  var payload = TokenStorage.getPayload()
  if(payload?.user?.options?.allowBackupOps){
    next()
  }else{
    next({ name: "/" })
  }
}



const routes = [

  // root routes
  { path: '/', name:"/", component: index },
  { path: '/designer', name:"/designer", component: designer, beforeEnter: checkDesigner },
  { path: '/form', name: "/form", component: form },
  { path: '/login', name: "/login", component: login },
  { path: '/change-password', name: "/change-password", component: changePassword },
  { path: '/logout', name: "/logout", component: logout },
  { path: '/jobs', name: "/jobs", component: jobs, beforeEnter: checkJobs },
  { path: "/jobs/:id", name: "/jobs/:id", component: jobs, beforeEnter: checkJobs },
  { path: '/logs', name: "/logs", component: logs, beforeEnter: checkLogs },
  { path: '/schema', name: "/schema", component: schema },
  { path: '/error', name: "/error", component: error },
  { path: '/api-docs', name: "/api-docs", component: apidocs },
  { path: '/:pathMatch(.*)*', name: "/unknown", component: unknown },

  // admin routes
  { path: '/admin/aap', name: "/admin/aap", component: aap, beforeEnter: checkSettings },
  { path: '/admin/credentials', name: "/admin/credentials", component: credentials, beforeEnter: checkSettings },
  { path: '/admin/oauth2', name: "/admin/oauth2", component: oauth2, beforeEnter: checkSettings },
  { path: '/admin/groups', name: "/admin/groups", component: groups, beforeEnter: checkSettings },
  { path: '/admin/knownHosts', name: "/admin/knownHosts", component: knownHosts, beforeEnter: checkSettings },
  { path: '/admin/ldap', name: "/admin/ldap", component: ldap, beforeEnter: checkSettings },
  { path: '/admin/chat', name: "/admin/chat", component: chatSettings, beforeEnter: checkSettings },
  { path: '/admin/mailSettings', name: "/admin/mailSettings", component: mailSettings, beforeEnter: checkSettings },
  { path: '/admin/logo', name: "/admin/logo", component: logo, beforeEnter: checkSettings },
  { path: '/admin/repositories', name: "/admin/repositories", component: repositories, beforeEnter: checkSettings },
  { path: '/admin/schedules', name: "/admin/schedules", component: schedules, beforeEnter: allowScheduledJobs },
  { path: '/admin/stored-jobs', name: "/admin/stored-jobs", component: storedJobs, beforeEnter: allowStoredJobs },
  { path: '/admin/settings', name: "/admin/settings", component: settings, beforeEnter: checkSettings },
  { path: '/admin/categories', name: "/admin/categories", component: categories, beforeEnter: checkSettings },
  { path: '/admin/roles', name: "/admin/roles", component: roles, beforeEnter: checkSettings },
  { path: '/admin/constants', name: "/admin/constants", component: constants, beforeEnter: checkSettings },
  { path: '/admin/ssh', name: "/admin/ssh", component: ssh, beforeEnter: checkSettings },
  { path: '/admin/users', name: "/admin/users", component: users, beforeEnter: checkSettings },
  { path: '/admin/backups', name: "/admin/backups", component: backups, beforeEnter: allowBackupOps },
  // GET /api/v2/health is mounted behind checkSettingsMiddleware, so the guard
  // matches the permission the endpoint actually requires. The endpoint keeps the
  // 'health' name (it is the conventional one for a monitor to poll); the PAGE is
  // called Status because it states facts as well as verdicts.
  { path: '/admin/status', name: "/admin/status", component: status, beforeEnter: checkSettings },
  // /api/v2/secretstore is behind checkSettingsMiddleware, so the guard matches
  { path: '/admin/secretStores', name: "/admin/secretStores", component: secretStores, beforeEnter: checkSettings },
  // GET /api/v2/audit is mounted behind checkSettingsMiddleware, so the guard matches
  { path: '/admin/audit', name: "/admin/audit", component: audit, beforeEnter: checkSettings },

]

const router = createRouter({
  history: createWebHistory(`${BaseUrl}/`), // honor the subpath the app is hosted under
  routes
})

export default router
