import mysql from './db.model.js';
import dbConfig from '../../config/db.config.js';
import Settings from './settings.model.js';
import Schema, { SCHEMA_MANIFEST } from './schema.model.js';
import BackupModel from './backup.model.js';
import cronService from '../services/cron.service.js';
import appConfig from '../../config/app.config.js';
import logConfig from '../../config/log.config.js';
import SecretStore from './secretStore.model.js';
import Runner from './runner.model.js';
import { checkStore } from '../secrets/providers/index.js';
import { getSeedState } from '../lib/seed.js';
import { getExpressionMode } from '../lib/expressionMode.js';
import net from 'net';
import tls from 'tls';
import logger from '../lib/logger.js';
import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import yaml from 'yaml';
import Cmd from '../lib/cmd.js';
import os from 'os';
import { readFileSync } from 'fs';
import * as fsSync from 'fs';
import { fileURLToPath } from 'url';

// System health.
//
// Every check here is READ ONLY and free of side effects, because a health page
// gets refreshed : nothing sends a mail, binds to ldap or launches a job. Where a
// dependency can only be proven by using it (smtp, ldap) we report whether it is
// configured and leave the actual test to that feature's own 'test' button.
//
// This exists because failures in this app are quiet. Nightly backups wrote an
// empty dump for weeks and the only trace was one line in a log file, a stale
// designer lock silently answers 423 to every config write, and a repository that
// stops syncing just serves stale forms. Each of those is a check below.
var Health = function(){}

const OK = 'ok', WARNING = 'warning', ERROR = 'error';
// Longer than any plausible editing session, short enough to surface an abandoned lock
// within a working day.
const STALE_LOCK_HOURS = 8;
// worst-wins, so the page header can show a single verdict
const SEVERITY = { [OK]: 0, [WARNING]: 1, [ERROR]: 2 };

function check(key, status, value, detail) {
  return { key, status, value: value ?? null, detail: detail ?? null };
}

// A check must never take the whole page down with it : an unexpected throw
// becomes that row's error instead of a 500 for everything.
async function safely(key, fn) {
  try {
    return await fn();
  } catch (e) {
    logger.warning(`Health check '${key}' failed : ${e.message || e}`);
    // 'failed' rather than null : a null value renders an empty cell next to a red dot,
    // which says nothing until you open the detail. Reproduced by stopping the database,
    // where four rows went red with no text at all.
    return check(key, ERROR, 'failed', e.message || String(e));
  }
}

// Which engine, not just which version. VERSION() alone returns '8.4.9' on MySQL and
// '10.11.2-MariaDB' on MariaDB, so the bare number tells you nothing about the product -
// and this app supports both. @@version_comment names it in the cases where the version
// string does not ('MySQL Community Server - GPL' / 'mariadb.org binary distribution').
async function databaseFacts() {
  const rows = await mysql.do('SELECT VERSION() AS version, @@version_comment AS comment');
  const version = rows[0]?.version || 'unknown';
  const comment = rows[0]?.comment || '';
  const isMaria = /mariadb/i.test(version) || /mariadb/i.test(comment);
  const product = isMaria ? 'MariaDB' : 'MySQL';
  // '10.11.2-MariaDB' would otherwise read as 'MariaDB 10.11.2-MariaDB'
  const number = String(version).replace(/-?mariadb.*$/i, '');
  // The old separate 'schema: provisioned' row is folded in here. This page is behind
  // showSettings, so it can only be reached on an instance where the schema exists and
  // holds accounts - that row could never read anything but 'provisioned', and a check
  // that cannot fail only dilutes the ones that can.
  const provisioned = await Schema.isProvisioned().catch(() => null);
  return { product, number, version, comment, provisioned };
}

// A CHECK answers "can we reach it", which is the part that can actually fail (this
// throws on ECONNREFUSED and becomes an error row). WHICH engine and version it is, and
// where it lives, are facts - they belong in the information block, not behind a green
// dot that implies a verdict was reached.
async function databaseCheck() {
  const db = await databaseFacts();
  // Reachable is the whole verdict. There is deliberately no 'not provisioned' warning:
  // this page needs showSettings, which needs an authenticated user, which needs the
  // schema - so that branch could never be true on a page you are able to load. It stays
  // a fact in the detail, the same reason the old 'schema: provisioned' row was folded in.
  return check('database', OK, 'reachable', {
    provisioned: db.provisioned,
  });
}

// Disk. Everything operational this app does writes under persistent/ - backups, logs,
// uploads, forms, git working trees - and a full disk breaks backups SILENTLY, which is
// the exact failure this page exists to surface.
async function diskCheck() {
  // the backup folder is the biggest writer and is created at startup ; fall back to the
  // config directory, which always exists
  const candidates = [appConfig.backupPath, path.dirname(appConfig.configPath), process.cwd()];
  var stat = null, target = null;
  for (const dir of candidates) {
    try {
      stat = await fs.statfs(dir);
      target = dir;
      break;
    } catch {
      // try the next one
    }
  }
  if (!stat) return check('disk', WARNING, 'unknown', 'Could not read the filesystem holding persistent/');
  const total = stat.blocks * stat.bsize;
  const free = stat.bavail * stat.bsize;
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const gb = (bytes) => Math.round((bytes / 1073741824) * 10) / 10;
  const status = usedPct >= 95 ? ERROR : (usedPct >= 85 ? WARNING : OK);
  return check('disk', status, `${usedPct}% used, ${gb(free)} GB free`, {
    path: target,
    totalGb: gb(total),
    freeGb: gb(free),
    usedPercent: usedPct,
    note: status === OK ? null : 'A full disk makes backups fail while everything else still looks healthy',
  });
}

