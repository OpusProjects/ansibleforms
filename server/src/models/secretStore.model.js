// Secret stores : HashiCorp Vault, CyberArk, ... One row per store ; credentials name the
// store and the place in it (credentials.secret_store / secret_ref).
import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import { SECRET_STORE_TYPES } from '../secrets/providers/index.js';
import { clearSecretCache } from '../secrets/cache.js';

// what secretStore.controller.js shows instead of a stored secret
export const SECRET_MASK = '********';

class SecretStore extends CrudModel {
  static modelName = 'secretstore';

  // The admin page sends '' for a number left empty, and an int column refuses '' in strict
  // mode ; `extra` is free JSON, checked here so a typo is a 400 rather than a store that
  // silently ignores its options.
  static normalize(data, { creating }) {
    // the api hands token and client_key out masked ; the mask sent back means "unchanged"
    for (const key of ['token', 'client_key']) {
      if (data[key] === SECRET_MASK) delete data[key];
    }
    if (data.type !== undefined && !SECRET_STORE_TYPES.includes(data.type)) {
      throw new Errors.BadRequestError(`Unknown secret store type '${data.type}' - use one of ${SECRET_STORE_TYPES.join(', ')}`);
    }
    if (typeof data.url === 'string') data.url = data.url.trim().replace(/\/+$/, '');
    if (data.kv_version !== undefined) {
      const v = data.kv_version === '' || data.kv_version === null ? 2 : parseInt(data.kv_version, 10);
      if (![1, 2].includes(v)) throw new Errors.BadRequestError('kv_version must be 1 or 2');
      data.kv_version = v;
    } else if (creating) {
      data.kv_version = 2;
    }
    if (data.cache_ttl_seconds !== undefined) {
      const ttl = data.cache_ttl_seconds === '' || data.cache_ttl_seconds === null ? 60 : parseInt(data.cache_ttl_seconds, 10);
      if (!Number.isFinite(ttl) || ttl < 0) throw new Errors.BadRequestError('cache_ttl_seconds must be 0 or more');
      data.cache_ttl_seconds = ttl;
    }
    if (data.extra !== undefined) {
      if (data.extra === '' || data.extra === null) {
        data.extra = null;
      } else {
        let extra = data.extra;
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch (e) {
            throw new Errors.BadRequestError(`extra is not valid JSON : ${e.message}`);
          }
        }
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
          throw new Errors.BadRequestError('extra must be a JSON object');
        }
        data.extra = JSON.stringify(extra);
      }
    }
    return data;
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    const res = await super.create(this.modelName, this.normalize(data, { creating: true }), opts);
    clearSecretCache();
    return res;
  }

  static async update(data, id, opts = {}) {
    const res = await super.update(this.modelName, this.normalize(data, { creating: false }), id, opts);
    clearSecretCache();
    return res;
  }

  static async delete(id, opts = {}) {
    const res = await super.delete(this.modelName, id, opts);
    clearSecretCache();
    return res;
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

  /** `extra` as an object ; {} when empty or unreadable */
  static extraOf(store) {
    if (!store?.extra) return {};
    if (typeof store.extra === 'object') return store.extra;
    try { return JSON.parse(store.extra) || {}; } catch { return {}; }
  }
}

export default SecretStore;
