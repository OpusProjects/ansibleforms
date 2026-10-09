// These settings define the gui admin pages
// Accepts a t() function from vue-i18n for translations
import { editorStyle } from './editorStyle';
import Helpers from '@/lib/Helpers';
import i18n from '@/plugins/i18n';
import { describeCron } from '@/config/cronDescribe';
import { cronValidationMessage } from './cron';
import { headerWidth } from '@/lib/tableCells';

// A cron field is validated with the SAME check the editor uses (config/cron.js), which
// is the only thing that keeps the two from disagreeing.
//
// It used to be a hand written regex here. A regex cannot compare the two ends of a range,
// so `0 0 * * 5-1` passed the save validator and croner then refused it - cron.service.js
// logs 'Invalid cron expression' and returns, so the row saved and the job was never
// registered, with nothing on screen to say the repository had stopped syncing. The regex
// also rejected the month and weekday NAMES that croner accepts and that BsCron already
// previewed as valid, so the editor described a schedule the form then refused to save.
//
// The server refuses a bad expression too (lib/cronValidate.js, called from CrudModel), so
// this is the early, explanatory answer rather than the only line of defence.
const cronValidator = (t) => (value) => cronValidationMessage(t, value);

// The chat assistant's providers (server/src/chat/vendors.js has the same list and defaults) :
// choosing one fills in its base url, auth type and api version, which stay editable
export const CHAT_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', base_url: 'https://api.anthropic.com' },
  { value: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1' },
  { value: 'azure', label: 'Azure OpenAI', base_url: '', auth_type: 'api-key', api_version: '2024-10-21' },
  { value: 'gemini', label: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { value: 'grok', label: 'xAI Grok', base_url: 'https://api.x.ai/v1' },
  { value: 'mistral', label: 'Mistral', base_url: 'https://api.mistral.ai/v1' },
  { value: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
  { value: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
  { value: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  { value: 'ollama', label: 'Ollama', base_url: 'http://localhost:11434/v1', auth_type: 'none' },
  { value: 'custom', base_url: '' },
];

// The secret store types (server/src/secrets/providers/index.js has the same list)
// for render() output, which goes to v-html : nothing reaches it unescaped, a locale string included
const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A cron in a table cell, with what it means in words in a popover (describeCron), in the
 * app's language : hovering '0 6 * * 0' says 'At 06:00 AM, only on Sunday'.
 *
 * Args:
 *   value (string): the cron expression.
 *
 * Returns:
 *   string: the cell's HTML, escaped.
 */
function cronCell(value) {
  const words = describeCron(value, i18n.global.locale.value);
  if (!words) return escapeHtml(value ?? '');
  // the popover AppAdminMulti opens on hover (data-af-popover), the look of the info popovers
  return `<span class="af-has-popover" data-af-popover="${escapeHtml(words)}">${escapeHtml(value ?? '')}</span>`;
}

// what a credential is for (its type), in the order the dialog offers them
export const CREDENTIAL_TYPES = ['ssh', 'git', 'api', 'database'];

// The flavours of an awx runner (server/src/models/runner.model.js has the same list) : which
// product it is (its uri carries its API path)
export const RUNNER_FLAVOURS = [
  { value: null, label: 'AWX' },
  { value: 'aap', label: 'Ansible Automation Platform' },
  { value: 'ascender', label: 'Ascender' },
];

// what a runner is, in the dialog : an RTE, or an awx runner of one of its flavours (none is
// AWX) - stored as its type and flavour
export const RUNNER_KINDS = ['rte', 'awx', 'aap', 'ascender'];
// an example address of each kind : an awx runner's with its API path (AAP 2.5+ behind its
// gateway)
const RUNNER_URI_EXAMPLE = {
  rte: 'https://rte-vmware:8000',
  awx: 'https://awx.example.com/api/v2',
  aap: 'https://aap.example.com/api/controller/v2',
  ascender: 'https://ascender.example.com/api/v2',
};

/**
 * A runner's kind, from its type and flavour.
 *
 * Args:
 *   r (object): the runner (type, flavour) ; none for a new one.
 *
 * Returns:
 *   string: rte, awx, aap or ascender.
 */
export function runnerKind(r) {
  if (!r?.type || r.type === 'rte') return 'rte';
  return ['aap', 'ascender'].includes(r.flavour) ? r.flavour : 'awx';
}

export const SECRET_STORE_TYPES = [
  { value: 'vault', label: 'HashiCorp Vault' },
  { value: 'cyberark_ccp', label: 'CyberArk Central Credential Provider', short: 'CyberArk CCP' },
];

export default function getSettings(t) {
  return {
    users: {
      type: 'user',
      route: 'users',
      label: t('settings.users.label'),
      description: t('settings.users.description'),
      icon: 'user',
      selectable: false,
      // a user has its own page (pages/admin/user.vue) : its row and Edit open it, New the wizard
      openPage: (item) => `/admin/users/${item.id}`,
      // the dialog in steps : who the user is, the password (editing : left empty, it stays), the
      // group that gives the roles
      steps: [
        { key: 'user', label: t('settings.users.stepUser') },
        { key: 'password', label: t('settings.users.stepPassword') },
        { key: 'group', label: t('settings.users.stepGroup') },
      ],
      // in the row menu : editing, the groups, the password, then Delete last, each apart
      actions: [
        { name: 'edit', title: t('settings.users.editUser'), icon: 'pencil', color: 'edit' },
        // the user's Groups tab, its Add group dialog open
        {
          name: 'add_group',
          title: t('settings.users.addToGroup'),
          icon: 'users',
          color: 'edit',
          dividerBefore: true,
          to: (u) => ({ path: `/admin/users/${u.id}`, query: { tab: 'groups', add: '1' } }),
        },
        {
          name: 'change_password',
          title: t('settings.common.changePassword'),
          icon: 'lock',
          color: 'change',
          dividerBefore: true,
        },
        {
          name: 'delete',
          title: t('settings.users.deleteUser'),
          icon: 'trash',
          color: 'delete',
          // the admin user is the way back in : never deleted (the server refuses it too)
          enabledWhen: (u) => u.username !== 'admin',
        },
      ],
      fields: [
        {
          key: 'id',
          label: t('settings.fields.id'),
          sortable: false,
          required: false,
          filterable: false,
          noInput: true,
          hidden: true,
          icon: 'key',
        },
        {
          key: 'username',
          label: t('settings.fields.username'),
          sortable: true,
          required: true,
          filterable: true,
          icon: 'user',
        },
        // who the user is, or what the account is for (a service account)
        {
          key: 'description',
          label: t('settings.fields.description'),
          sortable: true,
          required: false,
          filterable: true,
          icon: 'info-circle',
        },
        {
          key: 'password',
          step: 'password',
          // shown when editing too, as ******** : left empty, the stored one stays
          onEdit: true,
          label: t('settings.fields.password'),
          type: 'password',
          sortable: false,
          required: true,
          filterable: false,
          hidden: true,
          icon: 'lock',
        },
        {
          key: 'email',
          label: t('settings.fields.email'),
          type: 'email',
          sortable: false,
          required: false,
          filterable: true,
          icon: 'envelope',
        },
        {
          key: 'group_id',
          // in the dialog, not in the table : the user's page has a Groups tab
          noTable: true,
          step: 'group',
          label: t('settings.fields.group'),
          type: 'select',
          sortable: false,
          required: true,
          filterable: true,
          icon: 'users',
          parent: 'group',
          values: 'group',
          valueKey: 'id',
          labelKey: 'name',
        },
        // how many groups the user is in : a column, last, to the right ; not in the dialog
        {
          key: 'group_ids',
          label: t('sidebar.groups'),
          noInput: true,
          align: 'end',
          // narrow, beside the row menu : the other columns take the room
          width: '8.5rem',
          filterable: false,
          filterType: 'number',
          sortValue: (row) => (row.group_ids || []).length,
          render: (v) => String((v || []).length),
        },
      ],
    },
    groups: {
      type: 'group',
      label: t('settings.groups.label'),
      description: t('settings.groups.description'),
      icon: 'users',
      selectable: false,
      children: [
        {
          type: 'user',
          label: t('settings.users.label'),
          labelPlural: t('settings.users.labelPlural'),
          icon: 'user',
          // every group of a user (its first one and the others), not its first only
          key: 'group_ids',
        },
      ],
      // a group has its own page (pages/admin/group.vue) : its row and Edit open it, New the dialog
      openPage: (item) => `/admin/groups/${item.id}`,
      // in the row menu : editing, its users, then Delete last, each apart
      actions: [
        { name: 'edit', title: t('settings.groups.editGroup'), icon: 'pencil', color: 'edit' },
        // the group's Users tab, its Add user dialog open
        {
          name: 'add_user',
          title: t('settings.groups.addUserToGroup'),
          icon: 'user',
          color: 'edit',
          dividerBefore: true,
          to: (g) => ({ path: `/admin/groups/${g.id}`, query: { tab: 'users', add: '1' } }),
        },
        {
          name: 'delete',
          title: t('settings.groups.deleteGroup'),
          icon: 'trash',
          color: 'delete',
          // the admins group is never deleted (the server refuses it too)
          enabledWhen: (g) => g.name !== 'admins',
        },
      ],
      fields: [
        {
          key: 'id',
          label: t('settings.fields.id'),
          sortable: false,
          required: false,
          filterable: false,
          noInput: true,
          hidden: true,
          icon: 'key',
        },
        {
          key: 'name',
          label: t('settings.fields.name'),
          sortable: true,
          required: true,
          filterable: true,
          icon: 'users',
        },
        // what the group is for, or who owns it
        {
          key: 'description',
          label: t('settings.fields.description'),
          sortable: true,
          required: false,
          filterable: true,
          icon: 'info-circle',
        },
        // how many users are in the group (the server counts them) : a column, last, to the right
        {
          key: 'user_count',
          label: t('settings.users.labelPlural'),
          noInput: true,
          align: 'end',
          // narrow, beside the row menu : the other columns take the room
          width: '7rem',
          filterable: false,
          filterType: 'number',
          // none : an en dash, as the other empty cells
          render: (v) => (v ? String(v) : '–'),
        },
      ],
      childFields: {
        user: [
          { key: 'username', label: t('settings.fields.username') },
          { key: 'email', label: t('settings.fields.email') },
          { key: 'group_id', label: t('settings.fields.group'), hidden: true },
        ],
      },
    },
    repositories: {
      type: 'repository',
      label: t('settings.repositories.label'),
      labelPlural: t('settings.repositories.labelPlural'),
      description: t('settings.repositories.description'),
      // reloadSeconds: 7,
      icon: 'fab,git',
      idKey: 'name',
      selectable: false,
      // Scheduled pull off : no schedule ; the switch itself is not stored
      beforeSave: ({ pull_scheduled, ...item }) => (pull_scheduled ? item : { ...item, cron: '' }),
      // the dialog in steps : what the repository is, the credentials to reach it, what it is used
      // for, when it syncs
      steps: [
        { key: 'repository', label: t('settings.repositories.stepRepository') },
        { key: 'access', label: t('settings.repositories.stepCredentials') },
        { key: 'usage', label: t('settings.repositories.stepUsage') },
        { key: 'schedule', label: t('settings.repositories.stepSchedule') },
      ],
      actions: [
        { name: 'edit', icon: 'pencil', title: t('settings.repositories.editRepository'), color: 'edit' },
        { name: 'delete', icon: 'trash', title: t('settings.repositories.deleteRepository'), color: 'delete' },
        { name: 'change_password', icon: 'lock', title: t('settings.common.changePassword'), color: 'change' },
        { name: 'trigger', icon: 'play', title: t('settings.common.trigger'), color: 'test' },
        { name: 'preview', icon: 'info-circle', title: t('settings.common.showOutput'), color: 'preview' },
        { name: 'reset', icon: 'redo', title: t('settings.repositories.resetRepository'), color: 'refresh' },
        {
          name: 'sync',
          icon: 'upload',
          title: t('settings.repositories.syncRepository'),
          color: 'test',
          dependency: ['use_for_forms', 'use_for_config'],
        },
      ],
      fields: [
        { key: 'id', hidden: true, noInput: true },
        { key: 'output', hidden: true, noInput: true },
        {
          key: 'name',
          icon: 'heading',
          label: t('settings.fields.name'),
          placeholder: 'my_repo_name',
          readonly: false,
          required: true,
          help: t('settings.repositories.helpName'),
        },
        {
          key: 'branch',
          icon: 'code-branch',
          label: t('settings.fields.branch'),
          placeholder: 'main',
          readonly: false,
        },
        { key: 'head', label: t('settings.fields.head'), noInput: true },
        { key: 'status', label: t('settings.fields.status'), noInput: true },
        {
          // a credential of Connections > Credentials, or a New one : the user and password git
          // uses
          key: 'credential',
          step: 'access',
          icon: 'key',
          label: t('settings.repositories.credential'),
          help: t('settings.repositories.helpCredential'),
          type: 'select',
          parent: 'credentials',
          values: 'credential',
          valueKey: 'name',
          labelKey: 'name',
          clearable: true,
          hidden: true,
          createWith: 'credentials',
          createLabel: t('settings.repositories.newCredential'),
          // a credential for git
          createDefaults: { credential_type: 'git' },
        },
        {
          key: 'user',
          // in the credential now ; kept on the record for the repositories that still have one
          noInput: true,
          icon: 'user',
          label: t('settings.fields.username'),
          placeholder: 'my-user',
          hidden: true,
        },
        {
          key: 'password',
          // in the credential now : on no step of the dialog, only behind Change password for the
          // repositories that still have their own
          step: 'own',
          icon: 'lock',
          label: t('settings.fields.password'),
          type: 'password',
          placeholder: t('settings.repositories.placeholderPassword'),
          hidden: true,
        },
        {
          key: 'uri',
          icon: 'fab,git',
          label: t('settings.fields.uri'),
          placeholder: 'https://github.com/account/repo.git',
          required: true,
          hidden: true,
          help: t('settings.repositories.helpUri'),
        },
        {
          // pulled on a schedule or not : not stored, read from the schedule (beforeSave clears
          // the schedule when off)
          key: 'pull_scheduled',
          step: 'schedule',
          type: 'checkbox',
          // at the dialog's left edge, its help on one line
          flush: true,
          label: t('settings.repositories.scheduledPull'),
          help: t('settings.repositories.helpScheduledPull'),
          hidden: true,
          noTable: true,
          initial: (r) => !!(r?.cron && String(r.cron).trim()),
        },
        {
          key: 'cron',
          step: 'schedule',
          icon: 'stopwatch',
          // under Scheduled Pull : what it schedules is said there
          label: t('settings.repositories.stepSchedule'),
          type: 'cron',
          hidden: true,
          // only with Scheduled pull on, and then needed : the switch on with no schedule
          // would save as off
          dependency: 'pull_scheduled',
          required: true,
          validator: cronValidator(t),
        },
        {
          key: 'rebase_on_start',
          step: 'schedule',
          type: 'checkbox',
          flush: true,
          label: t('settings.repositories.cloneOnStart'),
          help: t('settings.repositories.helpCloneOnStart'),
          hidden: true,
        },
        {
          key: 'description',
          icon: 'info-circle',
          label: t('settings.fields.description'),
          placeholder: t('settings.fields.description'),
          required: true,
        },
        {
          key: 'use_for_config',
          step: 'usage',
          // the app uses one repository for it
          oneOnly: true,
          shortLabel: t('settings.repositories.useConfigShort'),
          shortHint: t('settings.repositories.useConfigHint'),
          isSwitch: false,
          type: 'checkbox',
          label: t('settings.repositories.useForConfig'),
          help: t('settings.repositories.helpUseForConfig'),
          hidden: true,
        },
        {
          key: 'use_for_forms',
          step: 'usage',
          shortLabel: t('settings.repositories.useFormsShort'),
          shortHint: t('settings.repositories.useFormsHint'),
          isSwitch: false,
          type: 'checkbox',
          label: t('settings.repositories.useForForms'),
          help: t('settings.repositories.helpUseForForms'),
          hidden: true,
        },
        {
          key: 'use_for_playbooks',
          step: 'usage',
          // the app uses one repository for it
          oneOnly: true,
          shortLabel: t('settings.repositories.usePlaybooksShort'),
          shortHint: t('settings.repositories.usePlaybooksHint'),
          isSwitch: false,
          type: 'checkbox',
          label: t('settings.repositories.useForPlaybooks'),
          help: t('settings.repositories.helpUseForPlaybooks'),
          hidden: true,
        },
        {
          key: 'use_for_vars_files',
          step: 'usage',
          // the app uses one repository for it
          oneOnly: true,
          shortLabel: t('settings.repositories.useVarsFilesShort'),
          shortHint: t('settings.repositories.useVarsFilesHint'),
          isSwitch: false,
          type: 'checkbox',
          label: t('settings.repositories.useForVarsFiles'),
          help: t('settings.repositories.helpUseForVarsFiles'),
          hidden: true,
        },
      ],
    },
    oauth2_providers: {
      // the page title is the menu entry's label (AppSidebar), so the two always match
      pageTitle: t('sidebar.oauth2'),
      type: 'oauth2',
      route: 'oauth2',
      label: t('settings.oauth2.label'),
      labelPlural: t('settings.oauth2.labelPlural'),
      description: t('settings.oauth2.description'),
      icon: 'right-to-bracket',
      selectable: false,
      // a provider has its own page (pages/admin/sso-provider.vue) : its row and Edit open it, Add the wizard
      openPage: (item) => `/admin/sso/${item.id}`,
      // the dialog in steps : the provider, how the app signs in with it, its groups. The help a
      // provider needs (the permissions of an Entra ID app, what Open ID was tested with) is in
      // the step it is for
      steps: [
        { key: 'provider', label: t('settings.oauth2.stepProvider') },
        {
          key: 'signin',
          label: t('settings.oauth2.stepSignIn'),
          notes: (item) => [
            item.provider === 'azuread' && {
              title: t('admin.oauth2.requiredPermissions'),
              items: [t('admin.oauth2.delegatedUserRead'), t('admin.oauth2.delegatedGroupRead')],
            },
            item.provider === 'oidc' && { text: t('admin.oauth2.openIdTestedWith') },
          ],
        },
        {
          key: 'groups',
          label: t('settings.oauth2.stepGroups'),
          notes: (item) => [
            item.provider === 'azuread' && {
              title: t('admin.oauth2.groupMembership'),
              items: [t('admin.oauth2.groupsFromGraph'), t('admin.oauth2.groupsRoleMapping')],
            },
          ],
        },
      ],
      actions: [
        { name: 'edit', title: t('settings.oauth2.editProvider'), icon: 'pencil', color: 'edit' },
        // the one its type signs in with : the others of its type stop being it (oauth2.model)
        {
          name: 'use',
          title: t('settings.oauth2.useForSignIn'),
          icon: 'right-to-bracket',
          color: 'edit',
          dividerBefore: true,
          enabledWhen: (p) => !p.enable,
          update: (p) => ({ enable: 1, provider: p.provider }),
        },
        {
          name: 'change_password',
          dividerBefore: true,
          // a provider has a client secret, not a password
          title: t('settings.oauth2.changeSecret'),
          icon: 'lock',
          color: 'change',
        },
        { name: 'delete', title: t('settings.oauth2.deleteProvider'), icon: 'trash', color: 'delete' },
      ],
      fields: [
        // the provider its type signs in with (one per type) : a yes / no column, not in the dialog ;
        // a new one is it when its type has none, another is chosen with Use for sign-in
        {
          key: 'enable',
          label: t('settings.oauth2.active'),
          type: 'checkbox',
          noInput: true,
          width: '7rem',
        },
        {
          key: 'provider',
          label: t('settings.oauth2.provider'),
          required: true,
          icon: 'cloud',
          type: 'select',
          parent: 'providers',
          values: [
            { label: 'Entra ID', value: 'azuread' },
            { label: 'Open ID', value: 'oidc' },
          ],
          valueKey: 'value',
          labelKey: 'label',
        },
        { key: 'name', label: t('settings.fields.name'), required: true, icon: 'heading' },
        { key: 'description', label: t('settings.fields.description'), required: false, icon: 'info-circle' },
        {
          key: 'tenant_id',
          step: 'signin',
          label: t('settings.oauth2.tenantId'),
          required: false,
          icon: 'building',
          dependency: 'provider',
          dependencyValues: ['azuread'],
          hidden: true,
          help: t('settings.oauth2.tenantIdHelp'),
        },
        {
          key: 'client_id',
          step: 'signin',
          label: t('settings.oauth2.clientId'),
          required: true,
          icon: 'key',
          dependency: 'provider',
          dependencyValues: ['azuread', 'oidc'],
          hidden: true,
        },
        {
          key: 'issuer',
          step: 'signin',
          label: t('settings.oauth2.issuer'),
          required: true,
          icon: 'globe',
          dependency: 'provider',
          dependencyValues: ['oidc'],
          hidden: true,
        },
        {
          key: 'redirect_uri',
          step: 'signin',
          label: t('settings.oauth2.redirectUrl'),
          readonly: false,
          dependency: 'provider',
          dependencyValues: ['azuread', 'oidc'],
          defaultMap: {
            azuread: (config) => `${config.url}/api/v2/auth/azureadoauth2/callback`,
            oidc: (config) => `${config.url}/api/v2/auth/oidc/callback`,
          },
          hidden: true,
        },
        {
          key: 'client_secret',
          step: 'signin',
          label: t('settings.oauth2.clientSecret'),
          type: 'password',
          required: true,
          icon: 'lock',
          hidden: true,
        },
        {
          key: 'groupfilter',
          step: 'groups',
          label: t('settings.oauth2.groupFilter'),
          required: false,
          icon: 'filter',
          hidden: true,
        },
        {
          key: 'scope',
          step: 'signin',
          label: t('settings.oauth2.scope'),
          required: false,
          icon: 'list',
          dependency: 'provider',
          dependencyValues: [''],
          hidden: true,
        },
        {
          key: 'auth_url',
          step: 'signin',
          label: t('settings.oauth2.authUrl'),
          required: false,
          icon: 'globe',
          dependency: 'provider',
          dependencyValues: [''],
          hidden: true,
        },
        {
          key: 'token_url',
          step: 'signin',
          label: t('settings.oauth2.tokenUrl'),
          required: false,
          icon: 'globe',
          dependency: 'provider',
          dependencyValues: [''],
          hidden: true,
        },
        {
          key: 'userinfo_url',
          step: 'signin',
          label: t('settings.oauth2.userinfoUrl'),
          required: false,
          icon: 'globe',
          dependency: 'provider',
          dependencyValues: [''],
          hidden: true,
        },
        {
          key: 'extra',
          step: 'signin',
          label: t('settings.oauth2.extra'),
          type: 'textarea',
          required: false,
          icon: 'code',
          dependency: 'provider',
          dependencyValues: [''],
          hidden: true,
        },
      ],
    },
    schedules: {
      type: 'schedule',
      label: t('settings.schedules.label'),
      labelPlural: t('settings.schedules.labelPlural'),
      description: t('settings.schedules.description'),
      // reloadSeconds: 7,
      icon: 'clock',
      selectable: false,
      // the dialog in steps : what runs (its name, the form), when (once at a time, or on a cron
      // schedule), the extra vars it sends to the form
      steps: [
        { key: 'schedule', label: t('settings.schedules.stepSchedule') },
        { key: 'when', label: t('settings.schedules.stepWhen') },
        { key: 'vars', label: t('settings.schedules.stepExtraVars') },
      ],
      actions: [
        { name: 'edit', icon: 'pencil', title: t('settings.schedules.editSchedule'), color: 'edit' },
        { name: 'delete', icon: 'trash', title: t('settings.schedules.deleteSchedule'), color: 'delete' },
        { name: 'trigger', icon: 'play', title: t('settings.schedules.runSchedule'), color: 'refresh' },
        { name: 'preview', icon: 'info-circle', title: t('settings.common.showOutput'), color: 'preview' },
      ],
      // the table's columns share its width (the widths below) : a date with its time and zone
      // gets room around it at any screen width, the one word columns (status, state) less
      fields: [
        { key: 'id', hidden: true, noInput: true },
        { key: 'output', hidden: true, noInput: true },
        {
          key: 'name',
          width: '18%',
          icon: 'heading',
          label: t('settings.fields.name'),
          placeholder: t('settings.schedules.placeholderName'),
          readonly: false,
          required: true,
          help: t('settings.repositories.helpName'),
        },
        {
          key: 'one_time_run',
          step: 'when',
          label: t('settings.schedules.oneTimeRun'),
          type: 'checkbox',
          placeholder: t('settings.schedules.oneTimeRunPlaceholder'),
          required: false,
          hidden: true,
        },
        {
          key: 'cron',
          width: '14%',
          step: 'when',
          icon: 'stopwatch',
          label: t('settings.fields.cronSchedule'),
          type: 'cron',
          // a recurring schedule needs its cron ; hidden (one time run), it is not checked
          required: true,
          // in the table : hovering the cron says it in words, in the app's language
          render: cronCell,
          validator: cronValidator(t),
          negateDependency: true,
          dependency: 'one_time_run',
        },
        {
          key: 'run_at',
          step: 'when',
          icon: 'calendar',
          label: t('settings.schedules.runAt'),
          type: 'datetime',
          convertToUtc: true,
          help: t('settings.schedules.runAtHelp'),
          // in the table, Next run says it (and a cron schedule's next run too) : this column is
          // there to pick in Columns
          hidden: true,
          render: (v) => (v ? Helpers.formatServerDate(v) : '–'),
          // a one time run needs its time ; hidden (a cron schedule), it is not checked
          required: true,
          dependency: 'one_time_run',
        },
        {
          key: 'form',
          icon: 'pen-to-square',
          label: t('settings.fields.form'),
          type: 'select',
          parent: 'formnames',
          values: 'config/formnames',
          valueKey: 'name',
          labelKey: 'name',
          readonly: false,
          required: true,
          hidden: true,
        },
        // when it runs next : its cron's next occurrence, or its one time run while ahead (the
        // server computes it, schedule.model.js)
        {
          key: 'next_run',
          width: '21%',
          label: t('settings.schedules.nextRun'),
          type: 'datetime',
          noInput: true,
          render: (v) => (v ? Helpers.formatServerDate(v) : '–'),
        },
        // none yet (a schedule that never ran) : an en dash rather than an empty cell
        {
          key: 'status',
          width: '10%',
          label: t('settings.fields.status'),
          noInput: true,
          render: (v) => (v ? escapeHtml(v) : '–'),
        },
        // none yet (a schedule that never ran) : an en dash rather than an empty cell
        {
          key: 'state',
          width: '9%',
          label: t('settings.fields.state'),
          noInput: true,
          render: (v) => (v ? escapeHtml(v) : '–'),
        },
        {
          key: 'last_run',
          width: '20%',
          label: t('settings.fields.lastRun'),
          type: 'datetime',
          noInput: true,
          render: (v) => (v ? Helpers.formatServerDate(v) : '–'),
        },
        {
          key: 'extra_vars',
          step: 'vars',
          type: 'editor',
          label: t('settings.fields.extraVars'),
          hidden: true,
          lang: 'yaml',
          style: editorStyle('40vh'),
          help: t('settings.schedules.extraVarsHelp'),
        },
      ],
    },
    stored_jobs: {
      type: 'stored-jobs',
      label: t('settings.storedJobs.label'),
      labelPlural: t('settings.storedJobs.labelPlural'),
      description: t('settings.storedJobs.description'),
      icon: 'floppy-disk',
      reloadSeconds: false, // Disable auto-reload
      noCreate: true,
      actions: [
        { name: 'preview', icon: 'eye', title: t('settings.storedJobs.viewDetails'), color: 'preview' },
        { name: 'delete', icon: 'trash', title: t('settings.storedJobs.deleteJob'), color: 'delete' },
      ],
      fields: [
        { key: 'id', hidden: true, noInput: true },
        { key: 'name', icon: 'heading', label: t('settings.fields.name') },
        { key: 'description', icon: 'info-circle', label: t('settings.fields.description') },
        { key: 'form_name', icon: 'play', label: t('settings.fields.form') },
        { key: 'username', icon: 'user', label: t('settings.storedJobs.userTypeName') },
        { key: 'form_data', hidden: true },
        {
          key: 'created_at',
          icon: 'calendar',
          label: t('settings.fields.createdAt'),
          type: 'datetime',
          // in the user's zone, with its name : the raw value is a UTC ISO string
          render: (v) => Helpers.formatServerDate(v),
        },
        {
          key: 'expires_at',
          icon: 'calendar',
          label: t('settings.fields.expiresAt'),
          type: 'datetime',
          // in the user's zone, with its name : the raw value is a UTC ISO string
          render: (v) => Helpers.formatServerDate(v),
        },
      ],
    },
    knownhosts: {
      type: 'knownhosts',
      label: t('settings.knownhosts.label'),
      description: t('settings.knownhosts.description'),
      removeDoubles: true, // remove double entries
      flat: true, // flat data structure,
      icon: 'server',
      actions: [
        { name: 'preview', title: t('settings.knownhosts.showEntry'), icon: 'info-circle', color: 'change' },
        { name: 'delete', title: t('settings.knownhosts.deleteEntry'), icon: 'trash', color: 'delete' },
      ],
      fields: [
        { key: 'id', label: t('settings.knownhosts.hostEntry'), filterable: true, hidden: true, noInput: true },
        { key: 'name', label: t('settings.knownhosts.hostEntry'), required: false, filterable: true, noInput: true },
        { key: 'host', label: t('settings.fields.host'), required: true, filterable: true, hidden: true },
      ],
    },
    credentials: {
      type: 'credential',
      label: t('settings.credentials.label'),
      description: t('settings.credentials.description'),
      icon: 'lock',
      selectable: false,
      // the dialog in steps : what the credential is, what it is for, its user and password,
      // where they are kept, what it connects to (a login's or a database's host ; git and an
      // api have their address where they are used)
      steps: [
        { key: 'credential', label: t('settings.credentials.stepCredential') },
        { key: 'type', label: t('settings.credentials.stepType') },
        { key: 'login', label: t('settings.credentials.stepLogin') },
        { key: 'store', label: t('settings.credentials.stepStore') },
        {
          key: 'connection',
          label: t('settings.credentials.stepConnection'),
          when: (item) => ['ssh', 'database'].includes(item.credential_type),
        },
      ],
      // where the user and password are kept is not stored : a secret store (then the user and
      // password typed are not kept) or MySQL, the app's database (then no secret store)
      beforeSave: ({ secret_source, ...item }) => {
        if (secret_source === 'store') {
          delete item.user;
          delete item.password;
          return item;
        }
        return { ...item, secret_store: '', secret_ref: '' };
      },
      actions: [
        { name: 'edit', title: t('settings.credentials.editCredential'), icon: 'pencil', color: 'edit' },
        { name: 'delete', title: t('settings.credentials.deleteCredential'), icon: 'trash', color: 'delete' },
        { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
        {
          name: 'test',
          title: t('settings.common.testConnection'),
          icon: 'plug',
          color: 'test',
          dependency: 'is_database',
        },
      ],
      fields: [
        {
          key: 'id',
          label: t('settings.fields.id'),
          sortable: false,
          required: false,
          filterable: false,
          noInput: true,
          hidden: true,
          icon: 'key',
        },
        {
          // where the user and password are kept : MySQL (the app's database, encrypted) or a
          // secret store (not stored, read from the record ; beforeSave clears the other side)
          key: 'secret_source',
          step: 'store',
          label: t('settings.credentials.stepStore'),
          type: 'radio',
          options: [
            {
              value: 'local',
              label: t('settings.credentials.secretLocal'),
              hint: t('settings.credentials.secretLocalHint'),
            },
            {
              value: 'store',
              label: t('settings.credentials.secretFromStore'),
              hint: t('settings.credentials.secretFromStoreHint'),
            },
          ],
          initial: (r) => (r?.secret_store ? 'store' : 'local'),
          hidden: true,
          noTable: true,
        },
        {
          key: 'name',
          label: t('settings.fields.name'),
          sortable: true,
          required: true,
          filterable: true,
          icon: 'lock',
          isKey: true,
        },
        {
          // what it is for : radio buttons ; a host for ssh or a database, its type and name for
          // a database
          key: 'credential_type',
          step: 'type',
          label: t('settings.credentials.type'),
          type: 'radio',
          options: CREDENTIAL_TYPES.map((value) => ({
            value,
            label: t(`settings.credentials.type_${value}`),
            hint: t(`settings.credentials.type_${value}Hint`),
          })),
          // a type the record does not have (none yet, an unknown one) : from its is_database flag
          initial: (r) =>
            CREDENTIAL_TYPES.includes(r?.credential_type)
              ? r.credential_type
              : r?.id && r?.is_database
                ? 'database'
                : 'ssh',
          render: (v, r) =>
            escapeHtml(
              t(`settings.credentials.type_${CREDENTIAL_TYPES.includes(v) ? v : r?.is_database ? 'database' : 'ssh'}`),
            ),
          sortable: true,
          filterable: true,
        },
        {
          // set by the type (the server keeps it in step) : a column only
          key: 'is_database',
          label: t('settings.credentials.forDatabase'),
          noInput: true,
          columnType: 'checkbox',
          filterType: 'boolean',
          hidden: true,
          required: false,
        },
        {
          key: 'user',
          step: 'login',
          label: t('settings.fields.user'),
          sortable: true,
          required: false,
          filterable: true,
          icon: 'user',
        },
        {
          key: 'password',
          step: 'login',
          // shown when editing too, as ******** : left empty, the stored one stays
          onEdit: true,
          label: t('settings.fields.password'),
          type: 'password',
          sortable: false,
          required: false,
          filterable: false,
          icon: 'lock',
          hidden: true,
        },
        {
          key: 'secret_store',
          step: 'store',
          // none yet : only a New secret store button
          createWith: 'secretStores',
          createLabel: t('settings.credentials.newSecretStore'),
          dependency: 'secret_source',
          dependencyValues: ['store'],
          label: t('settings.credentials.secretStore'),
          help: t('settings.credentials.secretStoreHelp'),
          type: 'select',
          parent: 'secretstores',
          values: 'secretstore',
          valueKey: 'name',
          labelKey: 'name',
          clearable: true,
          sortable: false,
          required: false,
          filterable: false,
          icon: 'vault',
          hidden: true,
        },
        {
          key: 'secret_ref',
          // no secret store yet : nothing to refer to
          needsChoicesOf: 'secret_store',
          label: t('settings.credentials.secretRef'),
          placeholder: t('settings.credentials.secretRefPlaceholder'),
          help: t('settings.credentials.secretRefHelp'),
          sortable: false,
          required: false,
          filterable: false,
          icon: 'shield-alt',
          hidden: true,
          step: 'store',
          dependency: 'secret_source',
          dependencyValues: ['store'],
        },
        {
          key: 'host',
          step: 'connection',
          dependency: 'credential_type',
          dependencyValues: ['ssh', 'database'],
          label: t('settings.fields.host'),
          sortable: true,
          required: false,
          filterable: true,
          icon: 'server',
        },
        {
          key: 'port',
          step: 'connection',
          dependency: 'credential_type',
          dependencyValues: ['ssh', 'database'],
          label: t('settings.fields.port'),
          type: 'number',
          sortable: true,
          required: false,
          filterable: false,
          icon: 'arrows-alt-v',
        },
        {
          key: 'description',
          label: t('settings.fields.description'),
          sortable: false,
          hidden: true,
          required: true,
          filterable: false,
          icon: 'info-circle',
        },
        {
          key: 'db_type',
          step: 'connection',
          label: t('settings.credentials.databaseType'),
          type: 'select',
          sortable: false,
          hidden: true,
          required: true,
          parent: 'databases',
          values: [
            { value: 'mysql', label: 'MySQL' },
            { value: 'mssql', label: 'MSSQL' },
            { value: 'postgres', label: 'PostgreSQL' },
            { value: 'oracle', label: 'Oracle' },
            { value: 'mongodb', label: 'MongoDB' },
          ],
          labelKey: 'label',
          valueKey: 'value',
          filterable: true,
          icon: 'database',
          dependency: 'credential_type',
          dependencyValues: ['database'],
        },
        {
          key: 'db_name',
          step: 'connection',
          label: t('settings.credentials.database'),
          sortable: false,
          hidden: true,
          required: false,
          filterable: false,
          icon: 'database',
          dependency: 'credential_type',
          dependencyValues: ['database'],
        },
      ],
    },
    ssh: {
      // the page title is the menu entry's label (AppSidebar), so the two always match
      pageTitle: t('sidebar.ssh'),
      label: t('settings.ssh.label'),
      description: t('settings.ssh.description'),
      type: 'sshkey',
      icon: 'key',
      fields: [
        { key: 'art', label: t('settings.ssh.privateKeyArt'), type: 'sshPrivateKeyArt', line: 0 },
        {
          key: 'key',
          label: t('settings.ssh.privateKey'),
          help: t('settings.ssh.privateKeyHelp'),
          type: 'textarea',
          placeholder: '-----BEGIN RSA PRIVATE KEY-----',
          line: 1,
          required: true,
        },
        {
          key: 'publicKey',
          label: t('settings.ssh.publicKey'),
          help: t('settings.ssh.publicKeyHelp'),
          type: 'sshPublicKey',
          line: 2,
        },
      ],
    },
    ldap: {
      type: 'ldap',
      // Show every field even when LDAP is off, greyed rather than hidden: an admin
      // deciding whether to enable it needs to see what it will ask for.
      showDisabledFields: true,
      label: t('settings.ldap.label'),
      description: t('settings.ldap.description'),
      icon: 'address-book',
      actions: [{ name: 'test', title: t('settings.common.testConnection'), icon: 'plug', dependency: 'enable' }],
      fields: [
        {
          key: 'enable',
          tab: 'general',
          label: t('settings.ldap.enableLdap'),
          help: t('settings.ldap.enableLdapHelp'),
          type: 'checkbox',
          isToggle: true,
        },
        {
          key: 'server',
          tab: 'server',
          icon: 'server',
          line: 0,
          label: t('settings.fields.server'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'port',
          tab: 'server',
          icon: 'arrows-alt-v',
          type: 'number',
          line: 0,
          label: t('settings.fields.port'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'enable_tls',
          tab: 'server',
          label: t('settings.ldap.enableTls'),
          help: t('settings.ldap.enableTlsDesc'),
          type: 'checkbox',
          line: 1,
          dependency: 'enable',
          onChange: (val, item) => {
            if (Number(item.port) === 389 || Number(item.port) === 636) item.port = val ? 636 : 389;
          },
        },
        {
          key: 'ignore_certs',
          tab: 'server',
          hideWhenDisabled: true,
          label: t('settings.ldap.ignoreCerts'),
          help: t('settings.ldap.ignoreCertsDesc'),
          type: 'checkbox',
          line: 1,
          dependency: 'enable_tls',
        },
        {
          key: 'cert',
          tab: 'server',
          hideWhenDisabled: true,
          icon: 'certificate',
          type: 'textarea',
          line: 2,
          label: t('settings.fields.certificate'),
          required: true,
          dependency: 'ignore_certs',
          negateDependency: true,
          placeholder: '-----BEGIN CERTIFICATE-----',
        },
        {
          key: 'ca_bundle',
          tab: 'server',
          hideWhenDisabled: true,
          icon: 'certificate',
          type: 'textarea',
          line: 2,
          label: t('settings.fields.caBundle'),
          required: true,
          dependency: 'ignore_certs',
          negateDependency: true,
          placeholder: '-----BEGIN CERTIFICATE-----',
        },
        {
          key: 'search_base',
          tab: 'users',
          icon: 'search',
          line: 3,
          label: t('settings.ldap.searchBase'),
          help: t('settings.ldap.searchBaseDesc'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'mail_attribute',
          tab: 'users',
          icon: 'envelope',
          line: 3,
          label: t('settings.ldap.mailAttribute'),
          help: t('settings.ldap.mailAttributeDesc'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'bind_user_dn',
          tab: 'server',
          icon: 'user',
          line: 4,
          label: t('settings.ldap.bindUserDn'),
          help: t('settings.ldap.bindUserDnDesc'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'bind_user_pw',
          tab: 'server',
          icon: 'lock',
          line: 4,
          label: t('settings.ldap.bindUserPassword'),
          help: t('settings.ldap.bindUserPasswordDesc'),
          type: 'password',
          required: true,
          dependency: 'enable',
        },
        {
          key: 'username_attribute',
          tab: 'users',
          icon: 'image-portrait',
          line: 5,
          label: t('settings.ldap.usernameAttribute'),
          help: t('settings.ldap.usernameAttributeDesc'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'groups_attribute',
          tab: 'groups',
          icon: 'users',
          line: 5,
          label: t('settings.ldap.groupsAttribute'),
          help: t('settings.ldap.groupsAttributeDesc'),
          required: true,
          dependency: 'enable',
        },
        {
          key: 'groups_search_base',
          tab: 'groups',
          icon: 'users-viewfinder',
          line: 6,
          label: t('settings.ldap.groupsSearchBase'),
          help: t('settings.ldap.groupsSearchBaseDesc'),
          required: false,
          dependency: 'enable',
        },
        {
          key: 'group_class',
          tab: 'groups',
          icon: 'users-rectangle',
          line: 6,
          label: t('settings.ldap.groupClass'),
          help: t('settings.ldap.groupClassDesc'),
          required: false,
          dependency: 'enable',
        },
        {
          key: 'group_member_attribute',
          tab: 'groups',
          icon: 'users-line',
          line: 7,
          label: t('settings.ldap.groupMemberAttribute'),
          help: t('settings.ldap.groupMemberAttributeDesc'),
          required: false,
          dependency: 'enable',
        },
        {
          key: 'group_member_user_attribute',
          tab: 'groups',
          icon: 'user-group',
          line: 7,
          label: t('settings.ldap.groupMemberUserAttribute'),
          help: t('settings.ldap.groupMemberUserAttributeDesc'),
          required: false,
          dependency: 'enable',
        },
        {
          key: 'groupfilter',
          tab: 'groups',
          icon: 'filter',
          line: 8,
          label: t('settings.ldap.groupFilter'),
          help: t('settings.ldap.groupFilterDesc'),
          required: false,
          dependency: 'enable',
        },
      ],
    },
    chat: {
      // the chat assistant's model provider ; the api key never comes back from the server
      type: 'chatsettings',
      showDisabledFields: true,
      label: t('settings.chat.label'),
      description: t('settings.chat.description'),
      icon: 'comments',
      actions: [{ name: 'test', title: t('settings.common.testConnection'), icon: 'plug', dependency: 'provider' }],
      fields: [
        {
          key: 'provider',
          tab: 'provider',
          icon: 'robot',
          line: 0,
          type: 'select',
          label: t('settings.chat.provider'),
          help: t('settings.chat.providerHelp'),
          values: [
            { value: '', label: t('settings.chat.providerNone') },
            ...CHAT_PROVIDERS.map((p) => ({ value: p.value, label: p.label || t('settings.chat.providerCustom') })),
          ],
          onChange: (val, item) => {
            const p = CHAT_PROVIDERS.find((x) => x.value === val);
            if (!p) return;
            item.base_url = p.base_url;
            item.auth_type = p.auth_type || '';
            item.api_version = p.api_version || '';
          },
        },
        {
          key: 'model',
          tab: 'provider',
          icon: 'microchip',
          line: 0,
          label: t('settings.chat.model'),
          help: t('settings.chat.modelHelp'),
          placeholder: 'claude-sonnet-5-5 / gpt-5 / llama3.3',
          required: true,
          dependency: 'provider',
        },
        {
          key: 'base_url',
          tab: 'provider',
          icon: 'link',
          line: 1,
          label: t('settings.chat.baseUrl'),
          help: t('settings.chat.baseUrlHelp'),
          placeholder: 'https://<proxy>/v1',
          dependency: 'provider',
        },
        {
          key: 'api_key',
          tab: 'provider',
          icon: 'key',
          line: 1,
          type: 'password',
          label: t('settings.chat.apiKey'),
          help: t('settings.chat.apiKeyHelp'),
          dependency: 'provider',
        },
        {
          key: 'auth_type',
          tab: 'provider',
          icon: 'id-card',
          line: 2,
          type: 'select',
          label: t('settings.chat.authType'),
          help: t('settings.chat.authTypeHelp'),
          dependency: 'provider',
          values: [
            { value: '', label: t('settings.chat.authDefault') },
            { value: 'bearer', label: 'Authorization: Bearer' },
            { value: 'api-key', label: 'api-key' },
            { value: 'x-api-key', label: 'x-api-key' },
            { value: 'none', label: t('settings.chat.authNone') },
          ],
        },
        {
          key: 'api_version',
          tab: 'provider',
          icon: 'code-branch',
          line: 2,
          label: t('settings.chat.apiVersion'),
          help: t('settings.chat.apiVersionHelp'),
          placeholder: '2024-10-21',
          dependency: 'provider',
        },
        {
          key: 'request_user',
          tab: 'provider',
          icon: 'user',
          line: 2,
          label: t('settings.chat.user'),
          help: t('settings.chat.userHelp'),
          dependency: 'provider',
        },
        {
          key: 'extra_headers',
          tab: 'provider',
          icon: 'list',
          line: 3,
          type: 'textarea',
          label: t('settings.chat.extraHeaders'),
          help: t('settings.chat.extraHeadersHelp'),
          placeholder: '{"X-Org": "ops"}',
          dependency: 'provider',
        },
        {
          key: 'max_turns',
          tab: 'limits',
          icon: 'comments',
          line: 4,
          type: 'number',
          label: t('settings.chat.maxTurns'),
          help: t('settings.chat.maxTurnsHelp'),
          dependency: 'provider',
        },
        {
          key: 'max_tool_rounds',
          tab: 'limits',
          icon: 'arrows-rotate',
          line: 4,
          type: 'number',
          label: t('settings.chat.maxToolRounds'),
          help: t('settings.chat.maxToolRoundsHelp'),
          dependency: 'provider',
        },
        {
          key: 'timeout_seconds',
          tab: 'limits',
          icon: 'clock',
          line: 4,
          type: 'number',
          label: t('settings.chat.timeout'),
          help: t('settings.chat.timeoutHelp'),
          dependency: 'provider',
        },
        {
          key: 'ignore_certs',
          tab: 'provider',
          line: 5,
          type: 'checkbox',
          label: t('settings.chat.ignoreCerts'),
          help: t('settings.chat.ignoreCertsHelp'),
          dependency: 'provider',
        },
        {
          key: 'allow_job_status',
          tab: 'general',
          line: 5,
          type: 'checkbox',
          label: t('settings.chat.allowJobStatus'),
          help: t('settings.chat.allowJobStatusHelp'),
          dependency: 'provider',
        },
      ],
    },
    // External secret managers. The types mirror SECRET_STORE_TYPES in
    // server/src/secrets/providers/index.js ; which fields a type shows follows its provider.
    // Where a job runs : an RTE container (this image with AF_ROLE=rte) for playbooks,
    // AWX / AAP / Ascender for templates
    runners: {
      // the page title is the menu entry's label (AppSidebar), so the two always match
      pageTitle: t('sidebar.runners'),
      type: 'runner',
      label: t('settings.runners.label'),
      description: t('settings.runners.description'),
      icon: 'rocket',
      selectable: false,
      // the defaults, chosen in a dialog (Edit defaults) : one for playbook forms (an RTE), one
      // for template forms (AWX, AAP or Ascender)
      defaultPicker: {
        key: 'is_default',
        groupBy: (r) => (r?.type === 'rte' ? 'playbook' : 'template'),
        title: t('settings.runners.defaultsTitle'),
        editLabel: t('settings.runners.editDefaults'),
        groups: [
          {
            key: 'playbook',
            label: t('settings.runners.default_playbook'),
            help: t('settings.runners.default_playbookHelp'),
            icon: 'fac,ansible',
            describe: (r) => t(`settings.runners.kind_${runnerKind(r)}`),
          },
          {
            key: 'template',
            label: t('settings.runners.default_template'),
            help: t('settings.runners.default_templateHelp'),
            icon: 'rocket',
            describe: (r) => t(`settings.runners.kind_${runnerKind(r)}`),
          },
        ],
      },
      // the dialog in steps : what the runner is, its kind, where it is, how the app logs in
      steps: [
        { key: 'runner', label: t('settings.runners.stepRunner') },
        { key: 'type', label: t('settings.runners.stepType') },
        { key: 'connection', label: t('settings.runners.stepConnection') },
        { key: 'auth', label: t('settings.runners.stepAuth') },
      ],
      // the kind chosen is stored as a type and a flavour : an RTE, or an awx runner that is an
      // AWX, an AAP or an Ascender. What the api adds or the RTE writes (state, node_id) is
      // never sent.
      beforeSave: ({ kind, skip_verify, custom_ca, state: _state, node_id: _nodeId, ...item }) => ({
        ...item,
        // what is stored : the certificate checked or not, and a private authority's certificates
        // only when checked against one
        ignore_certs: !!skip_verify,
        ca_bundle: !skip_verify && custom_ca ? item.ca_bundle || '' : '',
        // an RTE takes its token ; a user and password are an awx runner's choice only
        ...(kind === 'rte' ? { use_credentials: false } : {}),
        type: kind === 'rte' ? 'rte' : 'awx',
        flavour: ['aap', 'ascender'].includes(kind) ? kind : null,
      }),
      actions: [
        { name: 'edit', title: t('settings.runners.editRunner'), icon: 'pencil', color: 'edit' },
        { name: 'delete', title: t('settings.runners.deleteRunner'), icon: 'trash', color: 'delete' },
        { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
        { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', color: 'test' },
      ],
      fields: [
        {
          key: 'id',
          label: t('settings.fields.id'),
          sortable: false,
          required: false,
          filterable: false,
          noInput: true,
          hidden: true,
          icon: 'key',
        },
        {
          key: 'is_default',
          // a yes / no column : as wide as its header, in the language shown
          width: headerWidth(t('settings.runners.isDefault')),
          label: t('settings.runners.isDefault'),
          help: t('settings.runners.isDefaultHelp'),
          type: 'checkbox',
          // chosen in the Edit defaults dialog (defaultPicker), not in the runner's : a column only
          noInput: true,
        },
        {
          key: 'name',
          icon: 'heading',
          line: 0,
          label: t('settings.fields.name'),
          required: true,
          filterable: true,
          help: t('settings.runners.nameHelp'),
        },
        // set by the api for a runner its RTE registered itself (rte/register.js) : automatic
        // while the RTE writes its heartbeat, unresponsive once it stopped - the worker removes
        // it after 10 minutes. A column only, never sent (beforeSave). render() output goes to
        // v-html : static markup and a locale string only
        {
          key: 'state',
          label: t('settings.runners.state'),
          noInput: true,
          sortable: true,
          render: (v) =>
            v === 'automatic'
              ? `<span class="badge text-bg-info">${escapeHtml(t('settings.runners.stateAutomatic'))}</span>`
              : v === 'unresponsive'
                ? `<span class="badge text-bg-warning">${escapeHtml(t('settings.runners.stateUnresponsive'))}</span>`
                : '',
        },
        {
          // RTE, AWX, AAP or Ascender : one choice, radio buttons (not stored : the type and the
          // flavour are, see beforeSave)
          key: 'kind',
          step: 'type',
          label: t('settings.runners.type'),
          type: 'radio',
          options: RUNNER_KINDS.map((value) => ({
            value,
            label: t(`settings.runners.type_${value}`),
            hint: t(`settings.runners.type_${value}Hint`),
          })),
          initial: runnerKind,
          noTable: true,
        },
        {
          // the list's Type column : the kind's full name
          key: 'type',
          label: t('settings.runners.type'),
          noInput: true,
          filterable: true,
          render: (_, r) => escapeHtml(t(`settings.runners.kind_${runnerKind(r)}`)),
          sortValue: (r) => runnerKind(r),
        },
        {
          key: 'flavour',
          label: t('settings.runners.flavour'),
          noInput: true,
          hidden: true,
          render: (v) => escapeHtml(RUNNER_FLAVOURS.find((x) => x.value === (v || null))?.label || ''),
        },
        {
          key: 'description',
          icon: 'info-circle',
          line: 0,
          label: t('settings.fields.description'),
          required: false,
          hidden: true,
        },
        {
          key: 'uri',
          step: 'connection',
          icon: 'globe',
          line: 1,
          label: t('settings.fields.uri'),
          required: true,
          // the address of the kind chosen
          help: (r) => t(`settings.runners.uriHelp_${r.kind || 'rte'}`),
          placeholder: (r) => RUNNER_URI_EXAMPLE[r.kind] || RUNNER_URI_EXAMPLE.rte,
        },
        {
          // an AWX, AAP or Ascender : an API token, or a user and password - radio buttons
          key: 'use_credentials',
          step: 'auth',
          label: t('settings.runners.stepAuth'),
          type: 'radio',
          options: [
            { value: false, label: t('settings.runners.authToken'), hint: t('settings.runners.authTokenHint') },
            { value: true, label: t('settings.runners.authUser'), hint: t('settings.runners.authUserHint') },
          ],
          initial: (r) => !!r?.use_credentials,
          // an RTE : always its token
          defaultMap: { rte: false },
          columnType: 'checkbox',
          filterType: 'boolean',
          hidden: true,
          password_related: true,
          dependency: 'kind',
          dependencyValues: ['awx', 'aap', 'ascender'],
        },
        {
          key: 'token',
          step: 'auth',
          // shown when editing too, as ******** : left empty, the stored one stays
          onEdit: true,
          keepHelp: t('settings.common.tokenKeep'),
          icon: 'lock',
          line: 1,
          label: t('settings.fields.token'),
          type: 'password',
          required: false,
          hidden: true,
          // an RTE's RTE_TOKEN, or an AWX's API token
          help: (r) => t(`settings.runners.tokenHelp_${r.kind === 'rte' || !r.kind ? 'rte' : 'api'}`),
          dependency: 'use_credentials',
          negateDependency: true,
        },
        {
          key: 'username',
          step: 'auth',
          icon: 'user',
          line: 2,
          label: t('settings.fields.username'),
          required: false,
          hidden: true,
          dependency: 'use_credentials',
        },
        {
          key: 'password',
          step: 'auth',
          onEdit: true,
          icon: 'lock',
          line: 2,
          label: t('settings.fields.password'),
          type: 'password',
          required: false,
          hidden: true,
          dependency: 'use_credentials',
        },
        {
          // the certificate not checked at all : off by default (not stored : ignore_certs is)
          key: 'skip_verify',
          step: 'connection',
          line: 2,
          type: 'checkbox',
          label: t('settings.runners.skipVerify'),
          initial: (r) => !!r?.ignore_certs,
          noTable: true,
        },
        {
          // checked against a private authority : its certificates below (not stored : a CA
          // bundle is, see beforeSave) ; nothing to check against when not checking
          key: 'custom_ca',
          step: 'connection',
          line: 2,
          type: 'checkbox',
          label: t('settings.runners.customCa'),
          initial: (r) => !!String(r?.ca_bundle || '').trim(),
          noTable: true,
          dependency: 'skip_verify',
          negateDependency: true,
          // skipping the verification turns it off : its CA bundle goes with it
          defaultMap: { true: false },
        },
        {
          // a column only : the dialog asks skip_verify
          key: 'ignore_certs',
          label: t('settings.ldap.ignoreCerts'),
          type: 'checkbox',
          noInput: true,
          hidden: true,
        },
        {
          key: 'ca_bundle',
          step: 'connection',
          icon: 'certificate',
          type: 'textarea',
          line: 3,
          label: t('settings.fields.caBundle'),
          required: false,
          // a private authority : the certificates the runner's is checked against
          help: t('settings.runners.caBundleHelp'),
          dependency: 'custom_ca',
          placeholder: '-----BEGIN CERTIFICATE-----',
          hidden: true,
        },
      ],
    },
    secretStores: {
      // the page title is the menu entry's label (AppSidebar), so the two always match
      pageTitle: t('sidebar.secretStores'),
      type: 'secretstore',
      label: t('settings.secretStores.label'),
      description: t('settings.secretStores.description'),
      icon: 'vault',
      selectable: false,
      // the dialog in steps : what the store is, its type, where it is, how the app logs in, the
      // type's options
      steps: [
        { key: 'store', label: t('settings.secretStores.stepStore') },
        { key: 'type', label: t('settings.secretStores.stepType') },
        { key: 'connection', label: t('settings.secretStores.stepConnection') },
        { key: 'auth', label: t('settings.secretStores.stepAuth') },
        { key: 'options', label: t('settings.secretStores.stepOptions') },
      ],
      // the switches are not stored : ignore_certs, a CA bundle and a namespace are
      beforeSave: ({ skip_verify, custom_ca, vault_enterprise, ...item }) => ({
        ...item,
        // no namespace but in a Vault Enterprise
        namespace: item.type === 'vault' && vault_enterprise ? item.namespace || '' : '',
        ignore_certs: !!skip_verify,
        ca_bundle: !skip_verify && custom_ca ? item.ca_bundle || '' : '',
      }),
      actions: [
        { name: 'edit', title: t('settings.secretStores.editStore'), icon: 'pencil', color: 'edit' },
        { name: 'delete', title: t('settings.secretStores.deleteStore'), icon: 'trash', color: 'delete' },
        { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
        { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', color: 'test' },
      ],
      fields: [
        {
          key: 'id',
          label: t('settings.fields.id'),
          sortable: false,
          required: false,
          filterable: false,
          noInput: true,
          hidden: true,
          icon: 'key',
        },
        {
          key: 'name',
          icon: 'heading',
          line: 0,
          label: t('settings.fields.name'),
          required: true,
          filterable: true,
          help: t('settings.secretStores.nameHelp'),
        },
        {
          // HashiCorp Vault or CyberArk CCP : radio buttons ; the list shows its name
          key: 'type',
          step: 'type',
          label: t('settings.secretStores.type'),
          required: true,
          filterable: true,
          type: 'radio',
          // a short name beside the radio, the rest in its hint ; Vault last, its Vault Enterprise
          // switch right under it
          options: [...SECRET_STORE_TYPES].reverse().map(({ value, short, label }) => ({
            value,
            label: short || label,
            hint: t(`settings.secretStores.type_${value}Hint`),
          })),
          initial: (r) => r?.type || 'vault',
          render: (v) => escapeHtml(SECRET_STORE_TYPES.find((x) => x.value === v)?.label || v || ''),
        },
        {
          // a Vault Enterprise : its namespaces (not stored : a namespace is, see beforeSave)
          key: 'vault_enterprise',
          step: 'type',
          type: 'checkbox',
          flush: true,
          label: t('settings.secretStores.enterprise'),
          help: t('settings.secretStores.enterpriseHelp'),
          initial: (r) => !!String(r?.namespace || '').trim(),
          noTable: true,
          dependency: 'type',
          dependencyValues: ['vault'],
          // a CyberArk has no namespaces
          defaultMap: { cyberark_ccp: false },
        },
        {
          key: 'description',
          icon: 'info-circle',
          line: 0,
          label: t('settings.fields.description'),
          required: false,
          hidden: true,
        },
        {
          key: 'url',
          step: 'connection',
          icon: 'globe',
          line: 1,
          label: t('settings.fields.uri'),
          required: true,
          // an example of the type chosen
          placeholder: (r) =>
            r.type === 'cyberark_ccp' ? 'https://ccp.example.com' : 'https://vault.example.com:8200',
          dependency: 'type',
        },
        {
          key: 'token',
          step: 'auth',
          // shown when editing too, as ******** : left empty, the stored one stays
          onEdit: true,
          keepHelp: t('settings.common.tokenKeep'),
          icon: 'lock',
          line: 1,
          label: t('settings.fields.token'),
          type: 'password',
          required: true,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['vault'],
        },
        {
          key: 'namespace',
          step: 'options',
          // only for a Vault Enterprise
          icon: 'folder',
          line: 2,
          label: t('settings.secretStores.namespace'),
          help: t('settings.secretStores.namespaceHelp'),
          required: false,
          hidden: true,
          dependency: 'vault_enterprise',
        },
        {
          // KV v2 or v1 : radio buttons
          key: 'kv_version',
          step: 'options',
          label: t('settings.secretStores.kvVersion'),
          type: 'radio',
          options: [
            { value: 2, label: 'KV v2', hint: t('settings.secretStores.kv2Hint') },
            { value: 1, label: 'KV v1', hint: t('settings.secretStores.kv1Hint') },
          ],
          initial: (r) => Number(r?.kv_version) || 2,
          required: false,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['vault'],
        },
        {
          key: 'default_mount',
          step: 'options',
          icon: 'folder-open',
          line: 2,
          label: t('settings.secretStores.defaultMount'),
          help: t('settings.secretStores.defaultMountHelp'),
          placeholder: 'secret',
          required: false,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['vault'],
        },
        {
          key: 'app_id',
          step: 'auth',
          icon: 'id-badge',
          line: 2,
          label: t('settings.secretStores.appId'),
          help: t('settings.secretStores.appIdHelp'),
          required: true,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['cyberark_ccp'],
        },
        {
          key: 'client_cert',
          step: 'auth',
          icon: 'certificate',
          type: 'textarea',
          line: 2,
          label: t('settings.secretStores.clientCert'),
          help: t('settings.secretStores.clientCertHelp'),
          placeholder: '-----BEGIN CERTIFICATE-----',
          required: false,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['cyberark_ccp'],
        },
        {
          key: 'client_key',
          step: 'auth',
          icon: 'key',
          type: 'textarea',
          line: 2,
          label: t('settings.secretStores.clientKey'),
          help: t('settings.secretStores.clientKeyHelp'),
          placeholder: '-----BEGIN PRIVATE KEY-----',
          required: false,
          hidden: true,
          dependency: 'type',
          dependencyValues: ['cyberark_ccp'],
        },
        {
          key: 'cache_ttl_seconds',
          step: 'options',
          icon: 'clock',
          line: 3,
          type: 'number',
          label: t('settings.secretStores.cacheTtl'),
          help: t('settings.secretStores.cacheTtlHelp'),
          required: false,
          hidden: true,
          dependency: 'type',
        },
        {
          // the certificate not checked at all : off by default (not stored : ignore_certs is)
          key: 'skip_verify',
          step: 'connection',
          type: 'checkbox',
          label: t('settings.runners.skipVerify'),
          initial: (r) => !!r?.ignore_certs,
          noTable: true,
        },
        {
          // checked against a private authority : its certificates below
          key: 'custom_ca',
          step: 'connection',
          type: 'checkbox',
          label: t('settings.runners.customCa'),
          initial: (r) => !!String(r?.ca_bundle || '').trim(),
          noTable: true,
          dependency: 'skip_verify',
          negateDependency: true,
          // skipping the verification turns it off : its CA bundle goes with it
          defaultMap: { true: false },
        },
        {
          // a column only : the dialog asks skip_verify
          key: 'ignore_certs',
          label: t('settings.ldap.ignoreCerts'),
          type: 'checkbox',
          noInput: true,
          hidden: true,
        },
        {
          key: 'ca_bundle',
          step: 'connection',
          icon: 'certificate',
          type: 'textarea',
          line: 5,
          label: t('settings.fields.caBundle'),
          help: t('settings.runners.caBundleHelp'),
          required: false,
          dependency: 'custom_ca',
          placeholder: '-----BEGIN CERTIFICATE-----',
          hidden: true,
        },
        {
          key: 'extra',
          step: 'options',
          icon: 'code',
          type: 'textarea',
          line: 6,
          label: t('settings.secretStores.extra'),
          help: t('settings.secretStores.extraHelp'),
          placeholder: '{}',
          required: false,
          hidden: true,
          dependency: 'type',
        },
      ],
    },

    backups: {
      icon: 'database',
      type: 'backup',
      label: t('settings.backups.label'),
      labelPlural: t('settings.backups.labelPlural'),
      description: t('settings.backups.description'),
      idKey: 'folder',
      actions: [
        { name: 'preview', title: t('settings.backups.showBackup'), icon: 'info-circle', color: 'change' },
        { name: 'trigger', icon: 'undo', title: t('settings.backups.restore'), color: 'warning' },
        { name: 'delete', icon: 'trash', title: t('common.delete'), color: 'danger' },
      ],
      fields: [
        { key: 'folder', label: t('settings.backups.folder'), noInput: true },
        // rendered with formatServerDate, not dayjs : the server already converted
        // this into the application timezone, so re-converting it in the browser
        // made the date disagree with the folder name beside it
        {
          key: 'date',
          label: t('settings.fields.date'),
          type: 'datetime',
          noInput: true,
          render: (v) => Helpers.formatServerDate(v),
        },
        { key: 'description', label: t('settings.fields.description'), type: 'text' },
      ],
    },
  };
}