// What is happening right now, and who is waiting. A job stuck in 'running' is invisible
// otherwise : the abandonedJobs sweep only catches jobs orphaned by a restart, not a
// playbook that hung.
const STUCK_HOURS = 24;
async function jobsCheck() {
  const rows = await mysql.do(
    "SELECT " +
    " SUM(status='running') AS running," +
    " SUM(status='approve') AS awaitingApproval," +
    " SUM(status='running' AND `start` < (NOW() - INTERVAL ? HOUR)) AS stuck" +
    " FROM AnsibleForms.`jobs`",
    [STUCK_HOURS]
  ).catch((e) => {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  });
  const r = rows[0] || {};
  const running = Number(r.running || 0);
  const awaiting = Number(r.awaitingApproval || 0);
  const stuck = Number(r.stuck || 0);
  const status = stuck > 0 ? WARNING : OK;
  return check('jobs', status, `${running} running, ${awaiting} awaiting approval`, {
    running,
    awaitingApproval: awaiting,
    stuck,
    note: stuck > 0 ? `${stuck} job(s) have been running for more than ${STUCK_HOURS} hours` : null,
  });
}

// Process facts, none of which can fail. Uptime answers the first question of most
// incidents; the timezone is here because LOG_TZ decides how every stored timestamp is
// rendered, which caused a real backup-date confusion.
function uptimeText() {
  const up = process.uptime();
  return up < 3600
    ? `${Math.round(up / 60)} min`
    : (up < 86400 ? `${Math.round(up / 360) / 10} h` : `${Math.round(up / 8640) / 10} days`);
}

// version + build, read once at import like version.controller does
const __dirname_h = path.dirname(fileURLToPath(import.meta.url));
var pkgVersion = null, buildInfo = null;
try {
  pkgVersion = JSON.parse(readFileSync(path.resolve(__dirname_h, '../../package.json'), 'utf8')).version;
} catch { /* not fatal : the row just reads 'unknown' */ }
try {
  buildInfo = JSON.parse(readFileSync(path.resolve(__dirname_h, '../../build-info.json'), 'utf8'));
} catch { /* absent in dev, which is normal */ }

// Which sign-in routes are open. 'why can this user not log in' starts here, and the
// answer is otherwise spread over two admin pages.
async function authenticationFacts() {
  // deliberately NOT caught : with the database down these throw, the caller skips the
  // row, and the database check is the one that reports the cause. Swallowing the error
  // here printed 'local' as though it had been verified.
  // AnsibleForms-qualified, like every other query here : the pool selects no default
  // schema, so an unqualified table name fails with 'No database selected'
  const ldap = await mysql.do('SELECT `enable` FROM AnsibleForms.`ldap` LIMIT 1');
  const oauth2 = await mysql.do('SELECT name FROM AnsibleForms.`oauth2_providers` WHERE `enable`=1');
  const providers = oauth2.map(r => r.name).filter(Boolean);
  return {
    // local accounts can never be switched off, so it is always in the list
    methods: ['local', ...(ldap[0]?.enable ? ['ldap'] : []), ...providers],
    ldap: !!ldap[0]?.enable,
    oauth2: providers,
  };
}

// The scheduler runs in-process. If the system tasks are missing, the nightly
// backup, the token cleanup and the abandoned-job sweep are all silently not
// happening - which looks exactly like a healthy instance from the outside.
async function schedulerCheck() {
  const system = cronService.jobs?.system
  if (!system || system.size === 0) {
    return check('scheduler', ERROR, 'not running', 'No system tasks are registered');
  }
  const tasks = [];
  for (const [name, task] of system.entries()) {
    var next;
    try { next = task.nextRun?.() || null; } catch { next = null; }
    tasks.push({ name, nextRun: next ? new Date(next).toISOString() : null });
  }
  const counts = {
    system: system.size,
    schedules: cronService.jobs?.schedules?.size || 0,
    repositories: cronService.jobs?.repositories?.size || 0,
  };
  // A registered task is not a running one. croner returns a null next run for a task
  // that has been stopped or whose pattern has no future occurrence, and that is the
  // only scheduler failure actually OBSERVABLE here: the empty-map branch above cannot
  // be reached in practice, because app.js awaits init() - which registers these six
  // tasks - before the http server ever listens, so a registration failure means there
  // is no page to show the row on. This branch is what gives the row a real verdict:
  // a nightly backup that silently stopped scheduling looks identical to a healthy
  // instance from the outside, which is the whole reason this page exists.
  const dead = tasks.filter(t => !t.nextRun);
  if (dead.length > 0) {
    return check('scheduler', ERROR, `${dead.length} of ${system.size} tasks will not run again`, {
      counts, tasks, stopped: dead.map(t => t.name),
    });
  }
  return check('scheduler', OK, `${counts.system} system, ${counts.schedules} schedules`, { counts, tasks });
}

// The dump tool is the one dependency that produces a convincing failure : the
// shell redirect creates the .sql before the command runs, so a missing binary
// leaves a 0-byte 'backup' behind. Report it before it is needed.
// What will actually take the dump. The row used to show only the first token of
// MYSQLDUMP_COMMAND, which reads 'docker' on any wrapped setup - true, but useless: it
// names the wrapper and not the tool, and says nothing about which version will write a
// dump you may have to restore from years later.
const DUMP_TOOL = /^(mysqldump|mariadb-dump)(\.exe)?$/i;

