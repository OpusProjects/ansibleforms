
import Cmd from '../lib/cmd.js';
import dbConfig from '../../config/db.config.js';
import { promises as fs } from 'fs';
import path from 'path';
import appConfig from '../../config/app.config.js';
import { MANAGED_ENV_PATH } from '../lib/envSettings.js';
import Helpers from '../lib/common.js';
import yaml from 'yaml';
// the same parser load-env.js and envSettings.js read this file with, so the check below
// cannot disagree with what the application actually sees
import dotenv from 'dotenv';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import { bump } from '../lib/epochs.js';

// The tables that describe the running processes, not the configuration : which nodes are up,
// what changed between them (lib/epochs.js), who holds the designer. A restore must not bring
// back gone nodes, an old designer lock or old change counters - so they are not dumped, and a
// restore leaves the live ones as they are.
const RUNTIME_TABLES = ['nodes', 'cache_epochs', 'designer_lock']
  .map((t) => `--ignore-table=AnsibleForms.${t}`).join(' ')
  // tablespaces are the server's, not the schema's : dumping them needs the PROCESS right, which
  // a user limited to the AnsibleForms schema does not have (mysqldump and mariadb-dump)
  + ' --no-tablespaces';

/**
 * Wrap a value for a POSIX shell as a single-quoted string.
 *
 * Only the password was ever escaped here. dbHost and dbPort went in bare and dbUser sat
 * inside single quotes without its own quotes being escaped, so a legitimate value
 * carrying an apostrophe or a shell metacharacter produced a mangled - or injected -
 * command rather than a quoting error. These come from DB_HOST / DB_USER / DB_PORT, which
 * are editable through the managed env file.
 *
 * The `'"'"'` idiom is how you get a literal apostrophe into a single-quoted shell word:
 * close the quote, emit an escaped one, reopen.
 */
function shQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

// --- Helpers for backup details ---
async function getFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function getDirStats(dirPath) {
  let totalSize = 0;
  let fileCount = 0;
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        fileCount++;
        totalSize += stat.size;
      }
    }
  } catch (e) {
    logger.warning(`getDirSize: failed to read ${dirPath}: ${e.message || e}`);
  }
  return { fileCount, totalSize };
}

// Describe one backup folder. Shared by listBackups and getBackupByFolder so the
// list and the detail panel can never disagree about the same backup.
//
// `valid` is the one field that matters : the sql dump is what a restore actually
// replays, so a missing or EMPTY dump means the folder is not a restore point at
// all, however healthy it looks in the list. Empty is the common case - the dump
// is written through a shell redirect, which creates the file before the command
// runs, so a missing mysqldump binary leaves a 0-byte .sql behind.
async function describeBackup(folder) {
  const backupFolder = path.join(appConfig.backupPath, folder);
  const backupFile = path.join(backupFolder, 'ansibleforms.sql');
  const configYaml = path.join(backupFolder, path.basename(appConfig.configPath));
  const formsDir = path.join(backupFolder, 'forms');
  const envFile = path.join(backupFolder, ENV_BACKUP_NAME);
  let description = '';
  try {
    const metaRaw = await fs.readFile(path.join(backupFolder, 'meta.yaml'), 'utf8');
    const meta = yaml.parse(metaRaw);
    description = meta?.description || '';
  } catch {}
  const backupFileExists = await fs.stat(backupFile).then(() => true).catch(() => false);
  const backupFileSize = await getFileSize(backupFile);
  const formsDirStats = await getDirStats(formsDir);
  return {
    folder,
    date: Helpers.dateFromBackupFolder(folder),
    description,
    valid: backupFileExists && backupFileSize > 0,
    backupFileExists,
    configYamlExists: await fs.stat(configYaml).then(() => true).catch(() => false),
    formsDirExists: await fs.stat(formsDir).then(() => true).catch(() => false),
    // Reported so an operator can SEE that this folder carries environment settings - it is
    // 0600 and credential-bearing (VAULT_TOKEN, a mail password), and it is restored only on
    // request, so the list must not stay silent about it.
    envFileExists: await fs.stat(envFile).then(() => true).catch(() => false),
    envFileSize: await getFileSize(envFile),
    configYamlSize: await getFileSize(configYaml),
    backupFileSize,
    formsDirFileCount: formsDirStats.fileCount,
    formsDirTotalSize: formsDirStats.totalSize
  };
}

