"use strict";
import CrudModel from "../../models/crud.model.js";
import RestResult from "../../models/restResult.model.v2.js";
import Errors from "../../lib/errors.js";
import i18n from "../../lib/i18n.js";

// The columns a caller may write. Everything else in the body is dropped :
//  - id : the row key. On create a chosen id is inserted as is, and on update it moves the
//    row. Either way a caller can push the AUTO_INCREMENT counter to the top of the INT range
//    (id 2147483647), after which every new stored job of every user fails as a duplicate key.
//  - username : the owner, always taken from the logged in user.
//  - created_at : set by the database, a caller must not backdate or postdate it.
// expires_at stays : the Store dialog lets the user pick when the stored job expires.
const WRITABLE = ['name', 'description', 'form_name', 'form_data', 'expires_at'];
function pickWritable(body) {
  const data = {};
  for (const key of WRITABLE) {
    if (body && body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

const stored_jobsController = {
  async find(req, res) {
    try {
      const username = `${req.user.user.type}/${req.user.user.username}`;
      
      if (req.query.name) {
        // Find by name (with username filter for security)
        const all = await CrudModel.findAll('stored_jobs');
        const item = all.find(s => s.username === username && s.name === req.query.name);
        return res.json(RestResult.single(item));
      } else if (req.query.form_name) {
        // Filter by form and username (used by form page Load button)
        const all = await CrudModel.findAll('stored_jobs');
        const filtered = all.filter(s => s.form_name === req.query.form_name && s.username === username);
        return res.json(RestResult.list(filtered));
      } else {
        // The stored jobs page. Scoped exactly like findById, update and delete below :
        // a settings user (admin) manages everyone's, any other user only sees their own.
        // allowStoredJobs is on for every user by default, so returning every row here
        // let any user read the stored field values of all other users - values the
        // per-id read already refuses them.
        const isAdmin = req.user.user.options?.showSettings;
        const all = await CrudModel.findAll('stored_jobs');
        const visible = isAdmin ? all : all.filter(s => s.username === username);
        return res.json(RestResult.list(visible));
      }
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async create(req, res) {
    try {
      // Add username from authenticated user (format: type/username)
      const data = {
        ...pickWritable(req.body),
        username: `${req.user.user.type}/${req.user.user.username}`
      };
      const id = await CrudModel.create('stored_jobs', data);
      return res.status(201).json(RestResult.single(i18n.t(req, 'resources.storedJobAdded'), { id }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async findById(req, res) {
    try {
      const username = `${req.user.user.type}/${req.user.user.username}`;
      const isAdmin = req.user.user.options?.showSettings;
      const item = await CrudModel.findById('stored_jobs', req.params.id);
      
      // Verify user owns this item (or is admin)
      if (!isAdmin && item.username !== username) {
        throw new Errors.AccessDeniedError(i18n.t(req, 'resources.storedJobNoAccess'));
      }
      return res.json(RestResult.single(item));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async update(req, res) {
    try {
      const username = `${req.user.user.type}/${req.user.user.username}`;
      const isAdmin = req.user.user.options?.showSettings;
      
      // Verify user owns this item (or is admin)
      const existing = await CrudModel.findById('stored_jobs', req.params.id);
      if (!isAdmin && existing.username !== username) {
        throw new Errors.AccessDeniedError(i18n.t(req, 'resources.storedJobNoAccess'));
      }
      
      // Don't allow changing the id, the owner or the creation time
      const data = pickWritable(req.body);
      
      // a body with nothing writable left (only an id, say) changes nothing ; sent on it
      // would be an UPDATE without columns, a syntax error
      if (Object.keys(data).length) {
        await CrudModel.update('stored_jobs', data, req.params.id);
      }
      return res.json(RestResult.single(i18n.t(req, 'resources.storedJobUpdated')));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async delete(req, res) {
    try {
      const username = `${req.user.user.type}/${req.user.user.username}`;
      const isAdmin = req.user.user.options?.showSettings;
      
      // Verify user owns this item (or is admin)
      const existing = await CrudModel.findById('stored_jobs', req.params.id);
      if (!isAdmin && existing.username !== username) {
        throw new Errors.AccessDeniedError(i18n.t(req, 'resources.storedJobNoAccess'));
      }
      
      await CrudModel.delete('stored_jobs', req.params.id);
      return res.json(RestResult.single(i18n.t(req, 'resources.storedJobDeleted')));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  }
};

export default stored_jobsController;