// The command is operator-supplied, so it may carry a password ('-psecret',
// '--password=...'). It is echoed back to anyone with showSettings, so redact first.
function scrubCommand(cmd) {
  return String(cmd || '')
    // anchored on a word boundary : an unanchored /-p\S+/ also eats '--port=3306',
    // which is not a secret and whose value is worth seeing
    .replace(/(^|\s)(-p)\S+/g, '$1-p***')
    .replace(/(--password=)\S+/g, '$1***');
}

async function dumpToolVersion(commandString) {
  try {
    const out = await Cmd.executeSilentCommand({
      command: `${commandString} --version`,
      directory: process.cwd(),
      description: 'Reading the dump tool version'
    }, true, true, 10);
    const first = String(out || '').split(/\r?\n/)[0].trim();
    // 'mysqldump  Ver 8.4.9 for Linux ...' / 'mariadb-dump from 11.4.2-MariaDB ...'
    const m = /\b(\d+\.\d+[\w.-]*)/.exec(first);
    return { version: m ? m[1] : null, raw: first || null };
  } catch {
    return { version: null, raw: null };
  }
}

async function backupToolingCheck() {
  try {
    await BackupModel.assertToolAvailable(appConfig.mysqldumpCommand, 'MYSQLDUMP_COMMAND');
    const parts = String(appConfig.mysqldumpCommand).trim().split(/\s+/);
    const binary = parts[0];                              // what assertToolAvailable resolved
    const tool = parts.find(p => DUMP_TOOL.test(p)) || null;
    const wrapped = !!tool && tool !== binary;            // eg 'docker exec <container> mysqldump'
    const { version, raw } = await dumpToolVersion(appConfig.mysqldumpCommand);
    // 'mysqldump 8.4.9 via docker', 'mariadb-dump 11.4.2', or the bare binary when a
    // custom wrapper hides which tool it calls
    const name = tool || binary;
    const value = [version ? `${name} ${version}` : name, wrapped ? `via ${binary}` : null]
      .filter(Boolean).join(' ');
    return check('backupTooling', OK, value, {
      tool: tool,
      wrapper: wrapped ? binary : null,
      version: version,
      reported: raw,
      command: scrubCommand(appConfig.mysqldumpCommand),
      restoreCommand: scrubCommand(appConfig.mysqlCommand),
      note: tool ? null : 'MYSQLDUMP_COMMAND does not name a known dump tool, so its version could not be read',
    });
  } catch (e) {
    return check('backupTooling', ERROR, 'missing', e.message || String(e));
  }
}

// The check that would have caught weeks of empty backups : not 'does a backup
// exist' but 'is the newest one restorable, and is it recent'.
async function lastBackupCheck() {
  const backups = await BackupModel.listBackups();
  if (backups.length === 0) {
    return check('lastBackup', WARNING, 'none', 'No backups have been taken yet');
  }
  const newest = backups[0]; // listBackups sorts newest first
  const invalid = backups.filter(b => !b.valid).length;
  const detail = { folder: newest.folder, valid: newest.valid, invalidCount: invalid, total: backups.length };
  if (!newest.valid) {
    return check('lastBackup', ERROR, newest.date, { ...detail, reason: 'The newest backup has no usable database dump' });
  }
  // the nightly task runs at midnight, so more than two days old means it has
  // been failing or the scheduler is not running
  const ageDays = (Date.now() - new Date(newest.date).getTime()) / 86400000;
  if (ageDays > 2) {
    return check('lastBackup', WARNING, newest.date, { ...detail, reason: `The newest backup is ${Math.floor(ageDays)} days old` });
  }
  return check('lastBackup', OK, newest.date, detail);
}

// NOT a check : there is no failing value for "where does the config come from". It is a
// fact about this instance, so it goes in the information block.
async function configSourceFacts() {
  const settings = await Settings.findFormsYaml();
  const inDatabase = Settings.resolveConfigInDatabase(settings);
  const active = await Settings.getActiveConfig().catch(() => '');
  const templated = /^\s*#@/m.test(active || '');
  return {
    source: inDatabase ? 'database' : 'file/repository',
    configInDatabase: inDatabase,
    templated,
  };
}

// A stale lock file survives restarts and makes every config save, import and
// export answer 423 with no other symptom.
async function designerLockCheck() {
  // deliberately NOT Lock.status() : that goes through Lock.get(), which enforces
  // showDesigner, and health is a settings-level page
  try {
    const raw = await fs.readFile(appConfig.lockPath, 'utf8');
    const lock = yaml.parse(raw) || {};
    const who = lock.username || 'unknown';
    // A held lock is the designer WORKING, not a fault, and warning on it turned this row
    // amber during ordinary use - which teaches people to ignore amber and so costs us the
    // case that matters: a lock left behind by a closed tab or a restart, which answers 423
    // to every config save, import and export until somebody thinks to look.
    // Lock.set writes `created` as local-time 'YYYY-MM-DD HH:mm:ss', and Date parses it as
    // local time too, so the two agree without a timezone on either side.
    const created = lock.created ? new Date(String(lock.created).replace(' ', 'T')) : null;
    const ageHours = created && !isNaN(created) ? (Date.now() - created.getTime()) / 3600000 : null;
    const detail = {
      username: lock.username || null,
      created: lock.created || null,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      note: 'While the designer lock is held, config saves, imports and exports answer 423',
    };
    if (ageHours === null) {
      // Lock.set always writes a timestamp, so one without it is hand-written or corrupt
      return check('designerLock', WARNING, `held by ${who}, age unknown`,
        { ...detail, reason: 'The lock file has no usable creation time' });
    }
    if (ageHours >= STALE_LOCK_HOURS) {
      return check('designerLock', WARNING, `held by ${who} for ${Math.floor(ageHours)}h`,
        { ...detail, reason: `Held for more than ${STALE_LOCK_HOURS} hours, so it is probably abandoned - release it from the designer` });
    }
    return check('designerLock', OK, `held by ${who}`, detail);
  } catch (e) {
    if (e.code === 'ENOENT') return check('designerLock', OK, 'free');
    throw e;
  }
}

