import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import mysql from './db.model.js';
import crypto from '../lib/crypto.js';
import { readSecret, mapPayloadToCredential, parseInlineSecret, VAULT_STORE_NAME } from '../secrets/providers/index.js';
import dbConfig from '../../config/db.config.js';

class CredentialModel extends CrudModel {
  static modelName = 'credential';

  // vault_path is deprecated : a credential names its store and the place in it. A write
  // that still uses vault_path is pointed at the store named `vault`, and a write that
  // names a store clears vault_path, so the two can never disagree.
  static mirrorVaultPath(data) {
    if (data.secret_store === '') data.secret_store = null;
    if (data.vault_path && !data.secret_store) {
      logger.warning(`Credential '${data.name || ''}' : vault_path is deprecated since 7 and removed in 8 - use secret_store and secret_ref`);
      data.secret_store = VAULT_STORE_NAME;
      data.secret_ref = data.vault_path;
    } else if (data.secret_store !== undefined) {
      data.vault_path = null;
    }
    return data;
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    return super.create(this.modelName, this.mirrorVaultPath(data), opts);
  }

  static async update(data, id, opts = {}) {
    return super.update(this.modelName, this.mirrorVaultPath(data), id, opts);
  }

  static async delete(id, opts = {}) {
    const res = await super.delete(this.modelName, id, opts);
    // the regex lookups below are cached under their pattern, not under the name, so a
    // deleted credential must not stay resolvable through them until the ttl runs out
    this.changed(this.modelName);
    return res;
  }

  static async findAll() {
    return super.findAll(this.modelName);
  }

  static async findById(id) {
    return super.findById(this.modelName, id);
  }

  // Exact name, every column of the row (the API's ?name= and fnCredentials use it).
  // user/password come from the secret store when the row names one.
  static async findByName(name) {
    const cached = await super.findByName(this.modelName, name);
    if (!cached) return cached;
    const result = { ...cached };
    const source = secretSource(result);
    if (source) await overlaySecret(result, source, !!result.is_database);
    stripSecretSource(result);
    return result;
  }

  // The one place a credential is resolved for use: by database queries, by playbook and
  // AWX jobs and by the REST expression helpers.
  // nameOrRegex is a MySQL REGEXP ; fallbackName is tried when it matches nothing.
  // Returns a fresh object on every call - callers reshape it (mysql.js does).
  static async resolveCredential(nameOrRegex, fallbackName = "") {
    // no name in the log : callers pass names taken from extravars, which CodeQL rightly
    // cannot tell apart from the secrets next to them
    logger.debug("Resolving a credential");
    // "vault:<path>" / "secret:<store>:<ref>" : straight from the store, no row
    const inline = parseInlineSecret(nameOrRegex);
    if (inline) return resolveInlineSecret(nameOrRegex, inline);
    const cache = this.getCache(this.modelName);
    const cacheKey = `regex:${nameOrRegex}|${fallbackName || ""}`;
    // the ROW is cached, password still encrypted ; decrypting and reading the secret
    // store happen on every call, so a rotated secret is never served from here
    let row = cache?.get(cacheKey);
    if (!row) {
      row = await lookupRow(nameOrRegex, fallbackName);
      cache?.set(cacheKey, row);
    }
    const result = { ...row };
    const isDatabase = !!result.is_database;
    if (result.is_database) {
      result.multipleStatements = true;
    } else {
      delete result.secure;
      delete result.db_name;
      delete result.db_type;
      delete result.is_database;
    }
    const source = secretSource(result);
    if (source) {
      await overlaySecret(result, source, isDatabase);
    } else {
      try {
        result.password = crypto.decrypt(result.password);
      } catch {
        logger.error("Failed to decrypt the password.  Did the secretkey change ?");
        result.password = "";
      }
    }
    stripSecretSource(result);
    return result;
  }

