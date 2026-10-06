<script setup>
/******************************************************************/
/*                                                                */
/*  App AnsibleForms Settings Sidebar menu                        */
/*                                                                */
/*  Every entry carries the role option its PAGE requires, and    */
/*  the menu is filtered on it. Keep that field in step with the  */
/*  route's `beforeEnter` guard in router/index.js - if the two   */
/*  disagree the menu offers a link that bounces the user back    */
/*  home, which has happened twice in this codebase.              */
/*                                                                */
/*  It matters because the guards are NOT uniform : showSettings  */
/*  covers most pages, while backups and the server log each      */
/*  have their own option. Filtering per item means an unusable   */
/*  link cannot be rendered, rather than relying on someone       */
/*  remembering to wrap a section by hand.                        */
/*                                                                */
/*  The scheduled and stored jobs are in the jobs menu            */
/*  (AppJobsSidebar), which follows the same rule.                */
/*                                                                */
/******************************************************************/

import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { useAppStore } from '@/stores/app';

const { t } = useI18n();
const store = useAppStore();

// an item with no permission would be visible to everyone, so treat a missing one as
// the strictest case rather than the loosest
const can = (permission) => !!store.profile?.options?.[permission || 'showSettings'];

const sections = computed(() =>
  [
    {
      // The instance itself : configure it, check its health, back it up. First,
      // because "where do I set the url / what version is this / is anything
      // broken" is what an admin opens this menu for most often.
      title: t('sidebar.sections.system'),
      items: [
        { title: t('sidebar.ansibleForms'), icon: 'toolbox', link: '/admin/settings', permission: 'showSettings' },
        { title: t('sidebar.logo'), icon: 'image', link: '/admin/logo', permission: 'showSettings' },
        { title: t('sidebar.status'), icon: 'heart-pulse', link: '/admin/status', permission: 'showSettings' },
        // the database backups : the instance's own data, so with the instance
        { title: t('sidebar.backups'), icon: 'database', link: '/admin/backups', permission: 'allowBackupOps' },
      ],
    },
    {
      // How forms are grouped in the menu, and the global values they can
      // reference. Both edit sections of config.yaml, which is also why they share
      // useFormsConfig.js with the roles page.
      title: t('sidebar.sections.forms'),
      items: [
        { title: t('sidebar.categories'), icon: 'sitemap', link: '/admin/categories', permission: 'showSettings' },
        { title: t('sidebar.constants'), icon: 'sliders-h', link: '/admin/constants', permission: 'showSettings' },
      ],
    },
    {
      // Who may sign in, and what they may do once in. Roles lives here rather
      // than with the other two config.yaml editors : sharing code is not a reason
      // to group them, and permissions belong next to users and groups.
      title: t('sidebar.sections.access'),
      items: [
        { title: t('sidebar.users'), icon: 'user', link: '/admin/users', permission: 'showSettings' },
        { title: t('sidebar.groups'), icon: 'users', link: '/admin/groups', permission: 'showSettings' },
        // 'user-shield' not 'users' : groups already own the people icon, and
        // roles are about what a member may do, not who the members are
        { title: t('sidebar.roles'), icon: 'user-shield', link: '/admin/roles', permission: 'showSettings' },
        { title: t('sidebar.ldap'), icon: 'globe', link: '/admin/ldap', permission: 'showSettings' },
        { title: t('sidebar.oauth2'), icon: 'fac,oauth', link: '/admin/oauth2', permission: 'showSettings' },
      ],
    },
    {
      // Outbound : the systems AnsibleForms reaches and the credentials for them.
      // Mail belongs here rather than under a section of its own - it is an smtp
      // host with a port, tls and a username/password, the same shape as aap and
      // repositories, and it has the same 'test the connection' action.
      title: t('sidebar.sections.connections'),
      items: [
        { title: t('sidebar.mail'), icon: 'envelope', link: '/admin/mailSettings', permission: 'showSettings' },
        { title: t('sidebar.credentials'), icon: 'lock', link: '/admin/credentials', permission: 'showSettings' },
        { title: t('sidebar.secretStores'), icon: 'vault', link: '/admin/secretStores', permission: 'showSettings' },
        { title: t('sidebar.ssh'), icon: 'key', link: '/admin/ssh', permission: 'showSettings' },
        { title: t('sidebar.knownHosts'), icon: 'server', link: '/admin/knownHosts', permission: 'showSettings' },
        { title: t('sidebar.aap'), icon: 'fac,ansible', link: '/admin/aap', permission: 'showSettings' },
        { title: t('sidebar.repositories'), icon: 'fab,git', link: '/admin/repositories', permission: 'showSettings' },
        { title: t('sidebar.chat'), icon: 'comments', link: '/admin/chat', permission: 'showSettings' },
      ],
    },
    {
      // What happened on the instance : who changed what (the audit log), and what
      // the server itself reported (the server log, for troubleshooting). Last : the
      // sections above are what you set up, these are read afterwards.
      title: t('sidebar.sections.logs'),
      items: [
        { title: t('sidebar.audit'), icon: 'clipboard-list', link: '/admin/audit', permission: 'showSettings' },
        { title: t('sidebar.logs'), icon: 'file-lines', link: '/logs', permission: 'showLogs' },
      ],
    },
  ]
    .map((s) => ({ ...s, items: s.items.filter((i) => can(i.permission)) }))
    .filter((s) => s.items.length > 0),
);
</script>
<template>
  <BsSidebar :sections="sections" />
</template>
<style scoped></style>
