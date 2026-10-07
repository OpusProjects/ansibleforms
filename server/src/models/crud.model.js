import Errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import crypto from '../lib/crypto.js';
import NodeCache from 'node-cache';
import crudConfigs from '../../config/crud.config.js';
import mysql from './db.model.js';
import { assertValidCron } from '../lib/cronValidate.js';
import { bump } from '../lib/epochs.js';

// Per-model cache objects
const caches = {};

class CrudModel {
  static getConfig(modelName) {
    const config = crudConfigs[modelName];
    if (!config) throw new Errors.BadRequestError(`Unknown model: ${modelName}`);
    return config;
  }

  static getCache(modelName) {
    const config = this.getConfig(modelName);
    if (!config.allowCache) return null;
    if (!caches[modelName]) {
      caches[modelName] = new NodeCache({ stdTTL: config.cacheTTL || 3600, checkperiod: (config.cacheTTL || 3600) * 0.5 });
    }
    return caches[modelName];
  }

  // This process's cached rows of a model, dropped. What another process wrote reaches here
  // through the epochs (lib/epochs.js), which call this ; nothing else needs it.
  static flushLocal(modelName) {
    caches[modelName]?.flushAll();
  }

  static flushAllLocal() {
    for (const cache of Object.values(caches)) cache.flushAll();
  }

  // A row of this model changed : this process's cache is dropped now, every other
  // process's within a few seconds (the epoch named after the model), and the worker
  // re-reads its cron registry when it is a schedule or a repository.
  static changed(modelName) {
    CrudModel.flushLocal(modelName);
    bump(modelName);
  }

  static getSelectFields(modelName, { hideHidden = false } = {}) {
    const config = this.getConfig(modelName);
    return config.fields
      .filter(f => !(hideHidden && f.hidden))
      .map(f => f.name)
      .join(', ');
  }