async function repositoriesCheck() {
  const rows = await mysql.do('SELECT name, status, head, managed FROM AnsibleForms.`repositories`').catch((e) => {
    if (['ER_NO_SUCH_TABLE'].includes(e.code)) return [];
    throw e;
  });
  if (rows.length === 0) return check('repositories', OK, 'none configured');
  const failed = rows.filter(r => r.status === 'failed');
  // A row with no working tree on disk. `status` alone misses this: a repository whose very
  // first clone failed keeps whatever status that attempt wrote, and for a SEEDED one the
  // seed then reports 'unchanged' on every later boot because status and head are runtime
  // state it cannot declare. The instance serves stale or no forms with nothing saying why,
  // which is exactly the quiet failure this page exists for. The seed re-clones these, so
  // seeing one here means the re-clone is still running or keeps failing.
  const missing = rows.filter(r => {
    try {
      return !fsSync.existsSync(path.join(appConfig.repoPath, r.name));
    } catch {
      return false;
    }
  });
  const status = (failed.length > 0 || missing.length > 0) ? ERROR : OK;
  const value = missing.length > 0
    ? `${missing.length} of ${rows.length} not cloned`
    : `${rows.length - failed.length}/${rows.length} healthy`;
  return check('repositories', status, value, {
    repositories: rows.map(r => ({ name: r.name, status: r.status || 'unknown', head: r.head || null })),
    notCloned: missing.map(r => r.name),
    note: missing.length > 0
      ? 'No working tree on disk. A seeded repository is re-cloned on every start ; otherwise use Reset on the Repositories page'
      : null,
  });
}

// Job output is longtext and nothing prunes it, so this is the table that grows
// without limit on a busy instance. Surface it before it becomes a problem.
// Secret stores are optional, so an instance without any is fine - but once one is used it
// is a HARD dependency: credential.model.v2 rethrows on a failed read, so a job using a
// credential from it fails outright. For a Vault, nothing renews the token, so the
// realistic failure is not a dead server but a token quietly reaching the end of its ttl.
const VAULT_TTL_WARN_SECONDS = 7 * 24 * 3600;

function describeVaultToken(info) {
  // Vault reports 0 for a token that does not expire
  if (!info?.ttl) return { status: OK, value: 'token does not expire' };
  const days = Math.floor(info.ttl / 86400);
  const value = days >= 1 ? `token expires in ${days}d` : `token expires in ${Math.max(1, Math.round(info.ttl / 3600))}h`;
  if (info.ttl > VAULT_TTL_WARN_SECONDS) return { status: OK, value };
  return {
    status: WARNING,
    value,
    reason: info.renewable
      ? 'Nothing renews this token automatically - every credential reading from this store fails when it expires'
      : 'This token is not renewable - issue a new one before it expires, or every credential reading from this store fails',
  };
}

async function secretStoresCheck() {
  const stores = await SecretStore.findAll() || [];
  // no network at all when none is in use
  if (!stores.length) return check('secretStores', OK, 'none configured');
  // 5s, not the 10s default : these checks run in parallel and a hanging store would hold
  // the whole page
  const results = await Promise.all(stores.map(async (store) => {
    const base = { name: store.name, type: store.type, url: store.url };
    try {
      const info = await checkStore(store, { timeoutMs: 5000 });
      if (store.type !== 'vault') return { ...base, status: OK, value: 'reachable' };
      const token = describeVaultToken(info);
      return { ...base, status: token.status, value: `reachable, ${token.value}`, ...(token.reason ? { reason: token.reason } : {}),
        namespace: info.namespace, kvVersion: info.kvVersion, defaultMount: info.defaultMount, renewable: info.renewable, policies: info.policies, ttlSeconds: info.ttl };
    } catch (e) {
      return { ...base, status: ERROR, value: 'unreachable', reason: e.message || String(e) };
    }
  }));
  const worst = results.reduce((w, r) => (SEVERITY[r.status] > SEVERITY[w] ? r.status : w), OK);
  const failing = results.filter((r) => r.status !== OK);
  const value = !failing.length
    ? `${results.length} store(s) reachable`
    : failing.length === 1 && results.length === 1
      ? failing[0].value
      : `${failing.length} of ${results.length} store(s) need attention : ${failing.map((r) => r.name).join(', ')}`;
  // one store failing : its reason is the check's reason, as it was for the single Vault
  const reason = failing.length === 1 ? failing[0].reason : undefined;
  return check('secretStores', worst, value, { ...(reason ? { reason } : {}), stores: results });
}