  // A form's credential map, { extravarKey: "name[,fallback]" | "__self__" } ->
  // { extravarKey: credential }. A credential that cannot be resolved is logged and left
  // out : the playbook runs without that extra var, as it did before 6.3.
  static async resolveCredentialMap(spec, selfConfig = dbConfig) {
    const credentials = {};
    for (const [key, value] of Object.entries(spec || {})) {
      if (value == "__self__") {
        credentials[key] = {
          host: selfConfig.host,
          user: selfConfig.user,
          port: selfConfig.port,
          password: selfConfig.password,
        };
        continue;
      }
      try {
        const [name, fallback = ""] = String(value).split(",").map((v) => v.trim());
        credentials[key] = await this.resolveCredential(name, fallback);
      } catch (err) {
        logger.error(`Cannot resolve credential '${key}' : ${err.message || err}`);
      }
    }
    return credentials;
  }
}

const ROW_SQL = "SELECT host,port,db_name,name,user,password,secure,db_type,is_database,vault_path,secret_store,secret_ref FROM AnsibleForms.`credentials` WHERE name REGEXP ?";

async function lookupRow(nameOrRegex, fallbackName) {
  let res = await mysql.do(ROW_SQL, nameOrRegex);
  if (!res.length && fallbackName) res = await mysql.do(ROW_SQL, fallbackName);
  if (!res.length) {
    throw new Errors.NotFoundError(`No credential found with filter ${nameOrRegex}${fallbackName ? ` or ${fallbackName}` : ""}`);
  }
  return res[0];
}

// Where the row's user and password live : the store it names, or - for a row written
// before secret stores existed - the store named `vault` at its vault_path.
function secretSource(row) {
  if (row.secret_store) return { store: row.secret_store, ref: row.secret_ref || "" };
  if (row.vault_path) return { store: VAULT_STORE_NAME, ref: row.vault_path };
  return null;
}

const isEmpty = (v) => v === undefined || v === null || v === "";

// user and password always come from the store. Host, port and database name stay those of
// the row, and are taken from the store only where the row leaves them empty - a CyberArk
// account carries its address, so the row need not repeat it.
async function overlaySecret(result, source, isDatabase) {
  let mapped;
  try {
    mapped = mapPayloadToCredential(await readSecret(source.store, source.ref));
  } catch (e) {
    logger.error(`Failed to read credential '${result.name}' from secret store '${source.store}': ${e.message}`);
    throw e;
  }
  result.user = mapped.user || result.user || "";
  result.password = mapped.password || "";
  if (isEmpty(result.host) && !isEmpty(mapped.host)) result.host = mapped.host;
  if (isEmpty(result.port) && !isEmpty(mapped.port)) result.port = mapped.port;
  if (isDatabase && isEmpty(result.db_name) && !isEmpty(mapped.db_name)) result.db_name = mapped.db_name;
}

// An inline secret carries the whole connection itself, under the keys mapPayloadToCredential
// knows (https://ansibleforms.com/secret-stores). With a db_type it is a database credential, shaped like a
// database row ; without one, user and password with the rest of the secret passed through.
async function resolveInlineSecret(name, source) {
  // no log here : the caller reports the error, and the store name comes from the
  // inline reference, which CodeQL cannot tell apart from the secrets next to it
  const mapped = mapPayloadToCredential(await readSecret(source.store, source.ref));
  if (!mapped.db_type) return { ...mapped, name };
  return {
    name,
    user: mapped.user || "",
    password: mapped.password || "",
    host: mapped.host || "",
    port: mapped.port ?? null,
    db_name: mapped.db_name || "",
    db_type: mapped.db_type,
    secure: mapped.secure === true || mapped.secure === 1 || mapped.secure === "true" ? 1 : 0,
    is_database: 1,
    multipleStatements: true,
  };
}

// a playbook receives the credential as an extra var : where it came from is not its business
function stripSecretSource(result) {
  delete result.vault_path;
  delete result.secret_store;
  delete result.secret_ref;
}

export default CredentialModel;