// reusable directory copy helper (used by copyFormsAndFolder and restore)
async function copyDir(src, dest) {
  // if source doesn't exist or isn't a directory, do nothing
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }
  logger.debug(`Copying dir ${src} -> ${dest}`)
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      logger.debug(`Copying file ${srcPath} -> ${destPath}`)
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// copy file only if exists
async function copyFileIfExists(src,dest,mode){
    var exists=true
    try {
      await fs.access(src);
    } catch {
      exists=false
      logger.warning(`File ${src} not found`)
    }   
    if(exists){   
      logger.debug(`Copying file ${src} -> ${dest}`)
      await fs.copyFile(src, dest);
      // a file that can hold credentials must not widen when it is copied
      if (mode !== undefined) { await fs.chmod(dest, mode); }
    }
}

// Secrets that must never leave the host inside a backup. Both are unrecoverable-by-design
// rather than merely sensitive: ENCRYPTION_SECRET decrypts every stored credential (so it
// would defeat the dump's encryption if shipped with it) and ACCESS_TOKEN_SECRET signs
// sessions. Neither is readable through the API at all - see REFUSED in lib/envSettings.js.
const ENV_BACKUP_EXCLUDE = ['ENCRYPTION_SECRET', 'ACCESS_TOKEN_SECRET'];

/**
 * The name a line assigns, read with DOTENV'S OWN grammar.
 *
 * It matters that this agrees with the reader exactly. The previous pattern was
 * `^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=`, which does not recognise the optional `export `
 * prefix that dotenv accepts - so `export ENCRYPTION_SECRET='...'` was read by the
 * application as a real value and NOT recognised here, and the key that decrypts every
 * stored credential was written verbatim into every backup, in the same folder as the
 * ciphertext it opens. `export` is not exotic in this file either: it is what you write
 * when the file is also meant to be `source`d, which this project's own documentation
 * does.
 *
 * This is the same lesson envSettings.parseEnvFile already records - a second, hand
 * written parser that disagrees with dotenv creates a whole class of bug - so the name
 * charset follows dotenv's `[\w.-]+` too, not just letters and underscores.
 */
function envAssignmentName(line) {
  return /^\s*(?:export\s+)?([\w.-]+)\s*=/.exec(line)?.[1] || null;
}

// Whether a value leaves a quote open at the end of its line, so the assignment continues
// on the next one. dotenv allows a real newline inside a quoted value, and dropping only
// the FIRST line of such a secret would leave the rest of it behind as loose text.
function opensUnterminatedQuote(afterEquals) {
  const value = afterEquals.replace(/^\s*/, '');
  const quote = value[0];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  // closed on this same line ?
  return value.slice(1).includes(quote) ? null : quote;
}

/**
 * Copies the managed env file into a backup with the master secrets removed, leaving a
 * comment in their place so a restore is not a silent surprise. Line based on purpose: it
 * must not reformat or re-quote anything it does not understand.
 *
 * Two lines of defence, because what leaks here is unrecoverable: the line filter above,
 * and then a re-parse of the RESULT with dotenv. If an excluded name survives that, the
 * environment file is left out of the backup entirely rather than shipped with a secret
 * in it - a backup missing one optional file is a nuisance, a backup carrying
 * ENCRYPTION_SECRET beside the dump is the thing this function exists to prevent.
 */
async function copyEnvWithoutMasterSecrets(src, dest) {
  let text;
  try {
    text = await fs.readFile(src, 'utf8');
  } catch {
    logger.warning(`File ${src} not found`);
    return;
  }
  const kept = [];
  const removed = [];
  let dropUntilQuote = null;     // inside a multi-line value we are dropping
  for (const line of text.split(/\r?\n/)) {
    if (dropUntilQuote) {
      // still inside the removed value : drop this line too, and stop when it closes
      if (line.includes(dropUntilQuote)) dropUntilQuote = null;
      continue;
    }
    const name = envAssignmentName(line);
    if (name && ENV_BACKUP_EXCLUDE.includes(name)) {
      removed.push(name);
      dropUntilQuote = opensUnterminatedQuote(line.slice(line.indexOf('=') + 1));
      continue;
    }
    kept.push(line);
  }
  const header = removed.length
    ? `# ${removed.join(' and ')} removed from this backup on purpose - set them on the target host.\n`
    : '';
  const body = header + kept.join('\n');

  // Verified against the real reader, not against the filter's own idea of the grammar.
  const survivors = ENV_BACKUP_EXCLUDE.filter((name) => dotenv.parse(body)[name] !== undefined);
  if (survivors.length) {
    logger.error(`Refusing to put the environment file in the backup : ${survivors.join(', ')} survived the filter. Rewrite that entry in ${src} as a plain NAME=value line.`);
    return;
  }

  await fs.writeFile(dest, body, { mode: 0o600 });
  // writeFile does not chmod a file that already exists
  await fs.chmod(dest, 0o600);
  if (removed.length) logger.info(`Backed up the environment file without ${removed.join(', ')}`);
}