// Runners : where jobs run (RTEs for playbooks, AWX/AAP for templates). Since 7.2 the app
// runs nothing itself, so with no runner no form can run a job - a warning, not an error :
// a fresh instance has none yet. Each runner is asked for its health (an RTE also proves it
// runs this release), in parallel, like the secret stores.
async function runnersCheck() {
  const runners = await Runner.findAll() || [];
  if (!runners.length) {
    return check('runners', WARNING, 'none configured', { reason: 'Since 7.2 jobs run on runners : add one under Connections > Runners (an RTE for playbooks, AWX/AAP for templates)' });
  }
  const results = await Promise.all(runners.map(async (runner) => {
    const base = { name: runner.name, type: runner.type, uri: runner.uri, isDefault: !!runner.is_default };
    try {
      const info = await Runner.check(runner);
      return { ...base, status: OK, value: 'reachable', ...info };
    } catch (e) {
      return { ...base, status: ERROR, value: 'unreachable', reason: e.message || String(e) };
    }
  }));
  const worst = results.reduce((w, r) => (SEVERITY[r.status] > SEVERITY[w] ? r.status : w), OK);
  const failing = results.filter((r) => r.status !== OK);
  const value = !failing.length
    ? `${results.length} runner(s) reachable`
    : failing.length === 1 && results.length === 1
      ? failing[0].value
      : `${failing.length} of ${results.length} runner(s) need attention : ${failing.map((r) => r.name).join(', ')}`;
  const reason = failing.length === 1 ? failing[0].reason : undefined;
  // a playbook form that names no runner runs on the default RTE : without one it fails
  if (worst === OK && !runners.some((r) => r.type === 'rte' && r.is_default)) {
    return check('runners', WARNING, 'no default RTE', {
      reason: 'Playbook forms that name no runner fail : mark an RTE as default under Connections > Runners',
      runners: results,
    });
  }
  return check('runners', worst, value, { ...(reason ? { reason } : {}), runners: results });
}

// LDAP, WITHOUT binding.
//
// The page's rule is that nothing here may bind to ldap, and that is not squeamishness: a
// bind is an authentication attempt against the directory, so it lands in its audit log and
// feeds its lockout counters - on every page refresh. user.model's UPN retry carries the
// same warning for the same reason. So this opens a socket and stops.
//
// That still catches the two failures worth catching. A wrong host, port or firewall rule
// is the most common ldap misconfiguration, and it is otherwise indistinguishable from a
// wrong password when a user reports they cannot sign in. And an expiring LDAPS
// certificate is a genuinely quiet time bomb: logins keep working until the day it lapses.
// Whether the credentials are right is left to the LDAP page's own test button.
const LDAP_CERT_WARN_DAYS = 14;

async function ldapCheck() {
  const rows = await mysql.do('SELECT server, port, enable_tls, ignore_certs, `enable` FROM AnsibleForms.`ldap` LIMIT 1')
    .catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return []; throw e; });
  const cfg = rows[0];
  if (!cfg || !cfg.enable) return check('ldap', OK, 'not enabled');
  if (!cfg.server) return check('ldap', ERROR, 'no server configured', 'LDAP is enabled but no server is set');
  const port = Number(cfg.port) || (cfg.enable_tls ? 636 : 389);
  const target = `${cfg.server}:${port}`;

  const socket = await new Promise((resolve) => {
    const done = (result) => { try { conn.destroy(); } catch { /* already gone */ } resolve(result); };
    const onError = (e) => done({ ok: false, reason: e.message || String(e) });
    // rejectUnauthorized false even when ignore_certs is off : this must report an expiry,
    // not fail to connect because of one. Validity is judged below, from the certificate.
    const conn = cfg.enable_tls
      ? tls.connect({ host: cfg.server, port, rejectUnauthorized: false, timeout: 5000 },
          () => done({ ok: true, cert: conn.getPeerCertificate() || null, authorized: conn.authorized, authError: conn.authorizationError }))
      : net.connect({ host: cfg.server, port, timeout: 5000 }, () => done({ ok: true }));
    conn.on('error', onError);
    conn.on('timeout', () => done({ ok: false, reason: `no answer from ${target} within 5s` }));
  });

  if (!socket.ok) {
    return check('ldap', ERROR, 'unreachable', { server: target, tls: !!cfg.enable_tls, reason: socket.reason });
  }
  const detail = { server: target, tls: !!cfg.enable_tls, note: 'Reachability only - no bind is attempted, so this says nothing about the credentials' };
  if (!cfg.enable_tls) return check('ldap', OK, `${target} reachable`, detail);

  const validTo = socket.cert?.valid_to ? new Date(socket.cert.valid_to) : null;
  if (!validTo || isNaN(validTo)) {
    return check('ldap', OK, `${target} reachable over TLS`, { ...detail, certificate: 'not readable' });
  }
  const days = Math.floor((validTo.getTime() - Date.now()) / 86400000);
  const certDetail = { ...detail, certificateExpires: validTo.toISOString(), daysLeft: days,
    // an ignored certificate is a deliberate choice, but worth stating next to its expiry
    ignoringCertificateErrors: !!cfg.ignore_certs,
    authorizationError: socket.authorized ? null : (socket.authError || null) };
  if (days < 0) return check('ldap', ERROR, `TLS certificate expired ${Math.abs(days)}d ago`, certDetail);
  if (days <= LDAP_CERT_WARN_DAYS) return check('ldap', WARNING, `TLS certificate expires in ${days}d`, certDetail);
  return check('ldap', OK, `${target} reachable, certificate valid ${days}d`, certDetail);
}

