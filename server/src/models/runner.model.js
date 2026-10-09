// Runners : where a job runs. One row per RTE (runtime environment container) ; a form
// names one with `runner: <name>`, or runs on the default one of its type.
import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import mysql from './db.model.js';
import { RUNNER_TYPES, getRunner } from '../runners/index.js';
import { stripTrailingSlashes } from '../lib/url.js';

// the flavours of an awx runner (none is AWX) : which product it is (its uri carries its API path)
export const RUNNER_FLAVOURS = ['aap', 'ascender'];
import { NODE_DEAD_SECONDS } from '../lib/role.js';

// the secret the api shows instead of a stored token ; sent back it means "unchanged"
export const SECRET_MASK = '********';

// a runner its RTE registered (rte/register.js) whose RTE has not answered for this long is
// removed by the worker ; until then the Runners page shows it as unresponsive
export const UNRESPONSIVE_REMOVE_SECONDS = 600;

class Runner extends CrudModel {
  static modelName = 'runner';

  static normalize(data, opts = {}) {
    // which RTE registered a runner is the RTE's to say (rte/register.js), never the api's
    if (!opts.fromRte) delete data.node_id;
    // what the api adds on read (withState) is not stored
    delete data.state;
    if (data.type !== undefined && !RUNNER_TYPES.includes(data.type)) {
      throw new Errors.BadRequestError(`Unknown runner type '${data.type}' - use one of ${RUNNER_TYPES.join(', ')}`);
    }
    // the api shows secrets masked ; the mask sent back means "unchanged"
    if (data.token === SECRET_MASK) delete data.token;
    if (data.password === SECRET_MASK) delete data.password;
    if (typeof data.uri === 'string') data.uri = stripTrailingSlashes(data.uri.trim());
    // the flavour of an awx runner : 'aap', 'ascender', or none (AWX) - which product it is
    if (data.flavour !== undefined) {
      if (data.flavour === '' || data.flavour === null) data.flavour = null;
      else if (!RUNNER_FLAVOURS.includes(data.flavour)) {
        throw new Errors.BadRequestError(`Unknown runner flavour '${data.flavour}' - use one of ${RUNNER_FLAVOURS.join(', ')}, or none`);
      }
    }
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
    this.changed(this.modelName);
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    CrudModel.assertRequired(this.modelName, data);
    data = this.normalize(data, opts);
    this.assertComplete(data);
    // The first runner of a type is its default : forms that name no runner need one, and
    // nobody should have to remember the tick. Not for the seed, which declares the flag
    // itself - setting it here would flip it back on every start.
    if (!data.is_default && !opts.fromSeed && !(await this.findDefault(data.type))) {
      data.is_default = 1;
    }
    await this.assertDefaultAllowed(data, data.type, opts);
    const insertId = await super.create(this.modelName, data, opts);
    if (data.is_default && insertId) await this.clearOtherDefaults(insertId, data.type, opts);
    return insertId;
  }

  static async update(data, id, opts = {}) {
    await CrudModel.checkExist(this.modelName, id);
    if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, id);
    data = this.normalize(data, opts);
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

  /**
   * Adds `state` to runners an RTE registered itself : 'automatic' while its RTE writes its
   * heartbeat, 'unresponsive' once it stopped (no heartbeat for NODE_DEAD_SECONDS, the Status
   * page's rule). A runner added by hand or by the seed has no state.
   */
  static async withState(runners) {
    const list = runners || [];
    const ids = [...new Set(list.map((r) => r.node_id).filter(Boolean))];
    if (!ids.length) return list;
    const rows = await mysql.do(
      'SELECT id FROM AnsibleForms.`nodes` WHERE id IN (?) AND last_seen > (NOW() - INTERVAL ? SECOND)',
      [ids, NODE_DEAD_SECONDS],
    );
    const alive = new Set(rows.map((r) => r.id));
    return list.map((r) => (r.node_id ? { ...r, state: alive.has(r.node_id) ? 'automatic' : 'unresponsive' } : r));
  }

  /**
   * The worker's sweep : runners an RTE registered itself whose RTE has not written its
   * heartbeat for UNRESPONSIVE_REMOVE_SECONDS - a recreated container registered again under
   * its new address. Never a runner added by hand or by the seed. A runner whose node row is
   * missing is left alone : its RTE may not have written its first heartbeat yet.
   */
  static async removeUnresponsive() {
    // a plain DELETE with a subquery : a multi-table DELETE resolves its alias against the
    // connection's default database, and ours has none ("No database selected")
    const res = await mysql.do(
      'DELETE FROM AnsibleForms.`runners` WHERE node_id IS NOT NULL AND COALESCE(managed, 0) = 0 ' +
        'AND node_id IN (SELECT id FROM AnsibleForms.`nodes` WHERE last_seen < (NOW() - INTERVAL ? SECOND))',
      [UNRESPONSIVE_REMOVE_SECONDS],
    );
    const n = res?.affectedRows || 0;
    if (n) this.changed(this.modelName);
    return n;
  }

  /** proves the runner answers and accepts us ; what it reports is up to the runner type */
  static async check(runner) {
    const impl = getRunner(runner.type);
    if (!impl.check) throw new Errors.BadRequestError(`A ${runner.type} runner has no connection test`);
    return impl.check(runner);
  }
}

export default Runner;