const ENV_BACKUP_NAME = 'managed.env';

class BackupModel {
  static getBackupPaths() {
    const backupRoot = appConfig.backupPath;
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const backupFolder = path.join(backupRoot, timestamp);
    const backupFile = path.join(backupFolder, 'ansibleforms.sql');
    return { backupRoot, backupFolder, backupFile, timestamp };
  }

  static async backupFormsAndFolder(backupFolder) {
    logger.info(`Copying config/yaml files and forms folder to ${backupFolder}`)
    
    // Backup config.yaml (new structure)
    const configFile = appConfig.configPath;
    const destConfigFile = path.join(backupFolder, path.basename(configFile));
    await copyFileIfExists(configFile, destConfigFile);
    
    // Backup the managed environment file. Everything the settings page writes lives here,
    // and without this a restore onto a fresh host silently loses all of it.
    //
    // The two MASTER secrets are stripped out. The dump beside this file holds every stored
    // credential as AES ciphertext, so writing ENCRYPTION_SECRET next to it would put the
    // lock and the key in the same folder - and a backup travels (rsync, a support bundle, a
    // playbook that reads persistent/). ENCRYPTION_SECRET is REFUSED in the settings page and
    // redacted by GET /api/v2/config/env precisely so no admin can read it through the API;
    // it must not be readable from a backup either. ACCESS_TOKEN_SECRET goes for the same
    // reason - it forges sessions.
    //
    // Everything else stays, so a rebuild still gets DB_*, VAULT_*, the paths and the log
    // settings. What is left can still hold credentials, so the copy is 0600 rather than
    // inheriting the folder's mode.
    //
    // Deliberately NOT restored automatically : see restoreFormsAndFolder.
    await copyEnvWithoutMasterSecrets(MANAGED_ENV_PATH, path.join(backupFolder, ENV_BACKUP_NAME));

    // Backup forms directory
    const formsDir = appConfig.formsFolderPath;
    const destDir = path.join(backupFolder, 'forms');
    await copyDir(formsDir, destDir);
  }


  // The environment file is captured by a backup but NOT restored with it. DB_HOST, the
  // paths and the TLS locations in it describe the machine the backup was taken on, so
  // restoring it onto a different host would point that instance at the wrong database.
  // Callers that genuinely want it back ask for it explicitly.
  /**
   * @param {string} folder A backup folder NAME (YYYYMMDDHHmmss), like every sibling method
   *   here takes. It used to take a full path, which was both inconsistent - the natural
   *   wiring `restoreManagedEnv(req.params.folder)` would silently look in the wrong place -
   *   and a traversal primitive, since `path.join` on an unvalidated caller string could
   *   write an arbitrary file over the live persistent/.env.
   */
  static async restoreManagedEnv(folder) {
    if (!folder || !/^\d{14}$/.test(folder)) throw new Errors.BadRequestError('Invalid or missing backup folder');
    const src = path.join(appConfig.backupPath, folder, ENV_BACKUP_NAME);
    try {
      await fs.access(src);
    } catch {
      return { restored: false, reason: 'the backup contains no environment file' };
    }
    // Keep the current file first. writeManaged does the same, for the same reason: a bad
    // DB_HOST in here stops the app from starting, and the previous file is the only way
    // back - which matters most for exactly this operation, the one likeliest to install a
    // DB_HOST belonging to another machine.
    try {
      const previous = await fs.readFile(MANAGED_ENV_PATH, 'utf8');
      await fs.writeFile(`${MANAGED_ENV_PATH}.bak`, previous, { mode: 0o600 });
      await fs.chmod(`${MANAGED_ENV_PATH}.bak`, 0o600);
    } catch (e) {
      if (e.code !== 'ENOENT') logger.warning(`Could not back up ${MANAGED_ENV_PATH} : ${e.message}`);
    }
    await copyFileIfExists(src, MANAGED_ENV_PATH, 0o600);
    logger.warning(`Restored the environment file from backup ${folder} - a restart is needed for it to take effect. ENCRYPTION_SECRET and ACCESS_TOKEN_SECRET are never in a backup and must already be set on this host.`);
    return { restored: true, restartRequired: true, folder };
  }

