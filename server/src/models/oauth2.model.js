
import CrudModel from './crud.model.js';
import Errors from '../lib/errors.js';
import mysql from './db.model.js';
import logger from '../lib/logger.js';

class OAuth2 extends CrudModel {
    static modelName = 'oauth2';

    // Unset enable on the other providers of the same type when this one is enabled.
    //
    // Same trap as Awx.preProcess : this WRITES, and it ran before the required-field
    // check and before the managed guard, so a POST with no `name` answered 400 having
    // already switched off a seed-declared SSO provider. The blanket update now spares
    // managed rows, and a caller trying to displace one is refused instead.
    static async preProcess(data, _action, opts = {}) {
        if (data.enable) {
            if (!opts.fromSeed) {
                const held = await mysql.do('SELECT name FROM AnsibleForms.`oauth2_providers` WHERE enable = 1 AND managed = 1 AND provider = ?', [data.provider]);
                if (held.length) {
                    throw new Errors.AccessDeniedError(`The enabled '${data.provider}' provider is managed by the config seed ('${held[0].name}') and cannot be displaced here`);
                }
            }
            logger.info('Unsetting enable on all other OAuth2 records');
            // the seed clears every row of this provider type ; an API caller only the
            // unmanaged ones (see the matching note in runner.model.js)
            await mysql.do('UPDATE AnsibleForms.`oauth2_providers` SET enable = 0 WHERE provider = ?'
              + (opts.fromSeed ? '' : ' AND managed = 0'), [data.provider]);
        }
        return data;
    }
    // opts carries { fromSeed:true } for the declarative config seed only
    // preProcess writes, so everything that can refuse runs first - including the
    // required-field check and checkExist, which otherwise happen inside super.*
    static async create(data, opts = {}) {
        CrudModel.assertRequired(this.modelName, data);
        data =await this.preProcess(data, 'create', opts);
        return super.create(this.modelName, data, opts);
    }
    static async update(data, id, opts = {}) {
        await CrudModel.checkExist(this.modelName, id);
        if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, id);
        data = await this.preProcess(data, 'update', opts);
        return super.update(this.modelName, data, id, opts);
    }
    static async delete(id, opts = {}) {
        return super.delete(this.modelName, id, opts);
    }
    static async findById(id) {
        return super.findById(this.modelName, id);
    }
    static async findAll() {
        return super.findAll(this.modelName);
    }
    static async findByName(name) {
        return super.findByName(this.modelName, name);
    }
    static async findByProperty(property, value) {
        return super.findByProperty(this.modelName, property, value);
    }
}

export default OAuth2;
