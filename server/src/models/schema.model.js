// PATCHING : Drop a table from the schema
function dropTable(table) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SHOW TABLES FROM ?? WHERE ?? = ?";
  var sql = "DROP TABLE IF EXISTS ??.??";
  logger.debug(`dropping table '${table}'`);
  return mysql
    .do(checksql, [db, `Tables_in_${db}`, table])
    .then((checkres) => {
      if (checkres.length > 0) {
        return mysql.do(sql, [db, table]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Table '${table}' is already absent`;
        logger.debug(message);
        return message;
      }
      message = `Dropped table '${table}'`;
      logger.warning(message);
      return message;
    });
}
"use strict";
import logger from "../lib/logger.js";
import mysql from "./db.model.js";
import appConfig from "../../config/app.config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import init from "../init/index.js";
import { holdsWorkerLock } from "../lib/workerLock.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//user object create
class Schema {
  constructor() { }

  /**
   * Cached result of the first successful schema check.
   * Schema/table existence is essentially static at runtime — once the
   * server has confirmed everything is present at boot, every subsequent
   * call (e.g. the public schema endpoint that the SPA hits on every page
   * load / hard refresh) should NOT re-run a flood of SHOW DATABASES /
   * SHOW TABLES queries (with debug logging) for no reason. We cache the
   * first OK result and return it directly. Failures are never cached.
   */
  static _cachedOk = null;

  // Checks the schema, and patches it - but only in the process holding the worker lock : any
  // other (an app node, or a second AF_ROLE unset process waiting for the lock) only checks, so
  // it never runs DDL next to the worker patching the same tables.
  static async hasSchema() {
    if (Schema._cachedOk) return Schema._cachedOk;
    const result = await checkAll({ patch: holdsWorkerLock() });
    Schema._cachedOk = result;
    return result;
  }

  /**
   * Whether this database holds anything worth protecting : the schema exists,
   * the users table exists, and it holds at least one account. Until all three
   * are true there is simply nobody to authenticate as, which is what lets the
   * documented bootstrap (POST /api/v2/schema against an empty database) run
   * unauthenticated - see the guard in routes/v2/schema.routes.js.
   *
   * The empty-users case is a genuinely broken install : create_schema_and_tables
   * ran but init() never got to seed the admin. It is self-healing, because init
   * re-creates the admin user on every boot when it is missing, so it can not
   * stay open across a restart.
   *
   * Deliberately NOT cached (unlike hasSchema) : it flips exactly once, at the
   * end of that bootstrap, and a wrong cached 'false' would keep a destructive
   * endpoint open. Three cheap statements, on one endpoint.
   */
  static async isProvisioned() {
    const db = "AnsibleForms";
    const schema = await mysql.do("SHOW DATABASES LIKE ?", [db]);
    if (!schema || schema.length === 0) return false;
    const table = await mysql.do("SHOW TABLES FROM ?? WHERE ?? = ?", [db, `Tables_in_${db}`, "users"]);
    if (table.length === 0) return false;
    const count = await mysql.do("SELECT COUNT(*) AS total FROM ??.??", [db, "users"]);
    return (count[0]?.total || 0) > 0;
  }
  /**
   * Whether this database has no AnsibleForms tables at all : the schema is absent,
   * or it exists and is completely empty.
   *
   * This is the ONLY safe precondition for running create_schema_and_tables.sql
   * unattended, because that file DROPs all 16 tables before recreating them.
   *
   * It is deliberately much stricter than isProvisioned(), which answers a different
   * question ("is there anybody to authenticate as?") and returns false for a database
   * that is full of forms, jobs and audit history but happens to have an empty users
   * table. hasSchema() is stricter still in the wrong direction : it fails for a single
   * missing column or a patch that could not apply. Driving an automatic create from
   * either of those would destroy a live database to fix a cosmetic gap - so the
   * startup bootstrap asks this, and only this.
   */
  static async isEmpty() {
    const db = "AnsibleForms";
    const schema = await mysql.do("SHOW DATABASES LIKE ?", [db]);
    if (!schema || schema.length === 0) return true;
    const tables = await mysql.do("SHOW TABLES FROM ??", [db]);
    return !tables || tables.length === 0;
  }

  /**
   * Runs create_schema_and_tables.sql. DESTRUCTIVE : every table is dropped first.
   * Callers are responsible for establishing that this is allowed - the endpoint
   * checks isProvisioned(), the startup bootstrap checks isEmpty().
   */
  // `onlyIf` is checked again once the lock is held : the startup bootstrap creates only an
  // empty database, and another process may have created it while this one waited.
  static async createTables({ onlyIf } = {}) {
    if (!appConfig.allowSchemaCreation) {
      throw new Error(`Schema creation is disabled`);
    }
    // two processes never run the script at the same time : it drops every table first,
    // so the second would wipe what the first had just created
    return mysql.withLock("ansibleforms_schema", 120, async () => {
      if (onlyIf && !(await onlyIf())) return false;
      return Schema.runCreateScript();
    });
  }

  static async runCreateScript() {
    // added in 5.0.3
    const buffer = fs.readFileSync(`${__dirname}/../db/create_schema_and_tables.sql`);
    const query = buffer.toString();
    // Invalidate BEFORE running, not after. This file drops tables first, so a failure
    // part way through leaves the schema genuinely incomplete - and the throw used to
    // skip the invalidation, leaving an earlier cached "everything is present" live.
    // GET /api/v2/schema then kept reporting a healthy schema for a database that had
    // just lost tables, so nothing ever offered the repair.
    Schema._cachedOk = null;
    // runIsolated, not do() : this script disables FOREIGN_KEY_CHECKS and selects a
    // default schema, and a failure must not hand that session back to the pool.
    const res = await mysql.runIsolated(query);
    if (!res || res.length === 0) {
      throw new Error(`Failed to create schema 'AnsibleForms' and/or tables`);
    }
    logger.notice(`Created schema 'AnsibleForms' and tables`);
    return true;
  }

  static async create() {
    logger.notice(`Trying to create database schema 'AnsibleForms' and tables`);
    await Schema.createTables();
    // the bootstrap that follows (the admin account, the default rows, the seed) is the
    // worker's : run here when this process is the worker, otherwise the worker finds the
    // new schema on its next check (init/worker.js)
    if (holdsWorkerLock()) await init()
    return { message: `Created schema 'AnsibleForms' and tables` };
  }
}

// Check if the AnsibleForms schema exists
async function checkSchema() {
  var message;
  var db = "AnsibleForms";
  logger.debug("checking schema " + db);
  var res = await mysql.do("SHOW DATABASES LIKE ?", [db]);
  if (res) {
    if (res.length > 0) {
      message = `Schema '${db}' is present`;
      logger.debug(message);
      return message;
    } else {
      message = `Schema '${db}' is not present`;
      logger.warning(message);
      var err = new Error(message);
      err.result = { message: [message], data: { success: [], failed: [message] } };
      throw err;
    }
  }
}

// Check if a table exists
async function checkTable(table) {
  var message;
  var db = "AnsibleForms";
  logger.debug("checking table " + table);
  var sql = "SHOW TABLES FROM ?? WHERE ?? = ?";
  var res = await mysql.do(sql, [db, `Tables_in_${db}`, table]);

  if (res.length > 0) {
    message = `Table '${table}' is present`;
    logger.debug(message);
    return message;
  } else {
    message = `Table '${table}' is not present`;
    logger.warning(message);
    throw new Error(message);
  }
}
// PATCHING : whether a table exists (the awx table is gone once 7 moved it to runners)
async function tablePresent(table) {
  const res = await mysql.do("SHOW TABLES FROM ?? WHERE ?? = ?", ["AnsibleForms", "Tables_in_AnsibleForms", table]);
  return res.length > 0;
}
function addIdPrimaryKey(table) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SHOW COLUMNS FROM ??.?? WHERE Field = ?";
  var sql = "ALTER TABLE ??.?? ADD COLUMN id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY";
  logger.debug(`adding id primary key column on table '${table}'`);
  return mysql
    .do(checksql, [db, table, 'id'])
    .then((checkres) => {
      if (checkres.length == 0) {
        return mysql.do(sql, [db, table]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Column 'id' is already present on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `added id primary key column on '${table}'`;
      logger.warning(message);
      return message;
    });
}

function addUniqueKey(table, column) {
  var message;
  var db = "AnsibleForms";
  var indexName = `unique_${column}`;
  var checksql = "SHOW INDEX FROM ??.?? WHERE Key_name = ?";
  var sql = "ALTER TABLE ??.?? ADD UNIQUE KEY ?? (??)";
  logger.debug(`adding unique key '${indexName}' on column '${column}' in table '${table}'`);
  return mysql
    .do(checksql, [db, table, indexName])
    .then((checkres) => {
      if (checkres.length == 0) {
        return mysql.do(sql, [db, table, indexName, column]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Unique key '${indexName}' is already present on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `added unique key '${indexName}' on '${table}'`;
      logger.warning(message);
      return message;
    });
}
// PATCHING : add a column to a table
function addColumn(table, name, fieldtype, nullable, defaultvalue) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SHOW COLUMNS FROM ??.?? WHERE Field = ?";
  var sql = `ALTER TABLE ??.?? ADD COLUMN ?? ${fieldtype}`;
  if (!nullable) {
    sql += " NOT NULL";
  }
  if (defaultvalue) {
    sql += ` DEFAULT ${defaultvalue}`;
  }
  logger.debug(`adding column '${name}' on table '${table}'`);
  return mysql
    .do(checksql, [db, table, name])
    .then((checkres) => {
      if (checkres.length == 0) {
        return mysql.do(sql, [db, table, name]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Column '${name}' is already present on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `added column '${name}' on '${table}'`;
      logger.warning(message);
      return message;
    });
}


// PATCHING : Add a table to the schema
// Add an index when it is not already there. SHOW INDEX is the cheap existence check ;
// ALTER TABLE ADD KEY has no IF NOT EXISTS in mysql.
function addIndex(table, indexName, columns) {
  var message;
  var db = "AnsibleForms";
  logger.debug(`adding index '${indexName}' on '${table}'`);
  return mysql
    .do("SHOW INDEX FROM ??.?? WHERE Key_name = ?", [db, table, indexName])
    .then((checkres) => {
      if (checkres.length > 0) {
        message = `Index '${indexName}' is already present on '${table}'`;
        logger.debug(message);
        return message;
      }
      const cols = columns.map(() => "??").join(",");
      return mysql
        .do(`ALTER TABLE ??.?? ADD KEY ?? (${cols})`, [db, table, indexName, ...columns])
        .then(() => {
          message = `added index '${indexName}' on '${table}'`;
          logger.warning(message);
          return message;
        });
    });
}

function addTable(table, sql) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SHOW TABLES FROM ?? WHERE ?? = ?";
  logger.debug(`adding table '${table}'`);
  return mysql
    .do(checksql, [db, `Tables_in_${db}`, table])
    .then((checkres) => {
      if (checkres.length == 0) {
        return mysql.do(sql);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Table '${table}' is already present`;
        logger.debug(message);
        return message;
      }
      message = `added table '${table}'`;
      logger.warning(message);
      return message;
    });
}