  static async restoreFormsAndFolder(restoreFolder) {
    logger.info(`Restoring config/yaml files and forms folder from ${restoreFolder}`)
    
    // Restore config.yaml (new structure)
    const configFile = appConfig.configPath;
    const configYamlBackup = path.join(restoreFolder, path.basename(configFile));
    await copyFileIfExists(configYamlBackup, configFile);
    
    // Restore forms directory
    const formsDir = appConfig.formsFolderPath;
    const formsDirBackup = path.join(restoreFolder, 'forms');
    await copyDir(formsDirBackup, formsDir);
  }


  // The configured commands are shell strings and may be wrappers (for example
  // 'docker exec <container> mysqldump'), so the executable to look for is the
  // first token. Checking up front turns the single most common failure - the
  // client tools simply not being installed - into a message that says what to do.
  static async assertToolAvailable(commandString, envVar) {
    const binary = String(commandString || '').trim().split(/\s+/)[0];
    if (!binary) throw new Error(`No command configured, set ${envVar}`);
    try {
      await Cmd.executeSilentCommand({
        command: `command -v ${binary}`,
        directory: process.cwd(),
        description: `Checking for ${binary}`
      }, true);
    } catch {
      throw new Error(`'${binary}' was not found on this system. Install the mysql/mariadb client tools, or set ${envVar} to a command that works here.`);
    }
  }

