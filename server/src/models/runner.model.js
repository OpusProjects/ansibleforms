// Runners : where a job runs. One row per RTE (runtime environment container) ; a form
// names one with `runner: <name>`, or runs on the default one of its type.
import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import mysql from './db.model.js';
import { RUNNER_TYPES, getRunner } from '../runners/index.js';
import { stripTrailingSlashes } from '../lib/url.js';

// the secret the api shows instead of a stored token ; sent back it means "unchanged"
export const SECRET_MASK = '********';

class Runner extends CrudModel {
  static modelName = 'runner';

  static normalize(data) {
    if (data.type !== undefined && !RUNNER_TYPES.includes(data.type)) {
      throw new Errors.BadRequestError(`Unknown runner type '${data.type}' - use one of ${RUNNER_TYPES.join(', ')}`);
    }
    // the api shows secrets masked ; the mask sent back means "unchanged"
    if (data.token === SECRET_MASK) delete data.token;
    if (data.password === SECRET_MASK) delete data.password;
    if (typeof data.uri === 'string') data.uri = stripTrailingSlashes(data.uri.trim());
    return data;
  }

  // What each type needs to work, checked on the row as it will be stored
  static assertComplete(row) {
    const missing = (field) => { throw new Errors.BadRequestError(`A runner of type ${row.type} needs ${field}`); };
    if (!row.uri) missing('a uri');
    if (row.type === 'rte' && !row.token) missing('a token (the RTE_TOKEN of the RTE)');
    if (row.type === 'awx') {
      if (row.use_credentials) {
        if (!row.username || !row.password) missing('a username and a password (use credentials is on)');
      } else if (!row.token) {
        missing('a token, or use credentials with a username and a password');
      }
    }
  }

  // The default of a type is a managed row's to keep : an API caller may not take it away
  // from one
  static async assertDefaultAllowed(data, type, opts) {
    if (data.is_default && !opts.fromSeed) {
      const held = await mysql.do('SELECT name FROM AnsibleForms.`runners` WHERE is_default = 1 AND managed = 1 AND type = ?', [type]);
      if (held.length) {
        throw new Errors.AccessDeniedError(`The default ${type} runner is managed by the config seed ('${held[0].name}') and cannot be changed here`);
      }
    }
  }

  // One default per type : after the write, never before it - a refused write must not
  // clear the others
  static async clearOtherDefaults(keepId, type, opts = {}) {
    logger.info(`Unsetting is_default on the other ${type} runners`);
    const scope = opts.fromSeed ? '' : ' AND managed = 0';
    await mysql.do('UPDATE AnsibleForms.`runners` SET is_default = 0 WHERE id <> ? AND type = ?' + scope, [keepId, type]);
    this.getCache(this.modelName)?.flushAll();
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    CrudModel.assertRequired(this.modelName, data);
    data = this.normalize(data);
    this.assertComplete(data);
    await this.assertDefaultAllowed(data, data.type, opts);
    const insertId = await super.create(this.modelName, data, opts);
    if (data.is_default && insertId) await this.clearOtherDefaults(insertId, data.type, opts);
    return insertId;
  }

  static async update(data, id, opts = {}) {
    await CrudModel.checkExist(this.modelName, id);
    if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, id);
    data = this.normalize(data);
    // the stored row decides what is missing : an update may send only what changed
    const current = await this.findById(id);
    const merged = { ...current, ...data };
    this.assertComplete(merged);
    await this.assertDefaultAllowed(data, merged.type, opts);
    const res = await super.update(this.modelName, data, id, opts);
    if (data.is_default) await this.clearOtherDefaults(id, merged.type, opts);
    return res;
  }

  static async delete(id, opts = {}) {
    return super.delete(this.modelName, id, opts);
  }

  static async findAll() {
    return super.findAll(this.modelName);
  }

  static async findById(id) {
    return super.findById(this.modelName, id);
  }

  static async findByName(name) {
    return super.findByName(this.modelName, name);
  }

  /** the runner of this type marked default, or null */
  static async findDefault(type) {
    const all = await this.findAll();
    return (all || []).find((r) => r.is_default && r.type === type) || null;
  }

  /** proves the runner answers and accepts us ; what it reports is up to the runner type */
  static async check(runner) {
    const impl = getRunner(runner.type);
    if (!impl.check) throw new Errors.BadRequestError(`A ${runner.type} runner has no connection test`);
    return impl.check(runner);
  }
}

export default Runner;