// PATCHING : Set the charset of a column to utf8mb4
function setUtf8mb4CharacterSet(table, name, fieldtype) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? AND character_set_name = 'utf8mb4'";
  var sql = `ALTER TABLE ??.?? MODIFY ?? ${fieldtype} character set utf8mb4 collate utf8mb4_unicode_ci`;
  logger.debug(`set charset column '${name}'->'utf8mb4' on table '${table}'`);
  return mysql
    .do(checksql, [db, table, name])
    .then((checkres) => {
      if (checkres.length == 0) {
        return mysql.do(sql, [db, table, name]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Column '${name}' has already charset 'utf8mb4' on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `Changed charset to 'utf8mb4' on column '${name}' on '${table}'`;
      logger.warning(message);
      return message;
    });
}

// PATCHING : Make a column nullable (drop NOT NULL constraint)
function makeColumnNullable(table, name, fieldtype) {
  var message;
  var db = "AnsibleForms";
  var checksql = "SELECT IS_NULLABLE FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?";
  var sql = `ALTER TABLE ??.?? MODIFY ?? ${fieldtype} NULL`;
  logger.debug(`make column '${name}' nullable on table '${table}'`);
  return mysql
    .do(checksql, [db, table, name])
    .then((checkres) => {
      if (checkres.length > 0 && checkres[0].IS_NULLABLE !== "YES") {
        return mysql.do(sql, [db, table, name]);
      }
      return false;
    })
    .then((res) => {
      if (!res) {
        message = `Column '${name}' is already nullable on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `Made column '${name}' nullable on '${table}'`;
      logger.warning(message);
      return message;
    });
}

// PATCHING : one-time cleanup of the removed LDAP is_advanced toggle
// The is_advanced toggle was dropped from the UI ; the four group columns
// (groups_search_base, group_class, group_member_attribute,
// group_member_user_attribute) are now always applied when non-empty. On
// installs where the toggle was OFF these may hold stale values that would
// suddenly take effect, so drop the toggle column and blank them once. This is
// gated on the is_advanced column still existing, which makes it strictly
// one-time : after the drop it never runs again (so it can't wipe values a user
// later enters through the new UI).
function clearStaleLdapAdvancedGroupFields() {
  var message;
  var db = "AnsibleForms";
  var table = "ldap";
  var advancedFields = ["groups_search_base", "group_class", "group_member_attribute", "group_member_user_attribute"];
  var clearsql = "SET groups_search_base = '', group_class = '', group_member_attribute = '', group_member_user_attribute = ''";
  var checksql = "SHOW COLUMNS FROM ??.?? WHERE Field = ?";
  var countsql = "SELECT COUNT(*) AS total FROM ??.??";
  var selectsql = "SELECT groups_search_base, group_class, group_member_attribute, group_member_user_attribute FROM ??.?? WHERE is_advanced = 0 OR is_advanced IS NULL";
  var updateallsql = `UPDATE ??.?? ${clearsql}`;
  // the ldap table has no key (it is single-row by design), so a subset of rows can
  // only be addressed by the values snapshotted before the drop ; NULL never
  // matches in a comparison, hence the COALESCE on both sides
  var updatesomesql = `UPDATE ??.?? ${clearsql} WHERE (COALESCE(groups_search_base,''), COALESCE(group_class,''), COALESCE(group_member_attribute,''), COALESCE(group_member_user_attribute,'')) IN (?)`;
  // The "already done" marker, written in the same transaction as the blanking so the
  // two can never disagree. See the long comment below the snapshot.
  var marksql = "UPDATE ??.?? SET is_advanced = 1";
  var dropsql = "ALTER TABLE ??.?? DROP COLUMN is_advanced";
  logger.debug(`cleaning up stale ldap advanced group fields`);
  return mysql
    .do(checksql, [db, table, 'is_advanced'])
    .then(async (checkres) => {
      if (checkres.length == 0) {
        return false;
      }
      // Snapshot the rows to blank while the toggle column still exists.
      var stale = await mysql.do(selectsql, [db, table]);
      var total = (await mysql.do(countsql, [db, table]))[0].total;
      // only the rows that actually carry a value need blanking. On a retry (see
      // below) they are already empty, so there is nothing left to clear and the
      // update is skipped entirely.
      var dirty = stale.filter((row) => advancedFields.some((f) => row[f] !== null && row[f] !== ""));
      // Blank, and mark as done, in ONE transaction. Then drop, separately.
      //
      // The blanking has to be the undoable half, so it comes first : a failing UPDATE
      // rolls itself back and the next boot retries from a clean state. MySQL implicitly
      // commits before DDL and cannot roll a DDL back, so the DROP cannot be part of it.
      //
      // But keying "have I run?" on the column the DROP removes is not enough. A DROP
      // that fails (no ALTER grant - which does not stop the app, see init) used to leave
      // the values blanked AND the gate in place, so this ran again on every call. That is
      // not harmless: GET /api/v2/schema is public and re-runs patchAll while patching is
      // failing, so an admin who re-entered those four fields had them wiped again, over
      // and over. Hence the marker: setting is_advanced = 1 makes the snapshot query
      // (is_advanced = 0 OR NULL) match nothing next time, so the blanking is one-time
      // whether or not the column ever goes away. Nothing reads is_advanced any more, and
      // 1 is the truthful value - after 6.3.0 those fields are always applied.
      await mysql.transaction(async (query) => {
        if (dirty.length > 0) {
          // log the non-empty values at warning level BEFORE clearing them : this is the
          // only recovery trail for exactly what was cleared.
          dirty.forEach((row) => {
            var nonEmpty = advancedFields.filter((f) => row[f] !== null && row[f] !== "");
            logger.warning(`clearing stale ldap advanced group fields : ` + nonEmpty.map((f) => `${f}='${row[f]}'`).join(", "));
          });
          if (stale.length == total) {
            await query(updateallsql, [db, table]);
          } else {
            await query(updatesomesql, [db, table, dirty.map((row) => advancedFields.map((f) => row[f] || ""))]);
          }
        }
        await query(marksql, [db, table]);
      });
      // Separate from the transaction above, because a DDL failure must not be able to
      // look like the blanking never happened.
      await mysql.do(dropsql, [db, table]);
      return true;
    })
    .then((res) => {
      if (!res) {
        message = `Column 'is_advanced' is already absent on '${table}'`;
        logger.debug(message);
        return message;
      }
      message = `cleared stale advanced group fields and dropped 'is_advanced' on '${table}'`;
      logger.warning(message);
      return message;
    });
}

// What a fully patched schema looks like, mapped back to the patch that creates each item.
//
// This lives HERE, beside the patches, for the same reason the fresh-install SQL and the
// patches have to stay in sync: adding a patch means adding one line below, in the file you
// are already editing. Put it in health.model.js and it drifts the first time somebody adds
// a column without thinking about the health page.
//
// It exists because there is NO version table. Patches are idempotent and re-run on every
// boot, so nothing records where a database actually got to - a patch that fails leaves a
// half-migrated schema, one line in the startup log, and no way to ask about it afterwards.
//
// `audit` is included deliberately. The pre-patch `checkTables` excludes it, because that
// runs BEFORE patching and would otherwise block the very patch that creates it; this
// manifest is consumed after patching, so it must expect it.
const SCHEMA_MANIFEST = {
  // tables the fresh install creates, so they must exist however the database was built
  base: {
    tables: ['groups', 'users', 'tokens', 'credentials', 'ldap', 'jobs', 'job_output',
             'settings', 'repositories', 'schedule', 'audit', 'chat_settings', 'secret_stores', 'runners',
             'nodes', 'cache_epochs', 'designer_lock', 'user_groups'],
  },
  patches: {
    patchVersion4: { columns: ['ldap.groups_search_base', 'ldap.groups_attribute', 'ldap.group_class',
                               'ldap.group_member_attribute', 'ldap.group_member_user_attribute', 'ldap.mail_attribute'] },
    // NOT azuread / oidc : patchVersion5 still creates them for historical upgrades, but
    // they are superseded by `oauth2_providers` (azureAd.model and oidc.model both query
    // that table with a provider filter) and the fresh install does not create them. Every
    // table a patch ever made is NOT the same as the expected schema - listing them here
    // made this check report a false error on a perfectly healthy database.
    patchVersion5: { tables: ['repositories', 'schedule'],
                     // not azuread.groupfilter : its patch is commented out below, and an app node
                     // waits for every column listed here (app-start.js)
                     columns: ['users.email', 'jobs.awx_id',
                               'settings.forms_yaml', 'repositories.branch', 'jobs.awx_artifacts',
                               'jobs.abort_requested'] },
    // One entry per patch function, and there is one patch function per MAJOR version -
    // so everything 6.x adds is listed here, including all of 6.3.0. `indexes` is a
    // separate list from `columns` because the caller grades a missing index lower :
    // its absence is slow rather than broken.
    patchVersion6: { tables: ['oauth2_providers', 'stored_jobs',
                              'audit', 'chat_settings'],
                     columns: ['oauth2_providers.tenant_id', 'jobs.raw_form_data', 'repositories.use_for_config',
                               'repositories.use_for_vars_files', 'jobs.pid', 'jobs.host', 'schedule.one_time_run',
                               'schedule.run_at', 'credentials.vault_path', 'jobs.awx_workflow', 'settings.logo',
                               'settings.config_source', 'settings.default_language',
                               'settings.default_theme', 'settings.default_theme_color',
                               'credentials.managed', 'oauth2_providers.managed',
                               'repositories.managed', 'ldap.managed', 'settings.managed',
                               'ldap.groupfilter', 'chat_settings.auth_type', 'chat_settings.api_version',
                               'chat_settings.request_user', 'chat_settings.extra_headers',
                               'chat_settings.ignore_certs'],
                     indexes: ['jobs.idx_jobs_retention'] },
    // 7 : runners - AWX connections are runners of type awx (the awx table is copied, then
    // dropped), and the job log a playbook writes is stored on the job
    // and the worker and several app nodes : the processes on the database, what changed
    // between them, the designer lock, and the node that follows a job
    patchVersion7: { tables: ['secret_stores', 'runners', 'nodes', 'cache_epochs', 'designer_lock', 'user_groups'],
                     columns: ['schedule.owner', 'credentials.secret_store', 'credentials.secret_ref', 'settings.vault_env_imported_at', 'jobs.runner',
                               'runners.username', 'runners.password', 'runners.use_credentials', 'runners.node_id', 'jobs.job_log',
                               'jobs.tracker', 'repositories.claim_node', 'repositories.claim_since',
                               'schedule.claim_node', 'schedule.claim_since', 'runners.flavour',
                               'credentials.credential_type', 'repositories.credential', 'groups.description',
                               'secret_stores.credential', 'credentials.client_cert', 'credentials.client_key',
                               'users.description'] },
  },
};

async function patchVersion4(messages, success, failed) {
  var buffer;
  var sql;

  // patches to db for v4.x.x
  // Before version 4.0.0, the schema was not utf8mb4, so we need to change the charset of some columns, due to some emoticons or utf16 characters
  // Also the ldap was enhanced for openLDAP and required some additional columns
  await checkPromise(setUtf8mb4CharacterSet("jobs", "extravars", "longtext"), messages, success, failed); // allow emoticon or utf16 character
  await checkPromise(setUtf8mb4CharacterSet("jobs", "notifications", "longtext"), messages, success, failed); // allow emoticon or utf16 character
  await checkPromise(setUtf8mb4CharacterSet("jobs", "approval", "longtext"), messages, success, failed); // allow emoticon or utf16 character
  await checkPromise(setUtf8mb4CharacterSet("job_output", "output", "longtext"), messages, success, failed); // allow emoticon or utf16 character
  await checkPromise(addColumn("ldap", "groups_search_base", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have groups search base
  await checkPromise(addColumn("ldap", "groups_attribute", "varchar(250)", false, "'memberOf'"), messages, success, failed); // add column to have groups attribute
  await checkPromise(addColumn("ldap", "group_class", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have group class
  await checkPromise(addColumn("ldap", "group_member_attribute", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have group member attribute
  await checkPromise(addColumn("ldap", "group_member_user_attribute", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have group member user attribute
  // NOTE: the is_advanced toggle column is intentionally NOT (re)created here.
  // It was removed from the UI and patchVersion6 does a one-time cleanup that
  // blanks the stale advanced group fields and drops this column. Re-adding it
  // here would let that cleanup re-run on the next boot and wipe group fields an
  // admin has since configured through the new UI (see clearStaleLdapAdvancedGroupFields).
  await checkPromise(addColumn("ldap", "mail_attribute", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have mail attribute
  // also the settings tables was not present before 4.0.0, it contains the URL and mail settings for notification
  // later the column forms_yaml was added to store the forms in yaml format (but that was in 5.x.x)
  buffer = fs.readFileSync(`${__dirname}/../db/create_settings_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("settings", sql), messages, success, failed); // add settings table
}

// PATCHING : version 5
async function patchVersion5(messages, success, failed) {
  var buffer;
  var sql;

  // patches to db for v5.x.x
  // Before version 5, the users didn't have an email.  The was on request
  // AF passes the user object and the email address can then be used in ansible for notifications
  await checkPromise(addColumn("users", "email", "varchar(250)", true, "NULL"), messages, success, failed); // add column to have email

  // // Azure AD integration was added in 5.0.0, so we need to add the table and columns
  // buffer = fs.readFileSync(`${__dirname}/../db/create_azuread_table.sql`);
  // sql = buffer.toString();
  // await checkPromise(addTable("azuread", sql), messages, success, failed); // add azuread table

  // // A bit later, the groupfilter was added to limit the groups that can be used in AF, because the list can be very long and that's part of the JWT token
  // // which introduced a limit
  // await checkPromise(addColumn("azuread", "groupfilter", "varchar(250)", true, "NULL"), messages, success, failed); // add column to limit azuread groups

  // on request, the awx_id was added to the jobs table, to later retrieve it for future tracking
  await checkPromise(addColumn("jobs", "awx_id", "int(11)", true, "NULL"), messages, success, failed); // add for future tracking

  // patch for awx credentials, the use_credentials was added to the awx table, to allow the use of credentials
  // (only while the awx table exists : 7 moves it to runners, see patchVersion7)
  if (await tablePresent("awx")) {
    await checkPromise(addColumn("awx", "use_credentials", "tinyint(4)", true, "0"), messages, success, failed); // bugfix for awx credentials
  }

  // A new feature was added, the repositories table, to store the repositories for the forms and playbooks
  // A real gamechanger, because now the forms and playbooks can be stored in a git repository
  buffer = fs.readFileSync(`${__dirname}/../db/create_repositories_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("repositories", sql), messages, success, failed); // add repositories table

  // // In a first pull requests, mdaug was so kind to contribute the oidc table, to have OpenID Connect integration
  // buffer = fs.readFileSync(`${__dirname}/../db/create_oidc_table.sql`);
  // sql = buffer.toString();
  // await checkPromise(addTable("oidc", sql), messages, success, failed); // add oidc table

  // In 5.0.3, the settings was extended with a new column, forms_yaml, to store the forms in yaml format
  // If you use GIT to store the forms, but not the master forms.yaml, you can now store it in the database

  await checkPromise(addColumn("settings", "forms_yaml", "longtext", true, "NULL"), messages, success, failed); // add forms_yaml column
  await checkPromise(setUtf8mb4CharacterSet("settings", "forms_yaml", "longtext"), messages, success, failed); // allow emoticon or utf16 characters

  // In 5.0.8, the repositories table was extended with a new column, branch, to store the branch of the repository
  await checkPromise(addColumn("repositories", "branch", "varchar(250)", true, "NULL"), messages, success, failed); // add branch column

  // In 5.0.9, We add a scheduler
  buffer = fs.readFileSync(`${__dirname}/../db/create_schedule_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("schedule", sql), messages, success, failed); // add schedule table

  // In 5.0.10, we add a new column to the jobs table, to store the awx artifacts
  await checkPromise(addColumn("jobs", "awx_artifacts", "longtext", true, "NULL"), messages, success, failed); // add awx_artifacts column

  // In 5.1.0, add abort_requested bit to jobs table, default 0
  await checkPromise(addColumn("jobs", "abort_requested", "tinyint(4)", true, "NULL"), messages, success, failed); // add abort_requested column

  // In 6.0.0, we allow multiple awx instances, so we need to add id, name and description to the awx table
  // (only while the awx table exists : 7 moves it to runners, see patchVersion7)
  if (await tablePresent("awx")) {
    await checkPromise(addIdPrimaryKey("awx"), messages, success, failed); // add id column with auto_increment primary key
    await checkPromise(addColumn("awx", "name", "varchar(250)", true, "NULL"), messages, success, failed); // add name column
    await checkPromise(addUniqueKey("awx", "name"), messages, success, failed); // make name unique
    await checkPromise(addColumn("awx", "description", "varchar(250)", true, "NULL"), messages, success, failed); // add description column
    await checkPromise(addColumn("awx", "is_default", "tinyint(4)", true, "0"), messages, success, failed); // add is_default column
  }
}

// Patches for v6 
// In 6.0.0 we add oauth2 providers table
async function patchVersion6(messages, success, failed) {
  var buffer;
  var sql;

  // The datasource tables (datasource_schemas, datasource, staging) were created here until
  // 7.0.0 removed datasources ; patchVersion7 drops them.

  // In 6.0.0, we add oauth2 providers table
  buffer = fs.readFileSync(`${__dirname}/../db/create_oauth2_providers_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("oauth2_providers", sql), messages, success, failed);
  await checkPromise(addColumn("oauth2_providers", "tenant_id", "TEXT", true, "NULL"), messages, success, failed);
  
  // Add raw_form_data column to jobs table for job relaunch feature
  await checkPromise(addColumn("jobs", "raw_form_data", "longtext", true, "NULL"), messages, success, failed);
  
  // --- AzureAD migration to oauth2_providers ---
  // Check if azuread table exists
  try {
    // AzureAD migration
    const azureadTableCheck = await mysql.do("SHOW TABLES FROM AnsibleForms WHERE Tables_in_AnsibleForms = 'azuread'");
    if (azureadTableCheck.length > 0) {
      // Table exists, migrate record(s) from azuread to oauth2_providers if client_id is not empty
      const insertSql = `
        INSERT INTO AnsibleForms.oauth2_providers (name, provider, client_id, client_secret, groupfilter, enable)
        SELECT 'EntraID', 'azuread', client_id, secret_id, groupfilter, enable
        FROM AnsibleForms.azuread
        WHERE client_id IS NOT NULL AND client_id != ''
      `;
      await mysql.do(insertSql)
    }

    // OIDC migration
    const oidcTableCheck = await mysql.do("SHOW TABLES FROM AnsibleForms WHERE Tables_in_AnsibleForms = 'oidc'");
    if (oidcTableCheck.length > 0) {
      // Table exists, migrate record(s) from oidc to oauth2_providers if client_id is not empty
      const insertOidcSql = `
        INSERT INTO AnsibleForms.oauth2_providers (name, provider, client_id, client_secret, groupfilter, enable, issuer)
        SELECT 'OpenID', 'oidc', client_id, secret_id, groupfilter, enabled, issuer
        FROM AnsibleForms.oidc
        WHERE client_id IS NOT NULL AND client_id != ''
      `;
      await mysql.do(insertOidcSql)
    }
  } catch (e) {
    // messages.push("AzureAD/OIDC migration failed: " + e.message);
    // failed.push("AzureAD/OIDC migration failed: " + e.message);
  }
  // Drop the azuread table using dropTable and checkPromise
  await checkPromise(dropTable("azuread"), messages, success, failed);
  await checkPromise(dropTable("oidc"), messages, success, failed);
  
  // Add use_for_config column to repositories table (6.1.0+)
  // This allows a repository to be marked for config.yaml specifically
  await checkPromise(addColumn("repositories", "use_for_config", "tinyint(4)", true, "0"), messages, success, failed);
  
  // Add use_for_vars_files column to repositories table (6.1.0+)
  // This allows a repository to be marked for vars files specifically
  await checkPromise(addColumn("repositories", "use_for_vars_files", "tinyint(4)", true, "0"), messages, success, failed);
  
  // Add pid column to jobs table (6.1.4)
  // This stores the process ID for running jobs to allow direct process control
  await checkPromise(addColumn("jobs", "pid", "int(11)", true, "NULL"), messages, success, failed);
  
  // Add host column to jobs table (6.1.4)
  // This stores the hostname/container ID to prevent cross-instance process kills
  await checkPromise(addColumn("jobs", "host", "varchar(255)", true, "NULL"), messages, success, failed);
  
  // Add one_time_run column to schedule table (6.2.0)
  // This allows schedules to be either recurring (false) or one-time (true)
  await checkPromise(addColumn("schedule", "one_time_run", "tinyint(4)", true, "0"), messages, success, failed);
  
  // Add run_at column to schedule table (6.2.0)
  // This stores the datetime for one-time scheduled jobs
  await checkPromise(addColumn("schedule", "run_at", "datetime", true, "NULL"), messages, success, failed);
  
  // Create stored_jobs table (6.2.0)
  // This allows users to save and load form data
  buffer = fs.readFileSync(`${__dirname}/../db/create_stored_jobs_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("stored_jobs", sql), messages, success, failed);

  // Add vault_path column to credentials table (6.3.0)
  // When set, the credential's user/password are fetched from HashiCorp Vault
  // at this path instead of from the local DB columns. Non-secret connection
  // metadata (host, port, db_name, db_type, secure, is_database) stays in DB.
  await checkPromise(addColumn("credentials", "vault_path", "varchar(500)", true, "NULL"), messages, success, failed);
  // Allow user/password to be NULL for vault-backed credentials.
  await checkPromise(makeColumnNullable("credentials", "user", "varchar(250)"), messages, success, failed);
  await checkPromise(makeColumnNullable("credentials", "password", "text"), messages, success, failed);
  // `description` is optional metadata - crud.config.js does not mark it required and the
  // other description columns in this schema are already DEFAULT NULL - but these two were
  // NOT NULL with no default, so MySQL refused any insert that omitted them. An API client
  // creating a credential or a repository without one got a raw
  // "Field 'description' doesn't have a default value" 500 instead of the record it asked
  // for. (A TEXT column cannot carry a literal DEFAULT, so nullable is the fix rather than
  // DEFAULT ''.) The UI always sends the field, which is why this went unnoticed.
  await checkPromise(makeColumnNullable("credentials", "description", "text"), messages, success, failed);
  await checkPromise(makeColumnNullable("repositories", "description", "text"), messages, success, failed);

  // Add awx_workflow column to jobs table (6.3.0)
  // This stores the awx workflow nodes (name, status, relations) as json,
  // so the client can visualize the workflow graph of an awx workflow job
  await checkPromise(addColumn("jobs", "awx_workflow", "longtext", true, "NULL"), messages, success, failed);

  // Add logo column to the settings table (6.3.0)
  // This stores an optional custom logo as a base64 data url, shown in the
  // navbar instead of the default AnsibleForms logo (admin panel > logo)
  await checkPromise(addColumn("settings", "logo", "longtext", true, "NULL"), messages, success, failed);

  // --- the rest of 6.3.0 ---
  //
  // It all belongs in THIS function. The patch number is the MAJOR version, not a
  // counter : 4 is "for v4.x.x", 5 is "for v5.x.x", 6 is every 6.x, and the three
  // columns above are already labelled 6.3.0. A patchVersion7 would mean AnsibleForms
  // 7.0.0, and a function per feature invents versions that do not exist.
  //
  // Appending to a function that has already shipped is safe, and is what the entries
  // above do: patchAll runs every patch on every boot with no version bookkeeping, so
  // a new function would not be applied any differently. What makes that work is that
  // each helper is existence-checked - addColumn, addTable and addIndex all look first,
  // and the ldap cleanup no-ops once the column it keys off is gone.

  // the active config source, and the server-wide language and theme defaults
  await checkPromise(addColumn("settings", "config_source", "varchar(20)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("settings", "default_language", "varchar(5)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("settings", "default_theme", "varchar(10)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("settings", "default_theme_color", "varchar(7)", true, "NULL"), messages, success, failed);

  // one-time cleanup after removing the ldap is_advanced toggle (see the helper : it
  // snapshots, blanks and drops in one transaction, and no-ops once the column is gone)
  await checkPromise(clearStaleLdapAdvancedGroupFields(), messages, success, failed);

  // The audit trail. It is append only : nothing updates or deletes a row except the
  // retention sweep, which is why it carries no natural key and no unique constraint.
  buffer = fs.readFileSync(`${__dirname}/../db/create_audit_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("audit", sql), messages, success, failed);

  // The chat assistant's model provider : one row, its api key encrypted (6.5)
  buffer = fs.readFileSync(`${__dirname}/../db/create_chat_settings_table.sql`);
  sql = buffer.toString();
  await checkPromise(addTable("chat_settings", sql), messages, success, failed);
  // how to talk to an OpenAI-compatible provider or proxy : auth header, api version, the
  // user a proxy wants, extra headers (a table created before they existed gets them here)
  await checkPromise(addColumn("chat_settings", "auth_type", "varchar(20)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("chat_settings", "api_version", "varchar(50)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("chat_settings", "request_user", "varchar(100)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("chat_settings", "extra_headers", "text", true, "NULL"), messages, success, failed);
  // a proxy on a self-signed certificate (6.5.1)
  await checkPromise(addColumn("chat_settings", "ignore_certs", "tinyint(4)", true, "0"), messages, success, failed);

  // Job retention selects on parent_id + status + end. Without an index that is a full
  // scan of the biggest table in the schema, repeated once per batch.
  await checkPromise(addIndex("jobs", "idx_jobs_retention", ["parent_id", "status", "end"]), messages, success, failed);

  // The optional ldap group filter. Entra ID and OIDC have had one since 5.x,
  // in oauth2_providers.groupfilter ; this is the same thing for directory logins, and the
  // column is deliberately named the same. NULL / empty keeps every group, which is what
  // every existing installation has.
  await checkPromise(addColumn("ldap", "groupfilter", "varchar(250)", true, "NULL"), messages, success, failed);

  // The declarative config seed flags the objects it owns, so the API can refuse to
  // change them behind the seed's back. One column per seedable table. Default 0 :
  // everything that already exists was made by hand and stays editable.
  for (const table of ["credentials", "oauth2_providers", "repositories", "ldap", "settings"]) {
    await checkPromise(addColumn(table, "managed", "tinyint(4)", true, "0"), messages, success, failed);
  }
  // the awx table too, while it exists (7 moves it to runners, see patchVersion7)
  if (await tablePresent("awx")) {
    await checkPromise(addColumn("awx", "managed", "tinyint(4)", true, "0"), messages, success, failed);
  }

}

// Patches for v7
// 7.0.0 removed datasources : their tables go. staging first, it references datasource.
// The data schemas an import filled are separate databases of the user's own and stay.
async function patchVersion7(messages, success, failed) {
  await checkPromise(dropTable("staging"), messages, success, failed);
  await checkPromise(dropTable("datasource"), messages, success, failed);
  await checkPromise(dropTable("datasource_schemas"), messages, success, failed);

  // 7.x : secret stores (HashiCorp Vault, CyberArk, ...) and the credential columns that
  // point into one
  const buffer = fs.readFileSync(`${__dirname}/../db/create_secret_stores_table.sql`);
  await checkPromise(addTable("secret_stores", buffer.toString()), messages, success, failed);
  await checkPromise(addColumn("credentials", "secret_store", "varchar(250)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("credentials", "secret_ref", "varchar(500)", true, "NULL"), messages, success, failed);
  // a credential that read from vault through vault_path now names the store `vault`
  await checkPromise(copyVaultPathToSecretRef(), messages, success, failed);
  // when the VAULT_* variables were imported as the secret store `vault` (once, at the
  // first 7.x start that has them - secrets/importVaultEnv.js)
  await checkPromise(addColumn("settings", "vault_env_imported_at", "datetime", true, "NULL"), messages, success, failed);
  // the user a planned job ("Run later" with allowPlannedJobs) runs as - see Schedule.plan
  await checkPromise(addColumn("schedule", "owner", "longtext", true, "NULL"), messages, success, failed);

  // 7 : runners (where a playbook runs : an RTE) and the runner a job ran on
  const runners = fs.readFileSync(`${__dirname}/../db/create_runners_table.sql`);
  await checkPromise(addTable("runners", runners.toString()), messages, success, failed);
  await checkPromise(addColumn("jobs", "runner", "varchar(250)", true, "NULL"), messages, success, failed);
  // AWX/AAP/Ascender connections are runners of type awx : the awx table is copied into
  // runners once, then dropped ; the job log a playbook writes is stored on the job
  await checkPromise(addColumn("runners", "username", "varchar(250)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("runners", "password", "text", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("runners", "use_credentials", "tinyint(4)", true, "0"), messages, success, failed);
  // the RTE that registered the runner itself (rte/register.js) ; NULL when added by hand or the seed
  await checkPromise(addColumn("runners", "node_id", "varchar(250)", true, "NULL"), messages, success, failed);
  // an awx runner that is an AAP or an Ascender (empty is AWX) : which product it is
  await checkPromise(addColumn("runners", "flavour", "varchar(20)", true, "NULL"), messages, success, failed);
  // what a credential is for : ssh, git, api or database ; the existing ones from their
  // is_database flag
  await checkPromise(addColumn("credentials", "credential_type", "varchar(20)", true, "NULL"), messages, success, failed);
  await checkPromise(fillCredentialTypes(), messages, success, failed);
  // a repository can use a credential of Connections > Credentials instead of its own
  // user and password
  await checkPromise(addColumn("repositories", "credential", "varchar(250)", true, "NULL"), messages, success, failed);
  // a secret store (a Vault) can read its token from a credential of Connections > Credentials
  // instead of keeping its own
  await checkPromise(addColumn("secret_stores", "credential", "varchar(250)", true, "NULL"), messages, success, failed);
  // a cyberark credential's client certificate and key, how a CyberArk store's AppID may be
  // restricted
  await checkPromise(addColumn("credentials", "client_cert", "text", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("credentials", "client_key", "text", true, "NULL"), messages, success, failed);
  // a description on the local groups and users : what a group is for, who owns an account
  await checkPromise(addColumn("groups", "description", "varchar(250)", true, "NULL"), messages, success, failed);
  await checkPromise(addColumn("users", "description", "varchar(250)", true, "NULL"), messages, success, failed);
  await checkPromise(copyAwxToRunners(), messages, success, failed);
  await checkPromise(addColumn("jobs", "job_log", "longtext", true, "NULL"), messages, success, failed);

  // 7 : a worker and several app nodes on one database (lib/nodes.js, lib/epochs.js,
  // the designer lock in models/lock.model.js, the node following a job)
  // and a local user's groups besides its first one
  for (const table of ["nodes", "cache_epochs", "designer_lock", "user_groups"]) {
    const sql = fs.readFileSync(`${__dirname}/../db/create_${table}_table.sql`);
    await checkPromise(addTable(table, sql.toString()), messages, success, failed);
  }
  await checkPromise(addColumn("jobs", "tracker", "varchar(250)", true, "NULL"), messages, success, failed);
  // who holds a repository's or a schedule's 'running' claim, and since when : a claim left by a
  // node that went away is released by the worker (Repository.releaseStaleClaims, Schedule.releaseStale)
  for (const table of ["repositories", "schedule"]) {
    await checkPromise(addColumn(table, "claim_node", "varchar(250)", true, "NULL"), messages, success, failed);
    await checkPromise(addColumn(table, "claim_since", "datetime", true, "NULL"), messages, success, failed);
  }
}

// Idempotent by its WHERE clause : only a credential without a valid type gets one
function fillCredentialTypes() {
  return mysql
    .do("UPDATE AnsibleForms.`credentials` SET credential_type=IF(is_database,'database','ssh') WHERE credential_type IS NULL OR credential_type NOT IN ('ssh','git','api','database','cyberark')")
    .then((res) => `Set the type of ${res?.affectedRows ?? 0} credential(s)`);
}

// Idempotent by its WHERE clause : a row is copied once, and never over a store chosen since
function copyVaultPathToSecretRef() {
  return mysql
    .do("UPDATE AnsibleForms.`credentials` SET secret_store='vault', secret_ref=vault_path WHERE vault_path IS NOT NULL AND vault_path<>'' AND (secret_store IS NULL OR secret_store='')")
    .then((res) => {
      const n = res?.affectedRows || 0;
      const message = n ? `pointed ${n} credential(s) with a vault_path at the secret store 'vault'` : "No credential vault_path left to copy";
      if (n) logger.warning(message); else logger.debug(message);
      return message;
    });
}

/**
 * Copies every AWX connection into runners (type awx), then drops the awx table. Idempotent :
 * a row is copied once (by name), and with no awx table left there is nothing to do. Both
 * tables encrypt password and token with the same key, so the ciphertext is copied as is.
 * A name already taken by a runner of ANOTHER type cannot be copied : then the awx table is
 * kept (nothing is lost) and the log says which name to change ; the next start retries.
 */
export async function copyAwxToRunners() {
  if (!(await tablePresent("awx"))) return "No awx table left to copy";
  const copied = await mysql.do(
    "INSERT INTO AnsibleForms.`runners` (name, type, description, uri, token, username, password, use_credentials, ignore_certs, ca_bundle, is_default, managed) " +
    "SELECT a.name, 'awx', a.description, a.uri, NULLIF(a.token,''), NULLIF(a.username,''), NULLIF(a.password,''), COALESCE(a.use_credentials,0), COALESCE(a.ignore_certs,0), a.ca_bundle, COALESCE(a.is_default,0), COALESCE(a.managed,0) " +
    "FROM AnsibleForms.`awx` a WHERE a.name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM AnsibleForms.`runners` r WHERE r.name = a.name)"
  );
  const blocked = await mysql.do(
    "SELECT a.name FROM AnsibleForms.`awx` a LEFT JOIN AnsibleForms.`runners` r ON r.name = a.name AND r.type = 'awx' WHERE r.id IS NULL"
  );
  if (blocked.length) {
    const names = blocked.map((b) => b.name || "(no name)").join(", ");
    const message = `AWX connection(s) ${names} could not move to runners : a runner of another type has that name, or the connection has none. Rename it ; the awx table is kept until then`;
    logger.error(message);
    return message;
  }
  await dropTable("awx");
  const n = copied?.affectedRows || 0;
  const message = n ? `Moved ${n} AWX connection(s) to runners (type awx) and dropped the awx table` : "Dropped the awx table, its connections were already runners";
  logger.warning(message);
  return message;
}

// PATCHING : Patch All
async function patchAll(messages, success, failed) {
  await checkPromise(patchVersion4(messages, success, failed), messages, success, failed);
  await checkPromise(patchVersion5(messages, success, failed), messages, success, failed);
  await checkPromise(patchVersion6(messages, success, failed), messages, success, failed);
  await checkPromise(patchVersion7(messages, success, failed), messages, success, failed);
}
async function checkPromise(promise, messages, success, failed) {
  try {
    var res = await promise;
    if(res!=null){
      messages.push(res);
      success.push(res);
    }
  } catch (e) {
    if(e.message!=null){
      messages.push(e.message);
      failed.push(e.message);
    }
  }
}

async function checkTables(tables, messages, success, failed) {
  for (var i = 0; i < tables.length; i++) {
    await checkPromise(checkTable(tables[i]), messages, success, failed);
  }
}

async function checkAll({ patch = true } = {}) {
  var messages = [];
  var success = [];
  var failed = [];
  var resultobj;

  // check the database
  await checkPromise(checkSchema(), messages, success, failed);

  if (failed.length > 0) {
    // if schema does not exist, we can't check the tables // throw now
    resultobj = { message: messages, data: { success: success, failed: failed } };
    const err = new Error("Schema is missing");
    err.result = resultobj;
    throw err;
  }

  // check all the tables
  // not awx : 7 copies it into runners and drops it (patchVersion7)
  var tables = ["credentials", "groups", "job_output", "jobs", "ldap", "tokens", "users"];
  await checkPromise(checkTables(tables, messages, success, failed), messages, success, failed);

  if (failed.length > 0) {
    // some of the tables are missing, we can't patch them // throw now
    resultobj = { message: messages, data: { success: success, failed: failed } };
    const err = new Error("Tables are missing");
    err.result = resultobj;
    throw err;
  }

  // patch the tables
  if (patch) await checkPromise(patchAll(messages, success, failed), messages, success, failed);

  if (failed.length > 0) {
    // some of the patches failed // throw now
    resultobj = { message: messages, data: { success: success, failed: failed } };
    const err = new Error("Patching failed");
    err.result = resultobj;
    throw err;
  }

  // all passed fine
  resultobj = { message: messages, data: { success: success, failed: failed } };
  return resultobj;
}

export { SCHEMA_MANIFEST };
export default Schema;

// function addRecord(table,names,values){
//   var message
//   var db="AnsibleForms"
//   logger.debug("checking record in table " + table)
//   var checksql = `SELECT * FROM ${db}.${table}`
//   var sql = `INSERT INTO ${db}.${table}(${names.join(",")}) VALUES(${values.join(",")});`
//   return mysql.do(checksql)
//     .then((checkres)=>{
//       if(checkres.length==0){
//         return mysql.do(sql)
//       }
//       return false
//     })
//     .then((res)=>{
//       if(!res){
//         message=`Record in '${table}' is present`
//         logger.debug(message)
//         return message
//       }
//       message=`added record in '${table}'`
//       logger.warning(message)
//       return message
//     })
// }

// function dropIndex(table,index){
//   var message
//   var db="AnsibleForms"
//   logger.debug(`dropping index '${index}' on table '${table}'`)
//   var checksql = `SHOW INDEX FROM ${db}.${table} WHERE Key_name='${index}'`
//   var sql = `DROP INDEX \`PRIMARY\` ON ${db}.${table}`
//   return mysql.do(checksql)
//     .then((checkres)=>{
//       if(checkres.length>0){
//         return mysql.do(sql)
//       }
//       return false
//     })
//     .then((res)=>{
//       if(!res){
//         message=`Index '${index}' is already dropped on '${table}'`
//         logger.debug(message)
//         return message
//       }
//       message=`Index '${index}' dropped on '${table}'`
//       logger.warning(message)
//       return message
//     })
// }
// function renameColumn(table,name,newname,fieldtype){
//   var message
//   var db="AnsibleForms"
//   var checksql = `SHOW COLUMNS FROM ${db}.${table} WHERE Field='${newname}'`
//   var sql = `ALTER TABLE ${db}.${table} CHANGE \`${name}\` \`${newname}\` ${fieldtype}`
//   logger.debug(`rename column '${name}'->'${newname}' on table '${table}'`)
//   return mysql.do(checksql)
//     .then((checkres)=>{
//       if(checkres.length==0){
//         return mysql.do(sql)
//       }
//       return false
//     })
//     .then((res)=>{
//       if(!res){
//         message=`Column '${name}' is already present on '${table}'`
//         logger.debug(message)
//         return message
//       }
//       message=`renamed column '${name}'->'${newname}' on '${table}'`
//       logger.warning(message)
//       return message
//     })
// }
// function resizeColumn(table,name,fieldtype){
//   var message
//   var db="AnsibleForms"
//   var checksql = `SHOW COLUMNS FROM ${db}.${table} WHERE Field='${name}' and type='${fieldtype}'`
//   var sql = `ALTER TABLE ${db}.${table} MODIFY \`${name}\` ${fieldtype}`
//   logger.debug(`resize column '${name}'->'${fieldtype}' on table '${table}'`)
//   return mysql.do(checksql)
//     .then((checkres)=>{
//       if(checkres.length==0){
//         return mysql.do(sql)
//       }
//       return false
//     })
//     .then((res)=>{
//       if(!res){
//         message=`Column '${name}' has already correct size on '${table}'`
//         logger.debug(message)
//         return message
//       }
//       message=`resized column '${name}'->'${fieldtype}' on '${table}'`
//       logger.warning(message)
//       return message
//     })
// }