  // A failed backup must not leave a folder behind. The dump is written through a
  // shell redirect, so the .sql is created BEFORE the command runs : when the dump
  // binary is missing the command fails, the throw skips the forms copy and the
  // meta.yaml write, and what stays on disk is a folder holding a 0-byte .sql and
  // nothing else. That folder still listed as a backup, so a run that failed was
  // indistinguishable from one that worked - you would only find out while trying
  // to restore in an emergency. Everything is unwound now, and the caller gets a
  // real error instead of a phantom restore point.
  static async doBackup(description) {
    logger.info(`Running backup '${description}'`)
    const dbName = 'AnsibleForms';
    const dbHost = dbConfig.host;
    const dbUser = dbConfig.user;
    const dbPassword = dbConfig.password;
    const dbPort = dbConfig.port;
    await this.assertToolAvailable(appConfig.mysqldumpCommand, 'MYSQLDUMP_COMMAND');
    const { backupFolder, backupFile, timestamp } = this.getBackupPaths();
    // The timestamp has one-second granularity, so two backups started in the same
    // second resolve to the same folder. That matters because the failure path below
    // removes the folder recursively : without this check a failing run could delete a
    // perfectly good backup somebody else had just written (a double-clicked button, or
    // a manual backup colliding with the 00:00:00 nightly). Refuse instead - the caller
    // can retry a second later.
    var alreadyThere = false;
    try {
      await fs.stat(backupFolder);
      alreadyThere = true;
    } catch {
      // ENOENT is the normal case
    }
    if (alreadyThere) {
      throw new Error(`A backup folder for ${timestamp} already exists, try again`);
    }
    await fs.mkdir(backupFolder, { recursive: true });
    try {
      const dumpCmd = `${appConfig.mysqldumpCommand} -h ${shQuote(dbHost)} -u${shQuote(dbUser)} -p${shQuote(dbPassword)} -P ${shQuote(dbPort)} ${RUNTIME_TABLES} ${shQuote(dbName)} > "${backupFile}"`;
      const cmdObj = {
        command: dumpCmd,
        directory: process.cwd(),
        description: `Database backup to ${backupFile}`,
        maskedCommand: `${appConfig.mysqldumpCommand} -h ${shQuote(dbHost)} -u${shQuote(dbUser)} -p'*****' -P ${shQuote(dbPort)} ${RUNTIME_TABLES} ${shQuote(dbName)} > "${backupFile}"`
      };
      // explicit timeout : the default is 60s, which no real database can dump in
      await Cmd.executeSilentCommand(cmdObj, true, false, appConfig.backupCommandTimeoutSeconds);
      // a dump can exit 0 and still have written nothing worth restoring
      if (await getFileSize(backupFile) === 0) {
        throw new Error(`The database dump is empty, '${backupFile}' was not written`);
      }
      await this.backupFormsAndFolder(backupFolder);
      const meta = { description: description || '' };
      await fs.writeFile(path.join(backupFolder, 'meta.yaml'), yaml.stringify(meta), 'utf8');
      return { backupFolder, backupFile, timestamp, description: meta.description };
    } catch (err) {
      logger.error(`Backup failed, removing the incomplete folder '${backupFolder}' : ${err.message || err}`);
      await fs.rm(backupFolder, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  static async restore(folder, backupFirst = false) {
    logger.info(`Running restore from '${folder}'`)
    const dbName = 'AnsibleForms';
    const dbHost = dbConfig.host;
    const dbUser = dbConfig.user;
    const dbPassword = dbConfig.password;
    const dbPort = dbConfig.port;
    if (!folder || !/^\d{14}$/.test(folder)) throw new Errors.BadRequestError('Invalid or missing backup folder');
    await this.assertToolAvailable(appConfig.mysqlCommand, 'MYSQL_COMMAND');
    // a failing pre-restore backup aborts the restore : it throws out of here, which
    // is the point - never overwrite the database without the safety net that was
    // explicitly asked for
    if (backupFirst) {
      await this.doBackup(`Auto backup before restore of ${folder}`);
    }
    const restoreFolder = path.join(appConfig.backupPath, folder);
    let stat;
    try {
      stat = await fs.stat(restoreFolder);
    } catch {
      throw new Errors.NotFoundError('Backup folder not found');
    }
    if (!stat.isDirectory()) throw new Errors.NotFoundError('Backup folder not found');
    const backupFile = path.join(restoreFolder, 'ansibleforms.sql');
    // Refuse a folder that is not actually a restore point. Replaying an empty dump
    // is a no-op that still reported 'Restore completed', so a broken backup looked
    // like a successful restore - the worst possible moment to be told a comforting
    // lie. See describeBackup for what makes a backup valid.
    const backupFileSize = await getFileSize(backupFile);
    if (backupFileSize === 0) {
      throw new Errors.BadRequestError(`Backup '${folder}' has no usable database dump (ansibleforms.sql is missing or empty), so there is nothing to restore. The backup that created it most likely failed.`);
    }
    const restoreCmd = `${appConfig.mysqlCommand} -h ${shQuote(dbHost)} -u${shQuote(dbUser)} -p${shQuote(dbPassword)} -P ${shQuote(dbPort)} ${shQuote(dbName)} < "${backupFile}"`;
    const cmdObj = {
      command: restoreCmd,
      directory: process.cwd(),
      description: `Database restore from ${backupFile}`,
      maskedCommand: `${appConfig.mysqlCommand} -h ${shQuote(dbHost)} -u${shQuote(dbUser)} -p'*****' -P ${shQuote(dbPort)} ${shQuote(dbName)} < "${backupFile}"`
    };
    // The one place a timeout is destructive rather than merely annoying: this replays a
    // dump that DROPs and CREATEs each table in turn, so being killed part way leaves some
    // tables restored, some dropped and not recreated, and some still holding the old
    // data. It ran on the 60 second default, which any real database exceeds.
    try {
      await Cmd.executeSilentCommand(cmdObj, true, false, appConfig.backupCommandTimeoutSeconds);
    } catch (err) {
      // say what state the database is in - there is no rollback, and "the command timed
      // out" on its own does not tell the operator their database is half replayed
      logger.error(`Restore from '${folder}' failed : ${err.message || err}`);
      throw new Error(
        `Restore from '${folder}' failed part way through: ${err.message || err}. ` +
        `The database may be partially restored - some tables replayed, others not. ` +
        `Re-run the restore once the cause is fixed, or raise BACKUP_COMMAND_TIMEOUT_SECONDS ` +
        `(currently ${appConfig.backupCommandTimeoutSeconds}s) if the dump is large.`,
        { cause: err }
      );
    }
    await this.restoreFormsAndFolder(restoreFolder);
    // every process drops what it had cached of the replaced rows (lib/epochs.js)
    bump('restore');
    return { message: 'Restore completed', restoreFolder };
  }

  static async listBackups() {
    await fs.mkdir(appConfig.backupPath, { recursive: true });
    const folders = (await fs.readdir(appConfig.backupPath)).filter(f => /^\d{14}$/.test(f));
    folders.sort((a, b) => b.localeCompare(a));
    return await Promise.all(folders.map(folder => describeBackup(folder)));
  }

  static async deleteBackup(folder) {
  if (!folder || !/^\d{14}$/.test(folder)) throw new Errors.BadRequestError('Invalid or missing folder parameter');
    const backupFolder = path.join(appConfig.backupPath, folder);
    await fs.rm(backupFolder, { recursive: true, force: true });
    return { message: 'Backup deleted', folder };
  }

  static async getBackupByFolder(folder) {
    if (!folder || !/^\d{14}$/.test(folder)) throw new Errors.BadRequestError('Invalid or missing backup folder');
    const backupFolder = path.join(appConfig.backupPath, folder);
    let stat;
    try {
      stat = await fs.stat(backupFolder);
    } catch {
      throw new Errors.NotFoundError('Backup folder not found');
    }
    if (!stat.isDirectory()) throw new Errors.NotFoundError('Backup folder not found');
    return await describeBackup(folder);
  }
}

export default BackupModel;