// Is the schema actually complete?
//
// There is no version table: patches are idempotent and re-run on every boot, so nothing
// records where a database got to. A patch that fails leaves a half-migrated schema, one
// line in the startup log, and no way to ask about it afterwards - which is exactly the
// kind of quiet failure this page exists for. The manifest lives in schema.model.js beside
// the patches that create each item, so adding a patch means editing one file.
//
// Three information_schema reads, no writes.
async function schemaCheck() {
  if (!SCHEMA_MANIFEST?.base?.tables?.length) {
    throw new Error('The schema manifest is empty or unreadable, so completeness cannot be judged');
  }
  const wanted = { tables: new Set(SCHEMA_MANIFEST.base.tables), columns: new Set(), indexes: new Set() };
  // which patch is responsible for each item, so the row can name the migration to look at
  const owner = new Map();
  for (const [patch, spec] of Object.entries(SCHEMA_MANIFEST.patches)) {
    for (const t of spec.tables || []) { wanted.tables.add(t); if (!owner.has(t)) owner.set(t, patch); }
    for (const c of spec.columns || []) { wanted.columns.add(c); owner.set(c, patch); }
    for (const i of spec.indexes || []) { wanted.indexes.add(i); owner.set(i, patch); }
  }

  const [tableRows, columnRows, indexRows] = await Promise.all([
    mysql.do("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='AnsibleForms'"),
    mysql.do("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema='AnsibleForms'"),
    mysql.do("SELECT DISTINCT table_name AS t, index_name AS i FROM information_schema.statistics WHERE table_schema='AnsibleForms'"),
  ]);
  const haveTables = new Set(tableRows.map(r => r.t));
  const haveColumns = new Set(columnRows.map(r => `${r.t}.${r.c}`));
  const haveIndexes = new Set(indexRows.map(r => `${r.t}.${r.i}`));

  const missingTables = [...wanted.tables].filter(t => !haveTables.has(t)).sort();
  // a column on a table that is itself missing would be noise - the table is the finding
  const missingColumns = [...wanted.columns]
    .filter(c => !haveColumns.has(c) && haveTables.has(c.split('.')[0]))
    .sort();
  const missingIndexes = [...wanted.indexes].filter(i => !haveIndexes.has(i) && haveTables.has(i.split('.')[0])).sort();

  const missing = missingTables.length + missingColumns.length + missingIndexes.length;
  if (missing === 0) return check('schema', OK, 'complete', { tables: haveTables.size });

  const failedPatches = [...new Set([...missingTables, ...missingColumns, ...missingIndexes]
    .map(x => owner.get(x)).filter(Boolean))].sort();
  const detail = {
    missingTables, missingColumns, missingIndexes,
    // the actionable part : which migration to investigate, not just what is absent
    failedPatches,
    note: 'Patches re-run on every boot, so a restart is the first thing to try. If they still fail the startup log says why.',
  };
  // A missing index is slow, not broken : idx_jobs_retention absent only makes the nightly
  // job cleanup full-scan the largest table. It must not read like a broken schema.
  const status = (missingTables.length || missingColumns.length) ? ERROR : WARNING;
  return check('schema', status, `${missing} missing`, detail);
}

async function storageCheck() {
  const rows = await mysql.do(
    // 'rows' is a reserved word in mysql 8, hence row_count
    `SELECT table_name AS name, table_rows AS row_count, data_length + index_length AS bytes
       FROM information_schema.tables
      WHERE table_schema = 'AnsibleForms' AND table_name IN ('jobs','job_output')`
  );
  const total = rows.reduce((sum, r) => sum + Number(r.bytes || 0), 0);
  const mb = Math.round(total / 1048576);
  // The size alone is not actionable : what matters is whether anything prunes it.
  // JOB_RETENTION_DAYS defaults to 0 (keep for ever), so "4 GB and no retention" is the
  // line worth reading, and a large table with pruning switched off is a warning.
  const keep = appConfig.jobRetentionDays;
  const pruning = keep >= 1;
  const status = (!pruning && mb > 1024) ? WARNING : OK;
  return check('storage', status, pruning ? `${mb} MB, kept ${keep} days` : `${mb} MB, retention disabled`, {
    tables: rows.map(r => ({ name: r.name, rows: Number(r.row_count || 0), bytes: Number(r.bytes || 0) })),
    jobRetentionDays: keep,
    auditRetentionDays: appConfig.auditRetentionDays,
    nightlyBackupRetention: appConfig.nightlyBackupRetention,
    note: pruning ? null : 'Job history and output are never pruned : set JOB_RETENTION_DAYS to enable it',
  });
}

// Everything this app persists goes to a configured folder, and every one of those
// folders is independently overridable by env - so the check is over the actual
// configured set, not over 'persistent/'. A read-only or wrong-owner volume (the usual
// docker mistake) shows up today as unrelated failures spread over backups, uploads, the
// designer lock and the log file, with nothing pointing at the cause. The disk check
// reports free space, which says nothing about being allowed to write.
//
// fs.access is a permission query, not a write, so this stays side-effect free. A folder
// that does not exist yet is judged by its parent, because that is what decides whether
// it can be created.
async function writableCheck() {
  const targets = [
    ['config', path.dirname(appConfig.configPath)],
    ['forms', appConfig.formsFolderPath],
    ['formsStaging', appConfig.formsStagingPath],
    ['formsBackups', appConfig.formsBackupPath],
    ['backups', appConfig.backupPath],
    ['uploads', appConfig.uploadPath],
    ['vars', appConfig.varsFilesPath],
    ['repositories', appConfig.repoPath],
    ['lock', path.dirname(appConfig.lockPath)],
    ['logs', logConfig.path],
  ].filter(([, dir]) => !!dir);

  // one entry per distinct folder : most of these are the same 'persistent' directory,
  // and reporting it ten times would bury a single genuine failure
  const byDir = new Map();
  for (const [name, dir] of targets) {
    const resolved = path.resolve(dir);
    if (!byDir.has(resolved)) byDir.set(resolved, []);
    byDir.get(resolved).push(name);
  }

  const failures = [];
  for (const [dir, uses] of byDir) {
    let target = dir, existed = true;
    try {
      await fs.access(dir);
    } catch {
      existed = false;
      target = path.dirname(dir);
    }
    try {
      await fs.access(target, fsConstants.W_OK);
    } catch (e) {
      failures.push({ path: dir, uses, exists: existed, reason: e.code || String(e) });
    }
  }
  return check('writable', failures.length ? ERROR : OK,
    failures.length ? `${failures.length} of ${byDir.size} not writable` : `${byDir.size} folders writable`,
    failures.length ? { failures } : { folders: [...byDir.keys()] });
}

