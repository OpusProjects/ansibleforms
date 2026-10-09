import CredentialModel from '../../models/credential.model.v2.js';
import RestResult from '../../models/restResult.model.v2.js';
import Errors from '../../lib/errors.js';
import i18n from '../../lib/i18n.js';
import mysql from '../../lib/mysql.js';
import postgres from '../../lib/postgres.js';
import mssql from '../../lib/mssql.js';
import oracle from '../../lib/oracle.js';
import mongodb from '../../lib/mongodb.js';

const credentialController = {
  async find(req, res) {
    try {
      if (req.query.name) {
        const credential = await CredentialModel.findByName(req.query.name);
        // Mask password before returning to API
        if (credential && credential.password) {
          credential.password = '**********';
        }
        if (credential && credential.client_key) credential.client_key = '**********';
        res.json(RestResult.single(credential));
      } else {
        const credentials = await CredentialModel.findAll();
        // Mask passwords before returning to API
        credentials.forEach(c => {
          if (c.password) c.password = '**********';
          if (c.client_key) c.client_key = '**********';
        });
        res.json(RestResult.list(credentials));
      }
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async create(req, res) {
    try {
      const credential = await CredentialModel.create(req.body);
      res.json(RestResult.single({ message: i18n.t(req, 'success.created', { resource: 'Credential' }), id: credential }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async findById(req, res) {
    try {
      const credential = await CredentialModel.findById(req.params.id);
      // Mask password before returning to API
      credential.password = '**********';
      if (credential.client_key) credential.client_key = '**********';
      res.json(RestResult.single(credential));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async update(req, res) {
    try {
      await CredentialModel.update(req.body, req.params.id);
      res.json(RestResult.single({ message: i18n.t(req, 'success.updated', { resource: 'Credential' }) }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async delete(req, res) {
    try {
      await CredentialModel.delete(req.params.id);
      res.json(RestResult.single({ message: i18n.t(req, 'success.deleted', { resource: 'Credential' }) }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async testDb(req, res) {
    try {
      const credential = await CredentialModel.findById(req.params.id);
      const db_type = credential.db_type;
      if (db_type === 'mysql') {
        await mysql.query(credential.name, 'select 1');
      } else if (db_type === 'mssql') {
        await mssql.query(credential.name, 'select 1');
      } else if (db_type === 'postgres') {
        await postgres.query(credential.name, 'select 1');
      } else if (db_type === 'oracle') {
        await oracle.query(credential.name, 'select 1');
      } else if (db_type === 'mongodb') {
        await mongodb.query(credential.name, 'admin~system.version~{}');
      } else {
        throw new Errors.BadRequestError(i18n.t(req, 'resources.dbTypeNotSet'));
      }
      res.json(RestResult.single({ message: i18n.t(req, 'success.connectionOk', { resource: 'Database' }) }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  }
};

export default credentialController;