  static getFieldValues(modelName, data, isUpdate=false) {
    const config = this.getConfig(modelName);
    const result = {};
    for (const field of config.fields) {
      if (data[field.name] !== undefined) {
        let value = data[field.name];
        if (field.isEncrypted && value) {
          value = crypto.encrypt(value);
        } else if (field.isBoolean) {
          value = value ? 1 : 0;
        } else if (field.isDatetime && value && typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)) {
          // Convert ISO datetime to MySQL format (YYYY-MM-DD HH:MM:SS)
          value = value.replace('T', ' ').replace(/\.\d{3}Z$/, '');
        }
        result[field.name] = value;
      }else{
        if(field.setDefault && !isUpdate){ // if not update (create) => set defaults where needed
          // set defaults
          result[field.name] = ''
          if(field.isBoolean){
            result[field.name] = 0
          }
        }
      }
    }
    return result;
  }

  static postProcess(modelName, record) {
    if (!record) return record;
    const config = this.getConfig(modelName);
    for (const field of config.fields) {
      if (field.isEncrypted && record[field.name]) {
        try {
          record[field.name] = crypto.decrypt(record[field.name]);
        } catch (e) {
          logger.error('Failed to decrypt value', e);
          record[field.name] = '';
        }
      }
    }
    return record;
  }

  static async checkExist(modelName, id) {
    
    const config = this.getConfig(modelName);
    const key = config.fields.find(f => f.isKey)?.name || 'id';
    const sql = `SELECT 1 FROM ?? WHERE ?? = ?`;
    const res = await mysql.do(sql, [config.table, key, id]);
    if (!res.length) throw new Errors.NotFoundError(`No record found with ${key} ${id}`);
    return true;
  }

  static async findAll(modelName) {
    const config = this.getConfig(modelName);
    const sql = `SELECT ${this.getSelectFields(modelName, { hideHidden: true })} FROM ${config.table}`;
    const res = await mysql.do(sql);
    return res.map(r => this.postProcess(modelName, r));
  }


  static async findById(modelName, id) {
    const config = this.getConfig(modelName);
    const cache = this.getCache(modelName);
    const key = config.fields.find(f => f.isKey)?.name || 'id';
    if (config.allowCache && cache) {
      const cacheKey = `id:${id}`;
      let cached = cache.get(cacheKey);
      if (cached) return cached;
      await this.checkExist(modelName, id);
      const sql = `SELECT ${this.getSelectFields(modelName)} FROM ${config.table} WHERE ${key} = ?`;
      const res = await mysql.do(sql, [id]);
      const result = res[0] ? this.postProcess(modelName, res[0]) : null;
      if (result) cache.set(cacheKey, result);
      return result;
    } else {
      await this.checkExist(modelName, id);
      const sql = `SELECT ${this.getSelectFields(modelName)} FROM ${config.table} WHERE ${key} = ?`;
      const res = await mysql.do(sql, [id]);
      return res[0] ? this.postProcess(modelName, res[0]) : null;
    }
  }

  static async findByName(modelName, name) {
    const config = this.getConfig(modelName);
    const cache = this.getCache(modelName);
    const naturalKey = config.fields.find(f => f.isNaturalKey)?.name || 'name';
    if (config.allowCache && cache) {
      const cacheKey = `name:${name}`;
      let cached = cache.get(cacheKey);
      if (cached) return cached;
      const sql = `SELECT ${this.getSelectFields(modelName)} FROM ${config.table} WHERE ${naturalKey} = ?`;
      const res = await mysql.do(sql, [name]);
      const result = res[0] ? this.postProcess(modelName, res[0]) : null;
      if (result) cache.set(cacheKey, result);
      return result;
    } else {
      const sql = `SELECT ${this.getSelectFields(modelName)} FROM ${config.table} WHERE ${naturalKey} = ?`;
      const res = await mysql.do(sql, [name]);
      return res[0] ? this.postProcess(modelName, res[0]) : null;
    }
  }

  static async findByProperty(modelName, property, value) {
    if (!property) throw new Errors.BadRequestError('Property name required');
    const config = this.getConfig(modelName);
    const sql = `SELECT ${this.getSelectFields(modelName)} FROM ${config.table} WHERE ${property} = ? LIMIT 1`;
    const res = await mysql.do(sql, [value]);
    return res[0] ? this.postProcess(modelName, res[0]) : null;
  }

  // Hook for custom pre-processing (can be overridden in parent model)
  static async preProcess(modelName, data, _action) {
    return data;
  }

  /**
   * Records flagged `managed` are owned by the declarative config seed
   * (https://ansibleforms.com/seed). The seed is re-applied on every start, so a change made
   * through the API would be silently reverted - refusing it is honest.
   *
   * 403, never 401 : App.vue's axios interceptor treats any 401 as a dead
   * session and logs the user out, so a permission answer must be 403.
   *
   * Models whose table has no `managed` column are unaffected.
   */
  static async assertNotManaged(modelName, id) {
    const config = this.getConfig(modelName);
    if (!config.fields.some(f => f.name === 'managed')) return;
    const key = config.fields.find(f => f.isKey)?.name || 'id';
    const res = await mysql.do(`SELECT managed FROM ?? WHERE ?? = ?`, [config.table, key, id]);
    if (res.length && res[0].managed) {
      throw new Errors.AccessDeniedError(`This record is managed by the config seed (${modelName}) and is read only`);
    }
  }

  // The seed owns the flag : an API caller must never be able to set it (which would
  // freeze a hand-made record) or clear it (which would unlock a seeded one).
  static stripManaged(data, opts) {
    if (!opts.fromSeed && data && Object.prototype.hasOwnProperty.call(data, 'managed')) {
      delete data.managed;
    }
    return data;
  }

  /**
   * The required-field check, callable on its own.
   *
   * It normally runs inside create(), which is too late for a model whose preProcess
   * WRITES (Awx and OAuth2 clear a singleton flag on other rows): a payload missing a
   * required field had already cleared every row's flag before this threw 400. Those
   * models call it up front instead.
   */
  static assertRequired(modelName, data) {
    const config = this.getConfig(modelName);
    for (const field of config.fields) {
      if (field.required && (data[field.name] === undefined || data[field.name] === null || data[field.name] === '')) {
        throw new Errors.BadRequestError(`Missing required field: ${field.name}`);
      }
    }
  }

  /**
   * A `cron` column is only ever a schedule for the in-process scheduler, so a value it
   * cannot run must not reach the database. cron.service.js checks too, but it does so
   * when it REGISTERS the task - by then the row is stored, and its failure is a log line
   * and a `return`, so the repository, datasource or schedule silently never runs again.
   *
   * Central rather than per model on purpose : all three tables that carry a schedule
   * (repositories, datasource, schedule) declare the same column name, and adding a
   * fourth should not need anyone to remember this.
   */
  static assertValidCronFields(modelName, data) {
    const config = this.getConfig(modelName);
    for (const field of config.fields) {
      if (field.name !== 'cron') continue;
      if (data[field.name] === undefined) continue;   // absent means "not being changed"
      assertValidCron(data[field.name]);
    }
  }

  static async create(modelName, data, opts = {}) {
    // data = await this.preProcess(modelName, data, 'create');
    this.stripManaged(data, opts);
    const config = this.getConfig(modelName);
    this.assertRequired(modelName, data);
    this.assertValidCronFields(modelName, data);
    const fieldValues = this.getFieldValues(modelName, data);
    const sql = `INSERT INTO ${config.table} SET ?`;
    const res = await mysql.do(sql, fieldValues);
    // nothing of a new row is cached here yet, but other processes care that it exists
    // (the worker registers a new schedule's cron)
    bump(modelName);
    return res.insertId || null;
  }

  static async update(modelName, data, id, opts = {}) {
    // data = await this.preProcess(modelName, data, 'update');
    this.stripManaged(data, opts);
    const config = this.getConfig(modelName);
    const cache = this.getCache(modelName);
    const key = config.fields.find(f => f.isKey)?.name || 'id';
    // input validation before any query, as create() does : a schedule the scheduler
    // cannot run is a bad request whether or not the record exists
    this.assertValidCronFields(modelName, data);
    await this.checkExist(modelName, id);
    if (!opts.fromSeed) await this.assertNotManaged(modelName, id);
    const fieldValues = this.getFieldValues(modelName, data, true);
    const sql = `UPDATE ${config.table} SET ? WHERE ${key} = ?`;
    const res = await mysql.do(sql, [fieldValues, id]);
    if (config.allowCache && cache) {
      // flushAll, NOT `delete caches[modelName]`. Dropping the map entry does not free
      // the NodeCache: its checkperiod timer re-arms itself on every fire and holds a
      // strong reference to the instance, so the orphan and its timer live for the
      // process lifetime. That is one leaked instance and one recurring timer per update
      // on every cached model (awx, credential, datasource, groups, repositories,
      // schedule, ...). Flushing clears the entries and keeps the one live instance.
      cache.flushAll(); // clear entire cache for simplicity
    }
    bump(modelName);
    return res.affectedRows > 0;
  }

  static async delete(modelName, id, opts = {}) {
    const config = this.getConfig(modelName);
    const cache = this.getCache(modelName);
    const key = config.fields.find(f => f.isKey)?.name || 'id';
    await this.checkExist(modelName, id);
    if (!opts.fromSeed) await this.assertNotManaged(modelName, id);
    // Get the record first to get the name for cache removal
    let record = null;
    if (config.allowCache && cache) {
      // call base implementation directly to avoid subclass overrides with different signatures
      record = await CrudModel.findById(modelName, id);
    }
    const sql = `DELETE FROM ${config.table} WHERE ${key} = ?`;
    const res = await mysql.do(sql, [id]);
    if (config.allowCache && cache) {
      cache.del(`id:${id}`);
      const naturalKey = config.fields.find(f => f.isNaturalKey)?.name || 'name';
      if (record && record[naturalKey]) cache.del(`name:${record[naturalKey]}`);
    }
    bump(modelName);
    return res.affectedRows > 0;
  }
}

export default CrudModel;
