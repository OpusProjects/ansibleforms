// The pages the header search finds, besides the forms.
//
// Every page carries the role option its route requires (`permission`), like the entries of
// the left menus (AppSidebar, AppJobsSidebar) : the search only offers the pages the user may
// open, so a result never bounces them back home. A page without a permission has no guard.
// tests/search.test.js checks each one against the route's `beforeEnter` guard.

/**
 * Lists the pages the user may open, for the header search.
 *
 * Args:
 *   t (function): the vue-i18n translate function.
 *   options (object): the role options of the signed-in user (profile.options).
 *
 * Returns:
 *   object[]: the pages, as { title, section, link, icon, permission }.
 */
export function searchPages(t, options) {
  const settings = t('nav.settings');
  const pages = [
    // ---------------------------------------------------------------
    // the header menu
    // ---------------------------------------------------------------
    { title: t('nav.forms'), section: '', icon: 'rectangle-list', link: '/', permission: null },
    { title: t('nav.jobs'), section: '', icon: 'history', link: '/jobs', permission: 'showJobs' },
    { title: t('nav.designer'), section: '', icon: 'pen-to-square', link: '/designer', permission: 'showDesigner' },
    { title: t('nav.profile'), section: '', icon: 'user-gear', link: '/profile', permission: null },
    { title: t('nav.apiDocs'), section: '', icon: 'code', link: '/api-docs', permission: null },

    // ---------------------------------------------------------------
    // the jobs menu
    // ---------------------------------------------------------------
    {
      title: t('sidebar.schedules'),
      section: t('nav.jobs'),
      icon: 'clock',
      link: '/jobs/schedules',
      permission: 'allowScheduledJobs',
    },
    {
      title: t('sidebar.storedJobs'),
      section: t('nav.jobs'),
      icon: 'floppy-disk',
      link: '/jobs/stored',
      permission: 'allowStoredJobs',
    },

    // ---------------------------------------------------------------
    // the settings menu
    // ---------------------------------------------------------------
    {
      title: t('sidebar.ansibleForms'),
      section: settings,
      icon: 'toolbox',
      link: '/admin/settings',
      permission: 'showSettings',
    },
    { title: t('sidebar.logo'), section: settings, icon: 'image', link: '/admin/logo', permission: 'showSettings' },
    {
      title: t('sidebar.status'),
      section: settings,
      icon: 'heart-pulse',
      link: '/admin/status',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.backups'),
      section: settings,
      icon: 'database',
      link: '/admin/backups',
      permission: 'allowBackupOps',
    },
    {
      title: t('sidebar.categories'),
      section: settings,
      icon: 'sitemap',
      link: '/admin/categories',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.constants'),
      section: settings,
      icon: 'sliders-h',
      link: '/admin/constants',
      permission: 'showSettings',
    },
    { title: t('sidebar.users'), section: settings, icon: 'user', link: '/admin/users', permission: 'showSettings' },
    { title: t('sidebar.groups'), section: settings, icon: 'users', link: '/admin/groups', permission: 'showSettings' },
    {
      title: t('sidebar.roles'),
      section: settings,
      icon: 'user-shield',
      link: '/admin/roles',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.ldap'),
      section: settings,
      icon: 'address-book',
      link: '/admin/ldap',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.oauth2'),
      section: settings,
      icon: 'right-to-bracket',
      link: '/admin/sso',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.mail'),
      section: settings,
      icon: 'envelope',
      link: '/admin/mailSettings',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.credentials'),
      section: settings,
      icon: 'lock',
      link: '/admin/credentials',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.secretStores'),
      section: settings,
      icon: 'vault',
      link: '/admin/secretStores',
      permission: 'showSettings',
    },
    { title: t('sidebar.ssh'), section: settings, icon: 'key', link: '/admin/ssh', permission: 'showSettings' },
    {
      title: t('sidebar.knownHosts'),
      section: settings,
      icon: 'server',
      link: '/admin/knownHosts',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.runners'),
      section: settings,
      icon: 'rocket',
      link: '/admin/runners',
      permission: 'showSettings',
    },
    {
      title: t('sidebar.repositories'),
      section: settings,
      icon: 'fab,git',
      link: '/admin/repositories',
      permission: 'showSettings',
    },
    { title: t('sidebar.chat'), section: settings, icon: 'comments', link: '/admin/chat', permission: 'showSettings' },
    { title: t('sidebar.mcp'), section: settings, icon: 'robot', link: '/admin/mcp', permission: 'showSettings' },
    {
      title: t('sidebar.audit'),
      section: settings,
      icon: 'clipboard-list',
      link: '/admin/audit',
      permission: 'showSettings',
    },
    { title: t('sidebar.logs'), section: settings, icon: 'file-lines', link: '/admin/logs', permission: 'showLogs' },
  ];
  return pages.filter((p) => !p.permission || !!options?.[p.permission]);
}
