import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import mysql from './db.model.js';
import crypto from '../lib/crypto.js';
import { vaultRead, mapVaultPayloadToCredential } from '../lib/vault.js';
import dbConfig from '../../config/db.config.js';

class CredentialModel extends CrudModel {
  static modelName = 'credential';

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    return super.create(this.modelName, data, opts);
  }

  static async update(data, id, opts = {}) {
    return super.update(this.modelName, data, id, opts);
  }

  static async delete(id, opts = {}) {
    const res = await super.delete(this.modelName, id, opts);
    // the regex lookups below are cached under their pattern, not under the name, so a
    // deleted credential must not stay resolvable through them until the ttl runs out
    this.getCache(this.modelName)?.flushAll();
    return res;
  }

  static async findAll() {
    return super.findAll(this.modelName);
  }

  static async findById(id) {
    return super.findById(this.modelName, id);
  }

  // Exact name, every column of the row (the API's ?name= and fnCredentials use it).
  // user/password come from HashiCorp Vault when the row has a vault_path.
  static async findByName(name) {
    const cached = await super.findByName(this.modelName, name);
    if (!cached) return cached;
    const result = { ...cached };
    if (result.vault_path) {
      await overlaySecret(result);
      // a vault-backed row is not kept in the long-lived cache, so a rotated password is
      // picked up promptly ; the vault lib has its own, shorter cache
      this.getCache(this.modelName)?.del(`name:${name}`);
    }
    delete result.vault_path;
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
    if (result.is_database) {
      result.multipleStatements = true;
    } else {
      delete result.secure;
      delete result.db_name;
      delete result.db_type;
      delete result.is_database;
    }
    if (result.vault_path) {
      await overlaySecret(result);
    } else {
      try {
        result.password = crypto.decrypt(result.password);
      } catch {
        logger.error("Failed to decrypt the password.  Did the secretkey change ?");
        result.password = "";
      }
    }
    delete result.vault_path;
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

const ROW_SQL = "SELECT host,port,db_name,name,user,password,secure,db_type,is_database,vault_path FROM AnsibleForms.`credentials` WHERE name REGEXP ?";

async function lookupRow(nameOrRegex, fallbackName) {
  let res = await mysql.do(ROW_SQL, nameOrRegex);
  if (!res.length && fallbackName) res = await mysql.do(ROW_SQL, fallbackName);
  if (!res.length) {
    throw new Errors.NotFoundError(`No credential found with filter ${nameOrRegex}${fallbackName ? ` or ${fallbackName}` : ""}`);
  }
  return res[0];
}

// user/password from HashiCorp Vault ; host, port and the database settings stay those of
// the row
async function overlaySecret(result) {
  try {
    const mapped = mapVaultPayloadToCredential(await vaultRead(result.vault_path));
    result.user = mapped.user || result.user || "";
    result.password = mapped.password || "";
  } catch (e) {
    logger.error(`Failed to read credential '${result.name}' from Vault: ${e.message}`);
    throw e;
  }
}

export default CredentialModel;
