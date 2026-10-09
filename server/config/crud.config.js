// Central config for all CRUD models
const crudConfigs = {

  oauth2: {
    table: 'AnsibleForms.oauth2_providers',
    fields: [
      { name: 'id', isKey: true },
      { name: 'provider', required: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'description' },
      { name: 'issuer' },
      { name: 'tenant_id'},
      { name: 'client_id', required: true },
      { name: 'client_secret', isEncrypted: true, required: true },
      { name: 'enable', isBoolean: true },
      { name: 'groupfilter' },
      { name: 'redirect_uri' },
      { name: 'scope' },
      { name: 'auth_url' },
      { name: 'token_url' },
      { name: 'userinfo_url' },
      { name: 'extra' },
      { name: 'managed', isBoolean: true }
    ],
    allowCache: false
  },
  credential: {
    table: 'AnsibleForms.credentials',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'user' },
      { name: 'password', isEncrypted: true },
      { name: 'host' },
      { name: 'port' },
      { name: 'db_name' },
      { name: 'secure', isBoolean: true },
      { name: 'is_database', isBoolean: true, setDefault: true },
      { name: 'description' },
      { name: 'db_type' },
      { name: 'vault_path' },
      { name: 'secret_store' },
      { name: 'secret_ref' },
      { name: 'managed', isBoolean: true }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  // Where a job runs : an RTE (runtime environment container) for playbooks, AWX/AAP/Ascender
  // for templates. Which fields a type uses is up to its runner in src/runners.
  runner: {
    table: 'AnsibleForms.runners',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'type', required: true },
      { name: 'description' },
      { name: 'uri', required: true },
      { name: 'token', isEncrypted: true },
      { name: 'username' },
      { name: 'password', isEncrypted: true },
      { name: 'use_credentials', isBoolean: true },
      { name: 'ignore_certs', isBoolean: true },
      { name: 'ca_bundle' },
      { name: 'is_default', isBoolean: true },
      { name: 'managed', isBoolean: true },
      { name: 'node_id' }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  // HashiCorp Vault, CyberArk, ... : where credentials read their user and password from.
  // Which fields a type uses is up to its provider in src/secrets/providers.
  secretstore: {
    table: 'AnsibleForms.secret_stores',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'type', required: true },
      { name: 'description' },
      { name: 'url', required: true },
      { name: 'token', isEncrypted: true },
      { name: 'namespace' },
      { name: 'kv_version' },
      { name: 'default_mount' },
      { name: 'app_id' },
      { name: 'client_cert' },
      { name: 'client_key', isEncrypted: true },
      { name: 'ignore_certs', isBoolean: true },
      { name: 'ca_bundle' },
      { name: 'cache_ttl_seconds' },
      { name: 'extra' },
      { name: 'managed', isBoolean: true }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  groups: {
    table: 'AnsibleForms.groups',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  users: {
    table: 'AnsibleForms.users',
    fields: [
      { name: 'id', isKey: true },
      { name: 'username', isNaturalKey: true, required: true },
      { name: 'password', required: true }, // Special handling needed - async hashing
      { name: 'email', setDefault: true }, // Default to empty string
      { name: 'group_id', required: true }
    ],
    allowCache: false
  },
  repositories: {
    table: 'AnsibleForms.repositories',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'uri', required: true },
      { name: 'branch' },
      { name: 'user' },
      { name: 'password', isEncrypted: true, setDefault: true },
      { name: 'description' },
      { name: 'use_for_config', isBoolean: true },
      { name: 'use_for_forms', isBoolean: true },
      { name: 'use_for_playbooks', isBoolean: true },
      { name: 'use_for_vars_files', isBoolean: true },
      { name: 'rebase_on_start', isBoolean: true },
      { name: 'cron' },
      { name: 'status' },
      { name: 'output' },
      { name: 'head' },
      { name: 'managed', isBoolean: true }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  ldap: {
    table: 'AnsibleForms.ldap',
    fields: [
      { name: 'id', isKey: true },
      { name: 'server', required: true },
      { name: 'port', required: true },
      { name: 'ignore_certs', isBoolean: true },
      { name: 'enable_tls', isBoolean: true },
      { name: 'cert' },
      { name: 'ca_bundle' },
      { name: 'bind_user_dn', required: true },
      { name: 'bind_user_pw', isEncrypted: true, required: true },
      { name: 'search_base', required: true },
      { name: 'username_attribute', required: true },
      { name: 'groups_attribute' },
      { name: 'enable', isBoolean: true },
      { name: 'groups_search_base' },
      { name: 'group_class' },
      { name: 'group_member_attribute' },
      { name: 'group_member_user_attribute' },
      { name: 'mail_attribute' },
      { name: 'managed', isBoolean: true }
    ],
    allowCache: false
  },
  schedule: {
    table: 'AnsibleForms.schedule',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', isNaturalKey: true, required: true },
      { name: 'one_time_run', isBoolean: true },
      { name: 'cron' },
      { name: 'run_at', isDatetime: true },
      { name: 'extra_vars' },
      { name: 'form' },
      { name: 'output' },
      { name: 'status' },
      { name: 'state' },
      { name: 'last_run', isDatetime: true },
      { name: 'queue_id' },
      // who planned it, as a JSON user object : set ONLY by Schedule.plan, never from a
      // request body (the controller drops it). Empty = an admin-level schedule.
      { name: 'owner' }
    ],
    allowCache: true,
    cacheTTL: 3600
  },
  stored_jobs: {
    table: 'AnsibleForms.stored_jobs',
    fields: [
      { name: 'id', isKey: true },
      { name: 'name', required: true },
      { name: 'description' },
      { name: 'form_name', required: true },
      { name: 'username', required: true },
      { name: 'form_data', required: true },
      { name: 'created_at', isDatetime: true },
      { name: 'expires_at', isDatetime: true }
    ],
    allowCache: false
  }
};

export default crudConfigs;
