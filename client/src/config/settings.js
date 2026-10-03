// These settings define the gui admin pages
// Accepts a t() function from vue-i18n for translations
import { editorStyle } from './editorStyle'
import Helpers from '@/lib/Helpers'
import { cronValidationMessage } from './cron'

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
const cronValidator = (t) => (value) => cronValidationMessage(t, value)

// The chat assistant's providers (server/src/chat/vendors.js has the same list and defaults) :
// choosing one fills in its base url, auth type and api version, which stay editable
export const CHAT_PROVIDERS = [
    { value: "anthropic", label: "Anthropic", base_url: "https://api.anthropic.com" },
    { value: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1" },
    { value: "azure", label: "Azure OpenAI", base_url: "", auth_type: "api-key", api_version: "2024-10-21" },
    { value: "gemini", label: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai" },
    { value: "grok", label: "xAI Grok", base_url: "https://api.x.ai/v1" },
    { value: "mistral", label: "Mistral", base_url: "https://api.mistral.ai/v1" },
    { value: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1" },
    { value: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1" },
    { value: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
    { value: "ollama", label: "Ollama", base_url: "http://localhost:11434/v1", auth_type: "none" },
    { value: "custom", base_url: "" },
];

// The secret store types (server/src/secrets/providers/index.js has the same list)
export const SECRET_STORE_TYPES = [
    { value: "vault", label: "HashiCorp Vault" },
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
        actions: [
            { name: 'edit', title: t('settings.users.editUser'), icon: 'pencil', color: 'edit' },
            { name: 'delete', title: t('settings.users.deleteUser'), icon: 'trash', color: 'delete' },
            { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' }
        ],
        fields: [
            { key: 'id', label: t('settings.fields.id'), sortable: false, required: false, filterable: false, noInput: true, hidden: true, icon: 'key'},
            { key: 'username', label: t('settings.fields.username'), sortable: true, required: true, filterable: true, icon: "user" },
            { key: 'password', label: t('settings.fields.password'), type: "password", sortable: false, required: true, filterable: false, hidden: true, icon: "lock" },
            { key: 'email', label: t('settings.fields.email'), type: "email", sortable: false, required: false, filterable: false, icon: "lock" },
            { key: 'group_id', label: t('settings.fields.group'), type: "select", sortable: false, required: true, filterable: false, icon: "users", parent: 'group', values: 'group', valueKey: 'id', labelKey: 'name' }
        ]
    },
    groups:{
        type: 'group',
        label: t('settings.groups.label'),
        description: t('settings.groups.description'),
        icon: 'users',
        selectable: false,
        children: [{
            type: 'user',
            label: t('settings.users.label'),
            labelPlural: t('settings.users.labelPlural'),
            icon: 'user',
            key: 'group_id'
        }],
        actions: [
            { name: 'delete', title: t('settings.groups.deleteGroup'), icon: 'trash', color: 'delete' }
        ],
        fields: [
            { key: 'id', label: t('settings.fields.id'), sortable: false, required: false, filterable: false, noInput: true, hidden: true, icon: 'key' },
            { key: 'name', label: t('settings.fields.name'), sortable: true, required: true, filterable: true, icon: "users" }
        ], 
        childFields: {
            user: [
                { key: 'username', label: t('settings.fields.username') },
                { key: 'email', label: t('settings.fields.email') },
                { key: 'group_id', label: t('settings.fields.group'), hidden: true }
            ]
        }
    },
    repositories:{
        type: "repository",
        label: t('settings.repositories.label'),
        labelPlural: t('settings.repositories.labelPlural'),
        description: t('settings.repositories.description'),
        // reloadSeconds: 7,
        icon: "fab,git",
        idKey: "name",
        selectable: false,
        actions: [
            { name: "edit", icon: "pencil", title: t('settings.repositories.editRepository'), color: "edit" },
            { name: "delete", icon: "trash", title: t('settings.repositories.deleteRepository'), color: "delete" },
            { name: "change_password", icon: "lock", title: t('settings.common.changePassword'), color: "change" },
            { name: "trigger", icon: "play", title: t('settings.common.trigger'), color: "test" },
            { name: "preview", icon: "info-circle", title: t('settings.common.showOutput'), color: "preview" },
            { name: "reset", icon: "redo", title: t('settings.repositories.resetRepository'), color: "refresh" },
            { name: "sync", icon: "upload", title: t('settings.repositories.syncRepository'), color: "test", dependency: ["use_for_forms", "use_for_config"] }
        ],
        fields: [
            { key: "id", hidden: true, noInput: true },
            { key: "output", hidden: true, noInput: true },
            { key: "name", icon: "heading", label: t('settings.fields.name'), placeholder: "my_repo_name", readonly: false, required: true, help: t('settings.repositories.helpName') },
            { key: "branch", icon: "code-branch", label: t('settings.fields.branch'), placeholder: "main", readonly: false },
            { key: "head", label: t('settings.fields.head'), noInput: true },
            { key: "status", label: t('settings.fields.status'), noInput: true },
            { key: "user", icon: "user", label: t('settings.fields.username'), placeholder: "my-user",  hidden: true },
            { key: "password", icon: "lock", label: t('settings.fields.password'), type: "password", placeholder: t('settings.repositories.placeholderPassword'), hidden: true },
            { key: "uri", icon: "fab,git", label: t('settings.fields.uri'), placeholder: "https://github.com/account/repo.git", required: true, hidden: true, help: t('settings.repositories.helpUri') },
            { key: "cron", icon: "stopwatch", label: t('settings.fields.cronSchedule'), type: "cron", hidden: true, validator: cronValidator(t) },
            { key: "description", icon: "info-circle", label: t('settings.fields.description'), placeholder: t('settings.fields.description'), required: true },
            { key: "use_for_config", type: "checkbox", label: t('settings.repositories.useForConfig'), help: t('settings.repositories.helpUseForConfig'), hidden: true },
            { key: "use_for_forms", type: "checkbox", label: t('settings.repositories.useForForms'), help: t('settings.repositories.helpUseForForms'), hidden: true },
            { key: "use_for_playbooks", type: "checkbox", label: t('settings.repositories.useForPlaybooks'), help: t('settings.repositories.helpUseForPlaybooks'), hidden: true },
            { key: "use_for_vars_files", type: "checkbox", label: t('settings.repositories.useForVarsFiles'), help: t('settings.repositories.helpUseForVarsFiles'), hidden: true },
            { key: "rebase_on_start", type: "checkbox", label: t('settings.repositories.cloneOnStart'), help: t('settings.repositories.helpCloneOnStart'), hidden: true }
        ]
    },
    oauth2_providers: {
        type: 'oauth2',
        route: 'oauth2',
        label: t('settings.oauth2.label'),
        labelPlural: t('settings.oauth2.labelPlural'),
        description: t('settings.oauth2.description'),
        icon: 'key',
        selectable: false,
        actions: [
            { name: 'edit', title: t('settings.oauth2.editProvider'), icon: 'pencil', color: 'edit' },
            { name: 'delete', title: t('settings.oauth2.deleteProvider'), icon: 'trash', color: 'delete' },
            { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
        ],
        fields: [
            { key: 'enable', label: t('settings.fields.enable'), type: 'checkbox' },
            { key: 'provider', label: t('settings.oauth2.provider'), required: true, icon: 'cloud', type: 'select', parent: 'providers', values: [{ label: 'Entra ID', value: 'azuread'},{label: 'Open ID',value:'oidc'}] , valueKey: 'value', labelKey: 'label'},
            { key: 'name', label: t('settings.fields.name'), required: true, icon: 'heading' },
            { key: 'description', label: t('settings.fields.description'), required: false, icon: 'info-circle' },
            { key: 'tenant_id', label: t('settings.oauth2.tenantId'), required: false, icon: 'building', dependency: 'provider', dependencyValues: ['azuread'], hidden: true, help: t('settings.oauth2.tenantIdHelp') },
            { key: 'client_id', label: t('settings.oauth2.clientId'), required: true, icon: 'key', dependency: 'provider', dependencyValues: ['azuread', 'oidc'], hidden: true },
            { key: 'issuer', label: t('settings.oauth2.issuer'), required: true, icon: 'globe', dependency: 'provider', dependencyValues: ['oidc'], hidden: true },
            { key: 'redirect_uri', label: t('settings.oauth2.redirectUrl'), readonly: false, dependency: 'provider',dependencyValues: ['azuread', 'oidc'], defaultMap: {
                  azuread: (config) => `${config.url}/api/v2/auth/azureadoauth2/callback`,
                  oidc: (config) => `${config.url}/api/v2/auth/oidc/callback`
                }, hidden: true
            },
            { key: 'client_secret', label: t('settings.oauth2.clientSecret'), type: 'password', required: true, icon: 'lock', hidden: true },
            { key: 'groupfilter', label: t('settings.oauth2.groupFilter'), required: false, icon: 'filter', hidden: true },
            { key: 'scope', label: t('settings.oauth2.scope'), required: false, icon: 'list', dependency: 'provider', dependencyValues: [''], hidden: true },
            { key: 'auth_url', label: t('settings.oauth2.authUrl'), required: false, icon: 'globe', dependency: 'provider', dependencyValues: [''], hidden: true },
            { key: 'token_url', label: t('settings.oauth2.tokenUrl'), required: false, icon: 'globe', dependency: 'provider', dependencyValues: [''], hidden: true },
            { key: 'userinfo_url', label: t('settings.oauth2.userinfoUrl'), required: false, icon: 'globe', dependency: 'provider', dependencyValues: [''], hidden: true },
            { key: 'extra', label: t('settings.oauth2.extra'), type: 'textarea', required: false, icon: 'code', dependency: 'provider', dependencyValues: [''], hidden: true }
        ]

    },    
    schedules:{
        type: "schedule",
        label: t('settings.schedules.label'),
        labelPlural: t('settings.schedules.labelPlural'),
        description: t('settings.schedules.description'),
        // reloadSeconds: 7,
        icon: "clock",
        selectable: false,
        actions: [
            { name: "edit", icon: "pencil", title: t('settings.schedules.editSchedule'), color: "edit" },
            { name: "delete", icon: "trash", title: t('settings.schedules.deleteSchedule'), color: "delete" },
            { name: "trigger", icon: "play", title: t('settings.schedules.runSchedule'), color: "refresh" },
            { name: "preview", icon: "info-circle", title: t('settings.common.showOutput'), color: "preview" }
        ],
        fields: [
            { key: "id", hidden: true, noInput: true },
            { key: "output", hidden: true, noInput: true },
            { key: "name", icon: "heading", label: t('settings.fields.name'), placeholder: t('settings.schedules.placeholderName'), readonly: false, required: true, help: t('settings.repositories.helpName') },
            { key: "one_time_run", label: t('settings.schedules.oneTimeRun'), type: "checkbox", placeholder: t('settings.schedules.oneTimeRunPlaceholder'), required: false, hidden: true },
            { key: "cron", icon: "stopwatch", label: t('settings.fields.cronSchedule'), type: "cron", required: false, validator: cronValidator(t), negateDependency: true, dependency: "one_time_run" },
            { key: "run_at", icon: "calendar", label: t('settings.schedules.runAt'), type: "datetime", convertToUtc: true, help: t('settings.schedules.runAtHelp'), required: false, dependency: "one_time_run" },
            { key: "form", icon: "pen-to-square", label: t('settings.fields.form'), type: "select", parent: "formnames", values: 'config/formnames', valueKey: 'name', labelKey: 'name', readonly: false, required: true, hidden: true},
            { key: "status", label: t('settings.fields.status'), noInput: true },
            { key: "state", label: t('settings.fields.state'), noInput: true },
            { key: "last_run", label: t('settings.fields.lastRun'), type: "datetime", noInput: true },
            { key: "extra_vars", type: "editor", label: t('settings.fields.extraVars'), hidden: true, lang:"yaml", style: editorStyle("40vh"), help: t('settings.schedules.extraVarsHelp') }
        ]
    },
    stored_jobs:{
        type: "stored-jobs",
        label: t('settings.storedJobs.label'),
        labelPlural: t('settings.storedJobs.labelPlural'),
        description: t('settings.storedJobs.description'),
        icon: "floppy-disk",
        reloadSeconds: false, // Disable auto-reload
        noCreate: true,
        actions: [
            { name: "preview", icon: "eye", title: t('settings.storedJobs.viewDetails'), color: "preview" },
            { name: "delete", icon: "trash", title: t('settings.storedJobs.deleteJob'), color: "delete" }
        ],
        fields: [
            { key: "id", hidden: true, noInput: true },
            { key: "name", icon: "heading", label: t('settings.fields.name') },
            { key: "description", icon: "info-circle", label: t('settings.fields.description') },
            { key: "form_name", icon: "play", label: t('settings.fields.form') },
            { key: "username", icon: "user", label: t('settings.storedJobs.userTypeName') },
            { key: "form_data", hidden: true },
            { key: "created_at", icon: "calendar", label: t('settings.fields.createdAt'), type: "datetime" },
            { key: "expires_at", icon: "calendar", label: t('settings.fields.expiresAt'), type: "datetime" }
        ]
    },            
    knownhosts:{
        type: 'knownhosts',
        label: t('settings.knownhosts.label'),
        description: t('settings.knownhosts.description'),
        removeDoubles: true, // remove double entries
        flat: true, // flat data structure,
        icon: 'fab,git',
        actions: [
            { name: 'preview', title: t('settings.knownhosts.showEntry'), icon: 'info-circle', color: 'change' },
            { name: 'delete', title: t('settings.knownhosts.deleteEntry'), icon: 'trash', color: 'delete' }
        ],
        fields: [
            { key: 'id', label: t('settings.knownhosts.hostEntry'), filterable: true, hidden:true, noInput: true },
            { key: 'name', label: t('settings.knownhosts.hostEntry'), required: false, filterable: true, noInput: true },
            { key: 'host', label: t('settings.fields.host'), required: true, filterable: true, hidden:true }
        ]
    },
    credentials: {
        type: 'credential',
        label: t('settings.credentials.label'),
        description: t('settings.credentials.description'),
        icon: 'lock',
        selectable: false,
        actions: [
            { name: 'edit', title: t('settings.credentials.editCredential'), icon: 'pencil', color: 'edit' },
            { name: 'delete', title: t('settings.credentials.deleteCredential'), icon: 'trash', color: 'delete' },
            { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
            { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', color: 'test', dependency: "is_database" }
        ],
        fields: [
            { key: 'id', label: t('settings.fields.id'), sortable: false, required: false, filterable: false, noInput: true, hidden: true, icon: 'key' },
            { key: 'is_database', label: t('settings.credentials.forDatabase'), type: 'checkbox', hidden: true, placeholder: t('settings.credentials.enableDbFields'), required: false },
            { key: 'name', label: t('settings.fields.name'), sortable: true, required: true, filterable: true, icon: "lock", isKey: true },
            { key: 'user', label: t('settings.fields.user'), sortable: true, required: false, filterable: true, icon: "user" },
            { key: 'password', label: t('settings.fields.password'), type: "password", sortable: false, required: false, filterable: false, icon: "lock", hidden: true },
            { key: 'secret_store', label: t('settings.credentials.secretStore'), help: t('settings.credentials.secretStoreHelp'), type: 'select', parent: 'secretstores', values: 'secretstore', valueKey: 'name', labelKey: 'name', clearable: true, sortable: false, required: false, filterable: false, icon: "vault", hidden: true },
            { key: 'secret_ref', label: t('settings.credentials.secretRef'), placeholder: t('settings.credentials.secretRefPlaceholder'), help: t('settings.credentials.secretRefHelp'), sortable: false, required: false, filterable: false, icon: "shield-alt", hidden: true, dependency: 'secret_store' },
            { key: 'host', label: t('settings.fields.host'), sortable: true, required: false, filterable: true, icon: "server" },
            { key: 'port', label: t('settings.fields.port'), type:"number", sortable: true, required: false, filterable: false, icon: "arrows-alt-v" },
            { key: 'description', label: t('settings.fields.description'), sortable: false, hidden: true, required: true, filterable: false, icon: "info-circle" },
            {
                key: 'db_type', label: t('settings.credentials.databaseType'), type: 'select', sortable: false, hidden: true, required: true, parent:'databases',
                values: [
                    { value: 'mysql',    label: 'MySQL'},
                    { value: 'mssql',    label: 'MSSQL' },
                    { value: 'postgres', label: 'PostgreSQL' },
                    { value: 'oracle',   label: 'Oracle' },
                    { value: 'mongodb',  label: 'MongoDB' },
                ],
                labelKey: "label", valueKey: "value",
                filterable: true, icon: "database", dependency: "is_database"
            },
            { key: 'db_name', label: t('settings.credentials.database'), sortable: false, hidden: true, required: false, filterable: false, icon: "database", dependency: "is_database" }

        ]
    },
    ssh:{
        label: t('settings.ssh.label'),
        description: t('settings.ssh.description'),
        type: "sshkey",
        icon: "key",
        fields: [
            { key: "art", label: t('settings.ssh.privateKeyArt'), type: "sshPrivateKeyArt", line: 0 },
            { key: "key", label: t('settings.ssh.privateKey'), help: t('settings.ssh.privateKeyHelp'), type: "textarea",placeholder:"-----BEGIN RSA PRIVATE KEY-----", line: 1, required: true },
            { key: "publicKey", label: t('settings.ssh.publicKey'), help: t('settings.ssh.publicKeyHelp'), type: "sshPublicKey", line: 2 }
        ]
    },
    ldap: {
        type: "ldap",
        // Show every field even when LDAP is off, greyed rather than hidden: an admin
        // deciding whether to enable it needs to see what it will ask for.
        showDisabledFields: true,
        label: t('settings.ldap.label'),
        description: t('settings.ldap.description'),
        icon: "globe",
        actions: [
            { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', dependency: "enable" }
        ],    
        fields: [
            { key: "enable", label: t('settings.ldap.enableLdap'), type: "checkbox", isToggle: true },
            { key: "server", icon:"server", line: 0, label: t('settings.fields.server'), required: true, dependency: "enable" },
            { key: "port", icon:"arrows-alt-v", type:"number", line: 0, label: t('settings.fields.port'), required: true, dependency: "enable" },
            { key: "enable_tls", label: t('settings.ldap.enableTls'), help: t('settings.ldap.enableTlsDesc'), type: "checkbox", line: 1, dependency: "enable", onChange: (val, item) => { if (Number(item.port) === 389 || Number(item.port) === 636) item.port = val ? 636 : 389; } },
            { key: "ignore_certs", hideWhenDisabled: true, label: t('settings.ldap.ignoreCerts'), help: t('settings.ldap.ignoreCertsDesc'), type: "checkbox", line: 1, dependency: "enable_tls" },
            { key: "cert", hideWhenDisabled: true, icon:"certificate", type:"textarea", line: 2, label: t('settings.fields.certificate'), required: true, dependency: "ignore_certs", negateDependency: true, placeholder:"-----BEGIN CERTIFICATE-----" },
            { key: "ca_bundle", hideWhenDisabled: true, icon:"certificate", type:"textarea", line: 2, label: t('settings.fields.caBundle'), required: true, dependency: "ignore_certs", negateDependency: true, placeholder:"-----BEGIN CERTIFICATE-----" },
            { key: "search_base", icon:"search", line: 3, label: t('settings.ldap.searchBase'), help: t('settings.ldap.searchBaseDesc'), required: true, dependency: "enable" },
            { key: "mail_attribute", icon:"envelope", line: 3, label: t('settings.ldap.mailAttribute'), help: t('settings.ldap.mailAttributeDesc'), required: true, dependency: "enable" },
            { key: "bind_user_dn", icon:"user", line: 4, label: t('settings.ldap.bindUserDn'), help: t('settings.ldap.bindUserDnDesc'), required: true, dependency: "enable" },
            { key: "bind_user_pw", icon:"lock", line: 4, label: t('settings.ldap.bindUserPassword'), help: t('settings.ldap.bindUserPasswordDesc'), type: "password", required: true, dependency: "enable" },
            { key: "username_attribute", icon:"image-portrait", line: 5, label: t('settings.ldap.usernameAttribute'), help: t('settings.ldap.usernameAttributeDesc'), required: true, dependency: "enable" },
            { key: "groups_attribute", icon:"users", line: 5, label: t('settings.ldap.groupsAttribute'), help: t('settings.ldap.groupsAttributeDesc'), required: true, dependency: "enable" },
            { key: "groups_search_base", icon:"users-viewfinder", line: 6, label: t('settings.ldap.groupsSearchBase'), help: t('settings.ldap.groupsSearchBaseDesc'), required: false, dependency: "enable" },
            { key: "group_class", icon:"users-rectangle", line: 6, label: t('settings.ldap.groupClass'), help: t('settings.ldap.groupClassDesc'), required: false, dependency: "enable" },
            { key: "group_member_attribute", icon:"users-line", line: 7, label: t('settings.ldap.groupMemberAttribute'), help: t('settings.ldap.groupMemberAttributeDesc'), required: false, dependency: "enable" },
            { key: "group_member_user_attribute", icon:"user-group", line: 7, label: t('settings.ldap.groupMemberUserAttribute'), help: t('settings.ldap.groupMemberUserAttributeDesc'), required: false, dependency: "enable" },
            { key: "groupfilter", icon:"filter", line: 8, label: t('settings.ldap.groupFilter'), help: t('settings.ldap.groupFilterDesc'), required: false, dependency: "enable" },
        ]
    },
    chat: {
        // the chat assistant's model provider ; the api key never comes back from the server
        type: "chatsettings",
        showDisabledFields: true,
        label: t('settings.chat.label'),
        description: t('settings.chat.description'),
        icon: "comments",
        actions: [
            { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', dependency: "provider" }
        ],
        fields: [
            { key: "provider", icon: "robot", line: 0, type: "select", label: t('settings.chat.provider'),
              values: [{ value: "", label: t('settings.chat.providerNone') }, ...CHAT_PROVIDERS.map((p) => ({ value: p.value, label: p.label || t('settings.chat.providerCustom') }))],
              onChange: (val, item) => {
                  const p = CHAT_PROVIDERS.find((x) => x.value === val);
                  if (!p) return;
                  item.base_url = p.base_url;
                  item.auth_type = p.auth_type || "";
                  item.api_version = p.api_version || "";
              } },
            { key: "model", icon: "microchip", line: 0, label: t('settings.chat.model'), help: t('settings.chat.modelHelp'), placeholder: "claude-sonnet-5-5 / gpt-5 / llama3.3", required: true, dependency: "provider" },
            { key: "base_url", icon: "link", line: 1, label: t('settings.chat.baseUrl'), help: t('settings.chat.baseUrlHelp'), placeholder: "https://<proxy>/v1", dependency: "provider" },
            { key: "api_key", icon: "key", line: 1, type: "password", label: t('settings.chat.apiKey'), help: t('settings.chat.apiKeyHelp'), dependency: "provider" },
            { key: "auth_type", icon: "id-card", line: 2, type: "select", label: t('settings.chat.authType'), help: t('settings.chat.authTypeHelp'), dependency: "provider",
              values: [{ value: "", label: t('settings.chat.authDefault') }, { value: "bearer", label: "Authorization: Bearer" }, { value: "api-key", label: "api-key" }, { value: "x-api-key", label: "x-api-key" }, { value: "none", label: t('settings.chat.authNone') }] },
            { key: "api_version", icon: "code-branch", line: 2, label: t('settings.chat.apiVersion'), help: t('settings.chat.apiVersionHelp'), placeholder: "2024-10-21", dependency: "provider" },
            { key: "request_user", icon: "user", line: 2, label: t('settings.chat.user'), help: t('settings.chat.userHelp'), dependency: "provider" },
            { key: "extra_headers", icon: "list", line: 3, type: "textarea", label: t('settings.chat.extraHeaders'), help: t('settings.chat.extraHeadersHelp'), placeholder: '{"X-Org": "ops"}', dependency: "provider" },
            { key: "max_turns", icon: "comments", line: 4, type: "number", label: t('settings.chat.maxTurns'), help: t('settings.chat.maxTurnsHelp'), dependency: "provider" },
            { key: "max_tool_rounds", icon: "arrows-rotate", line: 4, type: "number", label: t('settings.chat.maxToolRounds'), help: t('settings.chat.maxToolRoundsHelp'), dependency: "provider" },
            { key: "timeout_seconds", icon: "clock", line: 4, type: "number", label: t('settings.chat.timeout'), dependency: "provider" },
            { key: "ignore_certs", line: 5, type: "checkbox", label: t('settings.chat.ignoreCerts'), help: t('settings.chat.ignoreCertsHelp'), dependency: "provider" },
            { key: "allow_job_status", line: 5, type: "checkbox", label: t('settings.chat.allowJobStatus'), help: t('settings.chat.allowJobStatusHelp'), dependency: "provider" },
        ]
    },
    // External secret managers. The types mirror SECRET_STORE_TYPES in
    // server/src/secrets/providers/index.js ; which fields a type shows follows its provider.
    secretStores: {
        type: 'secretstore',
        label: t('settings.secretStores.label'),
        description: t('settings.secretStores.description'),
        icon: 'vault',
        selectable: false,
        actions: [
            { name: 'edit', title: t('settings.secretStores.editStore'), icon: 'pencil', color: 'edit' },
            { name: 'delete', title: t('settings.secretStores.deleteStore'), icon: 'trash', color: 'delete' },
            { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
            { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', color: 'test' }
        ],
        fields: [
            { key: 'id', label: t('settings.fields.id'), sortable: false, required: false, filterable: false, noInput: true, hidden: true, icon: 'key' },
            { key: 'name', icon: 'heading', line: 0, label: t('settings.fields.name'), required: true, filterable: true, help: t('settings.secretStores.nameHelp') },
            { key: 'type', icon: 'vault', line: 0, label: t('settings.secretStores.type'), required: true, filterable: true, type: 'select', parent: 'secretStoreTypes', values: SECRET_STORE_TYPES, valueKey: 'value', labelKey: 'label' },
            { key: 'description', icon: 'info-circle', line: 0, label: t('settings.fields.description'), required: false, hidden: true },
            { key: 'url', icon: 'globe', line: 1, label: t('settings.fields.uri'), required: true, placeholder: 'https://vault.example.com:8200', dependency: 'type' },
            { key: 'token', icon: 'lock', line: 1, label: t('settings.fields.token'), type: 'password', required: true, hidden: true, dependency: 'type', dependencyValues: ['vault'] },
            { key: 'namespace', icon: 'folder', line: 2, label: t('settings.secretStores.namespace'), help: t('settings.secretStores.namespaceHelp'), required: false, hidden: true, dependency: 'type', dependencyValues: ['vault'] },
            { key: 'kv_version', icon: 'code-branch', line: 2, label: t('settings.secretStores.kvVersion'), type: 'select', parent: 'kvVersions', values: [{ value: 2, label: 'KV v2' }, { value: 1, label: 'KV v1' }], valueKey: 'value', labelKey: 'label', required: false, hidden: true, dependency: 'type', dependencyValues: ['vault'] },
            { key: 'default_mount', icon: 'folder-open', line: 2, label: t('settings.secretStores.defaultMount'), help: t('settings.secretStores.defaultMountHelp'), placeholder: 'secret', required: false, hidden: true, dependency: 'type', dependencyValues: ['vault'] },
            { key: 'cache_ttl_seconds', icon: 'clock', line: 3, type: 'number', label: t('settings.secretStores.cacheTtl'), help: t('settings.secretStores.cacheTtlHelp'), required: false, hidden: true, dependency: 'type' },
            { key: 'ignore_certs', line: 4, type: 'checkbox', label: t('settings.ldap.ignoreCerts'), hidden: true, dependency: 'type' },
            { key: 'ca_bundle', icon: 'certificate', type: 'textarea', line: 5, label: t('settings.fields.caBundle'), help: t('settings.secretStores.caBundleHelp'), required: false, dependency: 'ignore_certs', negateDependency: true, placeholder: '-----BEGIN CERTIFICATE-----', hidden: true },
            { key: 'extra', icon: 'code', type: 'textarea', line: 6, label: t('settings.secretStores.extra'), help: t('settings.secretStores.extraHelp'), placeholder: '{}', required: false, hidden: true, dependency: 'type' },
        ]
    },
    aap:{
        type: "awx",
        label: t('settings.aap.label'),
        description: t('settings.aap.description'),
        icon: "fac,ansible",
        selectable: false,
        actions: [
            { name: 'edit', title: t('settings.aap.editCredential'), icon: 'pencil', color: 'edit' },
            { name: 'delete', title: t('settings.aap.deleteCredential'), icon: 'trash', color: 'delete' },
            { name: 'change_password', title: t('settings.common.changePassword'), icon: 'lock', color: 'change' },
            { name: 'test', title: t('settings.common.testConnection'), icon: 'plug', color: 'test' }
        ],
        fields: [
            { key: 'id', label: t('settings.fields.id'), sortable: false, required: false, filterable: false, noInput: true, hidden: true, icon: 'key' },            
            { key: "use_credentials", label: t('settings.aap.useCredentials'), type: "checkbox", hidden: true, password_related: true },
            { key: "ignore_certs", label: t('settings.ldap.ignoreCerts'), type: "checkbox", hidden: true },
            { key: "is_default", label: t('settings.aap.isDefault'), type: "checkbox" },
            { key: "name", icon: "heading", line: 0, label: t('settings.fields.name'), required: true },
            { key: "description", icon: "info-circle", line: 0, label: t('settings.fields.description'), required: false },
            { key: "uri", icon: "globe", line: 0, label: t('settings.fields.uri'), required: true },
            { key: "username", icon: "user", line: 2, label: t('settings.fields.username'), required: true, dependency: "use_credentials", hidden: true },
            { key: "password", icon: "lock", line: 2, label: t('settings.fields.password'), type: "password", required: true, dependency: "use_credentials", hidden: true },
            { key: "token", icon: "lock", line: 1, label: t('settings.fields.token'), type: "password", required: true, dependency: "use_credentials", negateDependency: true, hidden: true },
            { key: "ca_bundle", icon: "certificate", type: "textarea", line: 6, label: t('settings.fields.caBundle'), required: true, dependency: "ignore_certs", negateDependency: true, placeholder: "-----BEGIN CERTIFICATE-----", hidden: true },
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
            { name: 'delete', icon: 'trash', title: t('common.delete'), color: 'danger' }
        ],
        fields: [
            { key: 'folder', label: t('settings.backups.folder'), noInput: true },
            // rendered with formatServerDate, not dayjs : the server already converted
            // this into the application timezone, so re-converting it in the browser
            // made the date disagree with the folder name beside it
            { key: 'date', label: t('settings.fields.date'), type: "datetime" , noInput: true, render: (v) => Helpers.formatServerDate(v) },
            { key: 'description', label: t('settings.fields.description'), type: 'text' }
        ]
    },
  }
}
