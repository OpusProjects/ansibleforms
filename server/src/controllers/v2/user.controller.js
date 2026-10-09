'use strict';
import Audit from '../../models/audit.model.js';
import User from '../../models/user.model.js';
import RestResult from '../../models/restResult.model.v2.js';
import Errors from '../../lib/errors.js';
import i18n from '../../lib/i18n.js';

const findAllOr1 = async function(req, res) {
  try {
    if(req.query.username){
      const user = await User.findByUsername(req.query.username);
      // Mask password before returning to API
      if (user && user.password) {
        user.password = '**********';
      }
      res.json(RestResult.single(user));
    }else{
      const users = await User.findAll();
      // Mask passwords before returning to API
      users.forEach(u => {
        if (u.password) u.password = '**********';
      });
      res.json(RestResult.list(users));
    }
  } catch(err) {
    res.status(500).json(RestResult.error(err.toString()));
  }
};

const create = async function(req, res) {
    //handles null error
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
    }else{
        try {
          const user = await User.create(req.body);
          res.json(RestResult.single(user));
        } catch(err) {
          res.status(500).json(RestResult.error(err.toString()));
        }
    }
};

const findById = async function(req, res) {
    try {
      const user = await User.findById(req.params.id);
      // Mask password before returning to API
      if (user && user.password) {
        user.password = '**********';
      }
      res.json(RestResult.single(user));
    } catch(err) {
      if (err instanceof Errors.NotFoundError) {
        res.status(404).json(RestResult.error(i18n.t(req, 'resources.userNotFound')));
      } else {
        res.status(500).json(RestResult.error(err.toString()));
      }
    }
};

const findByToken = async function(req, res) {
    try {
      const user = await User.findByUsername(req.user.user.username);
      if(user){
        res.json(RestResult.single(user.id));
      }else{
        res.status(404).json(RestResult.error(i18n.t(req, 'resources.userNotFound')));
      }
    } catch(err) {
      res.status(500).json(RestResult.error(err.toString()));
    }
};

const update = async function(req, res) {
    // don't tamper with username
    delete req.body.username
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
    }else{
        try {
          await User.update(req.body,req.params.id);
          res.json(RestResult.single(null));
        } catch(err) {
          res.status(500).json(RestResult.error(err.toString()));
        }
    }
};

/**
 * Adds a group to a user (POST /api/v2/user/:id/groups, { group_id }).
 */
const addGroup = async function(req, res) {
  if (!req.body?.group_id) {
    return res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
  }
  try {
    await User.addGroup(req.params.id, req.body.group_id);
    res.json(RestResult.single(null));
  } catch(err) {
    res.status(err instanceof Errors.NotFoundError ? 404 : 400).json(RestResult.error(err.message || err.toString()));
  }
};

/**
 * Removes a group from a user (DELETE /api/v2/user/:id/groups/:groupId) ; a user keeps one.
 */
const removeGroup = async function(req, res) {
  try {
    await User.removeGroup(req.params.id, req.params.groupId);
    res.json(RestResult.single(null));
  } catch(err) {
    res.status(err instanceof Errors.NotFoundError ? 404 : 400).json(RestResult.error(err.message || err.toString()));
  }
};

const changePassword = async function(req, res) {
  if(req.user.user.type=="local" && req.user.user.id){
    // make sure then don't tamper with the group or username
    delete req.body.group_id
    delete req.body.username
    // ...nor with which ROW this writes to. `id` is a writable field in crud.config, so it
    // was not merely cosmetic to leave it in the body.
    delete req.body.id
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
    }else{
        try {
          // Changing a password requires proving you know the current one. Without this a
          // stolen access token - which expires - could be turned into permanent ownership
          // of the account in one request. Only enforced when a password is actually being
          // set, so updating an email still works.
          if (req.body.password) {
            const current = req.body.currentPassword;
            if (!current) {
              return res.status(400).json(RestResult.error(i18n.t(req, 'resources.currentPasswordRequired')));
            }
            // User.authenticate RESOLVES with { isValid: false } for a wrong password - it
            // does not reject - so the result has to be inspected. A try/catch alone let
            // every wrong password through, which is worse than not checking at all.
            let check = null;
            try {
              check = await User.authenticate(req.user.user.username, current);
            } catch (e) {
              check = null;
            }
            if (!check?.isValid) {
              Audit.log({
                user: req.user?.user, ip: req.ip, action: 'user.password.update',
                outcome: 'denied', targetType: 'user', target: req.user.user.username,
                detail: { reason: 'current password did not match' },
              });
              return res.status(403).json(RestResult.error(i18n.t(req, 'resources.currentPasswordWrong')));
            }
          }
          delete req.body.currentPassword
          await User.update(req.body,req.user.user.id);
          res.json(RestResult.single(null));
        } catch(err) {
          res.status(500).json(RestResult.error(err.toString()));
        }
    }
  }else{
    res.status(400).json(RestResult.error(i18n.t(req, 'resources.cantChangePasswordLdap')));
  }
};

const find = function(req, res) {
    res.json(RestResult.single(req.user.user));
};

const deleteUser = async function(req, res) {
    try {
      await User.delete(req.params.id);
      res.json(RestResult.single(null));
    } catch(err) {
      res.status(500).json(RestResult.error(err.toString()));
    }
};

export default {
  findAllOr1,
  create,
  findById,
  findByToken,
  update,
  changePassword,
  find,
  delete: deleteUser,
  addGroup,
  removeGroup
};