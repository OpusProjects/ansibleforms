// Runners : where a playbook runs. One row per RTE (runtime environment container) ; a form
// names one with `runner: <name>`, or runs on the default one, or in the app itself.
import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import mysql from './db.model.js';
import { RUNNER_TYPES, getRunner } from '../runners/index.js';

// the secret the api shows instead of a stored token ; sent back it means "unchanged"
export const SECRET_MASK = '********';

class Runner extends CrudModel {
  static modelName = 'runner';

  static normalize(data) {
    if (data.type !== undefined && !RUNNER_TYPES.includes(data.type)) {
      throw new Errors.BadRequestError(`Unknown runner type '${data.type}' - use one of ${RUNNER_TYPES.join(', ')}`);
    }
    if (data.token === SECRET_MASK) delete data.token;
    if (typeof data.uri === 'string') data.uri = data.uri.trim().replace(/\/+$/, '');
    return data;
  }

  // The default is a managed row's to keep : an API caller may not take it away from one
  // (same rule as awx.model.js)
  static async assertDefaultAllowed(data, opts) {
    if (data.is_default && !opts.fromSeed) {
      const held = await mysql.do('SELECT name FROM AnsibleForms.`runners` WHERE is_default = 1 AND managed = 1');
      if (held.length) {
        throw new Errors.AccessDeniedError(`The default runner is managed by the config seed ('${held[0].name}') and cannot be changed here`);
      }
    }
  }

  // after the write, never before it : a refused write must not clear the others
  static async clearOtherDefaults(keepId, opts = {}) {
    logger.info('Unsetting is_default on all other runners');
    const scope = opts.fromSeed ? '' : ' AND managed = 0';
    await mysql.do('UPDATE AnsibleForms.`runners` SET is_default = 0 WHERE id <> ?' + scope, [keepId]);
    this.getCache(this.modelName)?.flushAll();
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    CrudModel.assertRequired(this.modelName, data);
    data = this.normalize(data);
    await this.assertDefaultAllowed(data, opts);
    const insertId = await super.create(this.modelName, data, opts);
    if (data.is_default && insertId) await this.clearOtherDefaults(insertId, opts);
    return insertId;
  }

  static async update(data, id, opts = {}) {
    await CrudModel.checkExist(this.modelName, id);
    if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, id);
    data = this.normalize(data);
    await this.assertDefaultAllowed(data, opts);
    const res = await super.update(this.modelName, data, id, opts);
    if (data.is_default) await this.clearOtherDefaults(id, opts);
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

  /** the runner marked default, or null */
  static async findDefault() {
    const all = await this.findAll();
    return (all || []).find((r) => r.is_default) || null;
  }

  /** proves the runner answers and accepts us ; what it reports is up to the runner type */
  static async check(runner) {
    const impl = getRunner(runner.type);
    if (!impl.check) throw new Errors.BadRequestError(`A ${runner.type} runner has no connection test`);
    return impl.check(runner);
  }
}

export default Runner;