// EXPRESSION_SANITIZER. legacy is a warning, not information : it re-opens remote code
// execution for every authenticated user, and this page is where an operator notices it.
async function expressionsCheck() {
  const mode = getExpressionMode();
  if (mode === 'legacy') {
    return check('expressions', WARNING, 'legacy sanitizer', {
      mode,
      reason: 'Any authenticated user can run code on the server through a server expression',
      note: 'The log lists every expression the strict rules would refuse - rewrite those, then set EXPRESSION_SANITIZER back to strict',
    });
  }
  const values = { off: 'server expressions disabled', paranoid: 'paranoid sanitizer', strict: 'strict sanitizer' };
  return check('expressions', OK, values[mode], { mode });
}

/**
 * The declarative config seed. A bad seed refuses to START, so a file that never applied
 * cannot be reported from here - the process would not be up to answer. A bad RELOAD is
 * the opposite : it is survivable on purpose, the instance keeps the configuration it
 * already had, and then this row is the only thing that says the file on disk and the
 * configuration in force have parted company.
 *
 * It also still catches the file going away or becoming unreadable, which is a live risk
 * on kubernetes where a ConfigMap can be remounted or renamed underneath a running pod.
 *
 * Side-effect free, like every row on this page : the file is read, never applied.
 */
async function configSeedCheck() {
  const seedPath = appConfig.configSeedPath;
  if (!seedPath) {
    return check('configSeed', OK, 'not configured',
      { note: 'Set CONFIG_SEED_PATH to declare the admin objects in a file - see https://ansibleforms.com/seed' });
  }
  // Before anything read from disk : a failed reload means what is on disk is NOT what is
  // running, so reporting the file as healthy would describe configuration nobody applied.
  const state = getSeedState();
  if (state.failure) {
    return check('configSeed', ERROR, 'last reload failed',
      {
        path: seedPath,
        reason: state.failure.error,
        failedAt: state.failure.at,
        appliedAt: state.appliedAt,
        note: 'The configuration in force is the one applied before the failed reload. Fix the file, or POST /api/v2/config-seed/apply to retry it now',
      });
  }
  try {
    await fs.access(seedPath, fsConstants.R_OK);
  } catch (e) {
    return check('configSeed', ERROR, 'unreadable',
      { path: seedPath, reason: e.message, note: 'The next restart will refuse to start' });
  }
  // What it declares, so the row is worth a line even when everything is fine. Parsed
  // but NOT validated : a validation verdict here would contradict the fact that the
  // running instance applied this file successfully at boot.
  let sections;
  try {
    const doc = yaml.parse(await fs.readFile(seedPath, 'utf8')) || {};
    // Same top-level rule applyConfigSeed enforces. Without it a file replaced by a YAML
    // list read as ok with "2 section(s) declared" (array indices) and a scalar as
    // "5 section(s)" (string indices) - reporting healthy while the next restart refuses
    // to start, which is the one thing this check exists to catch.
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      return check('configSeed', ERROR, 'not a yaml mapping',
        { path: seedPath, note: 'The next restart will refuse to start' });
    }
    sections = Object.keys(doc).filter(k => k !== 'version');
  } catch (e) {
    return check('configSeed', ERROR, 'unparseable',
      { path: seedPath, reason: e.message, note: 'The next restart will refuse to start' });
  }
  return check('configSeed', OK, `${sections.length} section(s) declared`,
    { path: seedPath, sections });
}

// How many records the seed currently owns, per table. A fact, not a verdict : it is
// the quickest way to tell whether the file everybody edits is actually in force.
async function seedManagedFacts() {
  const tables = ['runners', 'credentials', 'secret_stores', 'oauth2_providers', 'repositories', 'ldap', 'settings'];
  const counts = {};
  let total = 0;
  for (const table of tables) {
    // qualified name : mysql.do selects no default schema
    const rows = await mysql.do(`SELECT COUNT(*) AS total FROM AnsibleForms.\`${table}\` WHERE managed = 1`);
    const n = rows[0]?.total || 0;
    if (n) counts[table] = n;
    total += n;
  }
  return { total, counts };
}

