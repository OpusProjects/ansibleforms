'use strict';
import RestResult from '../../models/restResult.model.v2.js';
import Lock from '../../models/lock.model.js';
import Errors from '../../lib/errors.js';
import i18n from '../../lib/i18n.js';

// The lock (a database row) is a copy of the user who took the lock : their roles, groups, options
// and email as well as their name. The status goes to every designer user, who only needs
// to see who holds it and since when - the rest stays on the server.
const LOCK_FIELDS = ['username', 'type', 'displayName', 'created'];

/**
 * Keeps the fields of a lock holder that the status may show.
 *
 * Args:
 *   lock (object): the lock as stored, a copy of the user who took it.
 *
 * Returns:
 *   object: the holder's username, login type, display name and when the lock was taken.
 */
function publicLock(lock) {
  return Object.fromEntries(LOCK_FIELDS.filter((k) => lock?.[k] !== undefined).map((k) => [k, lock[k]]));
}

// Follow knownhosts style: minimal validation, try/catch, RestResult.list/single/error
const lockController = {
  async status(req, res) {
    try {
      const result = await Lock.status(req.user.user);
      if (result.lock) result.lock = publicLock(result.lock);
      return res.json(RestResult.single(result));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },
  async set(req, res) {
    try {
      await Lock.set(req.user.user);
      return res.status(201).json(RestResult.single({ message: i18n.t(req, 'resources.lockAdded') }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },
  async delete(req, res) {
    try {
      await Lock.delete(req.user.user);
      return res.json(RestResult.single({ message: i18n.t(req, 'resources.lockDeleted') }));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  }
};

export default lockController;