import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { normalizeBaseUrl } from "../src/lib/baseurl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var app_config = {
  port: process.env.PORT || 8000,
  // host the app under a url subpath, for example behind a reverse proxy (issue #106)
  // BASE_URL=/ansibleforms => app is served under https://host/ansibleforms/
  // normalized to "" for root hosting, or "/subpath" (leading slash, no trailing slash)
  baseUrl: normalizeBaseUrl(process.env.BASE_URL),
  nodeEnvironment: process.env.NODE_ENV || "production",
  showDesigner: (process.env.SHOW_DESIGNER ?? 1) == 1,
  allowSchemaCreation: (process.env.ALLOW_SCHEMA_CREATION ?? 1) == 1,
  configPath: process.env.CONFIG_PATH || path.resolve(__dirname + "/../persistent/config.yaml"),
  // Declarative config seed for the admin objects (awx, credentials, oauth2 providers,
  // repositories, ldap, mail/url). Empty = feature off. NOT the same thing as configPath,
  // which holds the forms configuration - see https://ansibleforms.com/seed.
  configSeedPath: process.env.CONFIG_SEED_PATH || "",
  // How often the seed file is re-read and re-applied when its content changed, in
  // seconds. 0 turns the poll off, leaving the boot apply, POST /api/v2/config-seed/apply
  // and SIGHUP. A poll rather than a watcher on purpose : a mounted ConfigMap is updated
  // by swapping the ..data symlink, which fs.watch on the file never sees, and kubelet
  // takes up to a minute to do it anyway - so a watcher would buy no time it could use.
  configSeedReloadSeconds: parseInt(process.env.CONFIG_SEED_RELOAD_SECONDS || "60", 10),
  // Whether the settings pages may write persistent/.env. Turn this off where the
  // environment is declared elsewhere (kubernetes ConfigMap, docker-compose, ArgoCD) :
  // there the file is either ephemeral, so a save is silently lost at the next restart,
  // or durable, so it drifts away from the manifest that is supposed to be authoritative.
  allowEnvEdit: (process.env.ALLOW_ENV_EDIT ?? 1) == 1,
  formsFolderPath: process.env.FORMS_FOLDER_PATH || path.resolve(__dirname + "/../persistent/forms"),
  // staging area for new forms in repository mode : they live here until a
  // 'Push to repo' assigns them to a chosen repository (issue #414)
  formsStagingPath: process.env.FORMS_STAGING_PATH || path.resolve(__dirname + "/../persistent/forms_staging"),
  nightlyBackupRetention: parseInt(process.env.NIGHTLY_BACKUP_RETENTION || "7", 10),
  // How long audit entries are kept. The trail is append only, so without a sweep
  // it grows for ever - set to 0 to disable the sweep and keep everything.
  auditRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || "365", 10),
  // How long finished jobs and their output are kept. Job output is longtext and
  // nothing pruned it before, so this is the table that grows without limit on a
  // busy instance.
  // DEFAULT 0 = keep for ever, ON PURPOSE : upgrading must never silently delete
  // job history somebody was relying on. Opting in is a deliberate choice, and the
  // health page reports the size so it is a visible one.
  jobRetentionDays: parseInt(process.env.JOB_RETENTION_DAYS || "0", 10),
  // Serve the MCP server for AI agents on /api/v2/mcp. Off by default : it is a new way
  // in, and an operator should opt in to it.
  enableMcp: (process.env.ENABLE_MCP ?? 0) == 1,
  // SSO as a whole (the providers of Settings > SSO) : on unless switched off
  enableSso: (process.env.ENABLE_SSO ?? 1) == 1,
  // MCP : read only (no launch_job, no relaunch_job), and which forms it offers - all the
  // user's forms, or only those offered in the chat assistant (enableForChat)
  mcpReadOnly: (process.env.MCP_READ_ONLY ?? 0) == 1,
  mcpChatFormsOnly: (process.env.MCP_CHAT_FORMS_ONLY ?? 0) == 1,
  // The chat assistant in the browser (a model provider on the Chat assistant admin page
  // is needed too). Off by default : it sends form definitions and values to a model
  // provider, which an operator decides. It applies without a restart (envSettings.js).
  enableChat: (process.env.ENABLE_CHAT ?? 0) == 1,
  // Validate the field values of every launch from the browser or the REST API against the
  // form's rules (the same engine as the MCP server). off (default) = no check at all, so an
  // upgrade changes nothing ; log = log what would be refused ; enforce = refuse.
  // Read at every launch.
  launchValidation: ['log', 'enforce'].includes(String(process.env.LAUNCH_VALIDATION || '').trim().toLowerCase())
    ? String(process.env.LAUNCH_VALIDATION).trim().toLowerCase() : 'off',
  useYtt: (process.env.USE_YTT ?? 0) == 1,
  yttDangerousAllowAllSymlinkDestinations: (process.env.YTT_DANGEROUS_ALLOW_ALL_SYMLINK_DESTINATIONS ?? 0) == 1,
  yttAllowSymlinkDestinations: process.env.YTT_ALLOW_SYMLINK_DESTINATIONS || "",
  yttLibData: {},
  yttVarsPrefix: process.env.YTT_VARS_PREFIX || "",
  lockPath: process.env.LOCK_PATH || path.resolve(__dirname + "/../persistent/ansibleForms.lock"),
  helpPath: path.resolve(__dirname + "/../help.yaml"),
  encryptionSecret: ((process.env.ENCRYPTION_SECRET || "undefinedvOVH6sdmpNWjRRIqCc7rdxs") + "vOVH6sdmpNWjRRIqCc7rdxs01lwHzfr3").substring(0, 32),
  // without ENCRYPTION_SECRET the key above is the fallback in this public source : index.js
  // warns at startup. The fallback itself stays - changing it would make every credential
  // already stored with it unreadable.
  encryptionSecretIsDefault: !process.env.ENCRYPTION_SECRET,
  homePath: process.env.HOME_PATH || os.homedir(),
  uploadPath: process.env.UPLOAD_PATH || path.resolve(__dirname + "/../persistent/uploads"),
  varsFilesPath: process.env.VARS_FILES_PATH || path.resolve(__dirname + "/../persistent/vars"),
  repoPath: process.env.REPO_PATH || path.resolve(__dirname + "/../persistent/repositories"),
  formsBackupPath: process.env.FORMS_BACKUP_PATH || path.resolve(__dirname + "/../persistent/forms_backups"),
  // parseInt : a string here makes the age comparison in Form.removeOld either NaN
  // (prunes nothing) or, with "0", "older than today" - which deletes the snapshot
  // Form.restore is about to read
  oldBackupDays: parseInt(process.env.OLD_BACKUP_DAYS || "60", 10),
  filterJobOutputRegex: process.env.REGEX_FILTER_JOB_OUTPUT || "\\[low\\]",
  // REINIT_ADMIN=1 forces a one-time recreation of the local `admin` user
  // (and its admins group) at startup, using ADMIN_USERNAME / ADMIN_PASSWORD.
  // Intended as a recovery hatch only — unset after use. NOT a runtime auth bypass.
  reinitAdmin: (process.env.REINIT_ADMIN ?? 0) == 1,
  // Cap on JSON / urlencoded request bodies (form designer, extravars, etc.).
  // Defaults to 50 MB; override via API_BODY_LIMIT_MB.
  apiBodyLimitMb: parseInt(process.env.API_BODY_LIMIT_MB ?? "50", 10) || 50,
  // Cap on a single uploaded file (in GB). Default 10 GB to allow upgrade
  // artifacts; override via UPLOAD_MAX_GB. Set to 0 to disable the cap.
  uploadMaxGb: parseInt(process.env.UPLOAD_MAX_GB ?? "10", 10),
  enableDbQueryLogging: (process.env.ENABLE_DB_QUERY_LOGGING ?? 0) == 1,
  enableConfigInDatabase: (process.env.ENABLE_CONFIG_IN_DATABASE ?? 0) == 1,
  processMaxBuffer: process.env.PROCESS_MAX_BUFFER || 1024 * 1024,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "AnsibleForms!123",
  awxApiPrefix: process.env.AWX_API_PREFIX || "/api/v2",
  backupPath: process.env.BACKUP_PATH || path.resolve(__dirname + "/../persistent/backups"),
  mysqldumpCommand: process.env.MYSQLDUMP_COMMAND || "mariadb-dump --ssl-verify-server-cert=OFF",
  mysqlCommand: process.env.MYSQL_COMMAND || "mariadb --ssl-verify-server-cert=OFF",
  // Seconds allowed for the dump and the replay. Cmd.executeSilentCommand defaults to 60,
  // which neither of these can honour on a real database - and the restore is the one
  // operation where being killed part way is destructive, because the dump it is
  // replaying drops and recreates each table in turn. One hour by default.
  backupCommandTimeoutSeconds: parseInt(process.env.BACKUP_COMMAND_TIMEOUT_SECONDS, 10) > 0
    ? parseInt(process.env.BACKUP_COMMAND_TIMEOUT_SECONDS, 10)
    : 3600,
  maskExtravarsRegex: process.env.MASK_EXTRAVARS_REGEX || "password|secret|token",
  // Which keys of the launching user are sent as `ansibleforms_user` in the extravars.
  // Empty (the default) is the full object, exactly as every release before this one, and a
  // form can override it with its own `userExtravars` property. See Helpers.userForExtravars.
  extravarsUserFields: (process.env.EXTRAVARS_USER_FIELDS || "").trim(),
  gitCloneCommand: process.env.GIT_CLONE_COMMAND || "git clone",
  gitPullCommand: process.env.GIT_PULL_COMMAND || "git pull",
  gitPushCommand: process.env.GIT_PUSH_COMMAND || "git push"
};

// process dynamic YTT_LIB_DATA_ environment variables
Object.entries(process.env)
  .filter(([key]) => key.startsWith("YTT_LIB_DATA_"))
  .forEach(([key, value]) => {
    const libName = key.replace("YTT_LIB_DATA_", "").toLowerCase();
    app_config.yttLibData[libName] = value;
  });

export default app_config;