Health.check = async function () {
  const checks = await Promise.all([
    safely('database', databaseCheck),
    safely('schema', schemaCheck),
    safely('scheduler', schedulerCheck),
    safely('jobs', jobsCheck),
    safely('backupTooling', backupToolingCheck),
    safely('lastBackup', lastBackupCheck),
    safely('designerLock', designerLockCheck),
    safely('repositories', repositoriesCheck),
    // next to repositories : both are about configuration arriving from outside the app
    safely('configSeed', configSeedCheck),
    safely('secretStores', secretStoresCheck),
    safely('runners', runnersCheck),
    safely('expressions', expressionsCheck),
    safely('ldap', ldapCheck),
    safely('storage', storageCheck),
    safely('writable', writableCheck),
    // disk last, next to job storage : the two size-related rows read together
    safely('disk', diskCheck),
  ]);
  const status = checks.reduce((worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst), OK);
  // counts for the summary strip : the question you open this page to ask is "is anything
  // wrong", which should not require scanning eleven dots
  const summary = { ok: 0, warning: 0, error: 0 };
  for (const c of checks) if (summary[c.status] !== undefined) summary[c.status]++;
  // Facts about this instance. Deliberately a SEPARATE list with no status field : a
  // green dot beside 'MySQL 8.4.9' or 'file/repository' claims a verdict was reached when
  // nothing was tested. These are things you look up, not things that pass or fail.
  const info = [];
  const add = (key, value, detail) => { if (value !== null && value !== undefined) info.push({ key, value, detail: detail ?? null }); };
  // version first : it is the one fact every support conversation opens with
  add('version', buildInfo?.gitSha && buildInfo.gitSha !== 'dev'
    ? `${buildInfo.version || pkgVersion || 'unknown'} (${buildInfo.gitSha}${buildInfo.dirty ? '-dirty' : ''})`
    : (pkgVersion || 'unknown'), buildInfo || null);
  // Omitted entirely when there is no local ansible, rather than shown as 'not installed'.
  // An instance that only drives AWX/AAP has none and does not need any, so the row would
  // be a permanent non-fact - and add() already skips a null value.
  // How the application is reached. Not editable anywhere - it is fixed at startup, since the
  // served index.html carries the base path - so it is a fact, and this is where facts live.
  add('baseUrl', appConfig.baseUrl || '/', {
    note: appConfig.baseUrl
      ? 'Set with BASE_URL, for hosting behind a reverse proxy under a subpath'
      : 'Served from the root ; set BASE_URL to host it under a subpath',
  });
  try {
    const db = await databaseFacts();
    add('database', `${db.product} ${db.number}`.trim(), { version: db.version, comment: db.comment || null });
    add('databaseHost', `${dbConfig.host}:${dbConfig.port}`, { schema: 'AnsibleForms' });
  } catch (e) {
    // the check row already reports the failure ; do not repeat it here
    logger.debug(`Health info: database facts unavailable : ${e.message || e}`);
  }
  // Beside the config source, because it answers the same question for the other half of
  // the configuration : config.yaml has a source, and so do the admin objects.
  if (appConfig.configSeedPath) {
    try {
      const seeded = await seedManagedFacts();
      add('configSeed', seeded.total ? `${seeded.total} managed record(s)` : 'no managed records', {
        path: appConfig.configSeedPath,
        perTable: seeded.counts,
        note: seeded.total
          ? 'These are enforced on every start and read-only in the API'
          : 'The seed is configured but owns nothing yet - it may not have applied',
      });
    } catch (e) {
      // let it be absent rather than print a count it could not read : the whole premise
      // of this list is that it never claims a fact it did not establish
      logger.debug(`Health info: seed facts unavailable : ${e.message || e}`);
    }
  }
  try {
    const cfg = await configSourceFacts();
    add('configSource', cfg.source, {
      configInDatabase: cfg.configInDatabase,
      templated: cfg.templated,
      // a ytt template is not a fault, but it puts every visual editor in read-only
      note: cfg.templated ? 'The config is a ytt template, so the designer and config editors are read-only' : null,
    });
  } catch (e) {
    logger.debug(`Health info: config source unavailable : ${e.message || e}`);
  }
  // All four in one line on purpose : 0 means 'delete nothing' for each of them, but they
  // are four separate code paths and the value is easiest to get wrong when you can only
  // see one at a time. Nightly backups are a COUNT, not days, hence the separate wording.
  const days = (n) => (Number(n) > 0 ? `${n} days` : 'never');
  add('retention', `jobs ${days(appConfig.jobRetentionDays)}, audit ${days(appConfig.auditRetentionDays)}, backups ${appConfig.nightlyBackupRetention > 0 ? appConfig.nightlyBackupRetention : 'never'}, restore points ${days(appConfig.oldBackupDays)}`, {
    jobRetentionDays: appConfig.jobRetentionDays,
    auditRetentionDays: appConfig.auditRetentionDays,
    nightlyBackupRetention: appConfig.nightlyBackupRetention,
    configRestorePointDays: appConfig.oldBackupDays,
    note: '0 deletes nothing, for every one of these',
  });
  try {
    const auth = await authenticationFacts();
    add('authentication', auth.methods.join(', '), { ldap: auth.ldap, oauth2: auth.oauth2 });
  } catch (e) {
    logger.debug(`Health info: authentication facts unavailable : ${e.message || e}`);
  }
  // 'where is the log file' opens most support threads, and LOG_PATH is overridable so
  // the answer is not guessable from the install layout
  // An INFO row, not a check: mail is optional, so 'not configured' is not a fault, and a
  // row that goes amber for a legitimate setup is noise. Whether it actually WORKS is left
  // to Mail's own test button - reading the row proves nothing about the smtp host.
  try {
    const mail = await Settings.findMailSettings();
    add('mail', mail?.mail_server ? `${mail.mail_server}:${mail.mail_port || '?'}` : 'not configured', {
      // never the password, and the username only as a yes/no
      secure: mail?.mail_server ? !!mail.mail_secure : null,
      authenticated: mail?.mail_server ? !!mail.mail_username : null,
      note: mail?.mail_server ? null : 'Approval requests and job notifications are sent by mail, so they go nowhere until this is set',
    });
  } catch (e) {
    logger.debug(`Health info: mail settings unavailable : ${e.message || e}`);
  }
  add('logs', `${logConfig.level} \u00b7 ${logConfig.path}`, {
    level: logConfig.level,
    path: logConfig.path,
    consoleLevel: logConfig.consolelevel,
  });
  add('uptime', `up ${uptimeText()}`, { seconds: Math.round(process.uptime()) });
  add('timezone', logConfig.tz, { note: 'LOG_TZ decides how stored timestamps are rendered' });
  add('node', process.version, { environment: appConfig.nodeEnvironment });
  add('platform', `${os.type()} ${os.release()} (${os.arch()})`, { cpus: os.cpus().length });

  return { status, summary, checks, info };
};

export default Health;
export { scrubCommand };
