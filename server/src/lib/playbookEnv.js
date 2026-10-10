/******************************************************************/
/*                                                                */
/*  The environment a playbook runs with : the RTE's own, without */
/*  the variables AnsibleForms reads itself.                      */
/*                                                                */
/*  A playbook inherited the whole environment of the RTE, so     */
/*  lookup('env', 'ENCRYPTION_SECRET') - or DB_PASSWORD,          */
/*  ACCESS_TOKEN_SECRET, RTE_TOKEN, VAULT_TOKEN - handed any form  */
/*  author the keys to every stored credential and the database.  */
/*  Every variable the app reads is left out ; anything else an   */
/*  operator set for playbooks (PATH, proxies, ANSIBLE_*, cloud   */
/*  credentials) is passed as it was.                             */
/*                                                                */
/******************************************************************/

// every environment variable AnsibleForms reads (src, config, help.yaml) : none is meant for
// a playbook. tests/playbook-env.test.mjs keeps this list complete.
export const APP_ENV = new Set([
  'ACCESS_TOKEN_EXPIRATION', 'ACCESS_TOKEN_ISSUER', 'ACCESS_TOKEN_REFRESH_EXPIRATION', 'ACCESS_TOKEN_SECRET',
  'ADMIN_PASSWORD', 'ADMIN_USERNAME', 'AF_ROLE', 'ALLOW_ENV_EDIT', 'ALLOW_SCHEMA_CREATION', 'ANSIBLE_PATH',
  'API_BODY_LIMIT_MB', 'API_TOKEN_MAX_DAYS', 'AUDIT_RETENTION_DAYS', 'AUTH_RATE_LIMIT', 'AWX_API_PREFIX', 'AZURE_GRAPH_URI', 'BACKUP_COMMAND_TIMEOUT_SECONDS',
  'BACKUP_PATH', 'BASE_URL', 'CONFIG_PATH', 'CONFIG_SEED_PATH', 'CONTENT_SECURITY_POLICY', 'CONFIG_SEED_RELOAD_SECONDS',
  'DB_HOST', 'DB_PASSWORD', 'DB_POOL_SIZE', 'DB_PORT', 'DB_USER', 'DEFAULT_LANGUAGE',
  'ENABLE_CHAT', 'ENABLE_CONFIG_IN_DATABASE', 'ENABLE_DB_QUERY_LOGGING', 'ENABLE_MCP', 'ENABLE_SSO',
  'ENCRYPTION_SECRET', 'EXPRESSION_SANITIZER', 'EXTRAVARS_USER_FIELDS', 'FORCE_DOTENV', 'FORMS_BACKUP_PATH',
  'FORMS_FOLDER_PATH', 'FORMS_STAGING_PATH', 'GIT_CLONE_COMMAND', 'GIT_PULL_COMMAND', 'GIT_PUSH_COMMAND',
  'HOME_PATH', 'HTTPS', 'HTTPS_CERT', 'HTTPS_KEY', 'JOBS_LIST_SIZE', 'JOB_RETENTION_DAYS', 'LAUNCH_VALIDATION',
  'LOCK_PATH', 'LOGIN_LOCKOUT_MINUTES', 'LOGIN_MAX_FAILURES', 'LOGIN_MAX_FAILURES_PER_IP', 'LOG_COLOR_DEBUG', 'LOG_COLOR_ERROR', 'LOG_COLOR_INFO', 'LOG_COLOR_NOTICE', 'LOG_COLOR_WARN',
  'LOG_CONSOLE_LEVEL', 'LOG_LEVEL', 'LOG_PATH', 'LOG_RETENTION_DAYS', 'LOG_SYSLOG_APPNAME', 'LOG_SYSLOG_HOST',
  'LOG_SYSLOG_LEVEL', 'LOG_SYSLOG_PATH', 'LOG_SYSLOG_PORT', 'LOG_SYSLOG_PROTOCOL', 'LOG_SYSLOG_SOURCE',
  'LOG_SYSLOG_TYPE', 'LOG_TZ', 'MANAGED_ENV_PATH', 'MASK_EXTRAVARS_REGEX', 'MCP_CHAT_FORMS_ONLY', 'MCP_READ_ONLY',
  'MYSQLDUMP_COMMAND', 'MYSQL_COMMAND', 'NAV_HOME_ICON', 'NAV_HOME_LABEL', 'NIGHTLY_BACKUP_RETENTION', 'NODE_ENV',
  'OLD_BACKUP_DAYS', 'PASSWORD_MIN_LENGTH', 'PORT', 'PROCESS_MAX_BUFFER', 'REGEX_FILTER_JOB_OUTPUT', 'REINIT_ADMIN', 'REPO_PATH',
  'REST_ALLOWED_HOSTS', 'REST_DENIED_HOSTS', 'RTE_REGISTER', 'RTE_TOKEN', 'RTE_URL', 'SHOW_DESIGNER', 'TRUST_PROXY',
  'UPLOAD_MAX_GB', 'UPLOAD_PATH', 'USE_YTT', 'VARS_FILES_PATH', 'VAULT_ADDR', 'VAULT_CACHE_TTL_MS',
  'VAULT_DEFAULT_MOUNT', 'VAULT_KV_VERSION', 'VAULT_NAMESPACE', 'VAULT_SKIP_VERIFY', 'VAULT_TOKEN',
  'YTT_ALLOW_SYMLINK_DESTINATIONS', 'YTT_DANGEROUS_ALLOW_ALL_SYMLINK_DESTINATIONS', 'YTT_VARS_PREFIX',
]);

// names that are the app's whatever their suffix : the mysql client's own variables
const APP_ENV_PREFIXES = ['MYSQL_'];

/**
 * The environment for ansible-playbook : `env` without the variables AnsibleForms reads.
 *
 * Args:
 *   env (object): the environment to start from, the process's by default.
 *
 * Returns:
 *   object: a new environment object.
 */
export function playbookEnv(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env || {})) {
    if (APP_ENV.has(name) || APP_ENV_PREFIXES.some((p) => name.startsWith(p))) continue;
    out[name] = value;
  }
  return out;
}

export default { APP_ENV, playbookEnv };
