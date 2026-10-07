'use strict';
import logger from "../lib/logger.js";
import yaml from "yaml";
import config from '../../config/app.config.js';
import moment from "moment";
import Repository from "./repository.model.js";
import mysql from "./db.model.js";

import Errors from '../lib/errors.js';

// The designer lock : who is editing the forms. It lives in the database (one row, id 1) since
// 7.5 ; before, it was the file LOCK_PATH, which every app node saw only when they shared that
// file.
const LOCK_ID = 1;
// the row's holder is this user (data is the holder as JSON)
const HOLDER_IS = "JSON_UNQUOTE(JSON_EXTRACT(data, '$.username'))=? AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.type'))=?";

//lock object create
var Lock=function(){

};

// the lock as stored, or null when free ; no designer check, for the background jobs and the
// Status page
Lock.read = async function(){
  const rows = await mysql.do("SELECT data FROM AnsibleForms.`designer_lock` WHERE id=?", [LOCK_ID], true);
  if (!rows.length || !rows[0].data) return null;
  try {
    return JSON.parse(rows[0].data);
  } catch {
    // written by hand or truncated : still held, by somebody unknown
    return {};
  }
};
// lightweight check : is the designer lock currently held by anyone ? used by
// background jobs (cron pull) to avoid running git on a working tree while the
// designer is editing it, even before the first save makes the tree dirty
// (issue #414)
Lock.isHeld = async function(){
  try {
    return (await Lock.read()) !== null;
  } catch (e) {
    logger.warning(`Could not read the designer lock : ${e.message || e}`);
    return false;
  }
};
Lock.status = async function(user){
  const lck = yaml.parse(await Lock.get(user) || "null");
  if (!lck) return { free: true };
  const match = ((user.username === lck.username) && (user.type === lck.type));
  return { lock: lck, match, free: false };
};
// Exclusive : the lock is taken only when it is free, or already this user's (then its time
// is refreshed). Two designers asking at once - on one node or on two - get one winner ; the
// other is answered 423, which the designer shows as "locked by". Taking it from somebody else
// is a deliberate delete first (the designer's force unlock), never a silent overwrite.
Lock.set = async function (user) {
  if (config.showDesigner && user.options.showDesigner) {
    logger.notice(`Creating lock for user ${user.username}`);
    const copy = { ...user, created: moment(Date.now()).format('YYYY-MM-DD HH:mm:ss') };
    const data = JSON.stringify(copy);
    const taken = await mysql.do(
      "INSERT IGNORE INTO AnsibleForms.`designer_lock` (id, data, created) VALUES (?, ?, NOW())",
      [LOCK_ID, data]);
    if (!taken.affectedRows) {
      const refreshed = await mysql.do(
        "UPDATE AnsibleForms.`designer_lock` SET data=?, created=NOW() WHERE id=? AND " + HOLDER_IS,
        [data, LOCK_ID, user.username, user.type]);
      if (!refreshed.affectedRows) {
        const holder = (await Lock.read())?.username || "another user";
        throw new Errors.ApiError(`The designer is locked by ${holder}`, 423);
      }
    }
    // refresh the forms repositories first so the designer edits the latest
    // remote state (best effort ; a dirty tree or network error must not block
    // the designer, unpushed work is preserved by the rebase on sync) - once the lock is
    // ours, so the pull never runs under somebody else's open designer
    try {
      await Repository.pullFormsRepositories();
    } catch (e) {
      logger.warning(`Failed to refresh the forms repositories : ${e.message}`);
    }
    return { message: 'Lock set', user: { username: copy.username, type: copy.type } };
  }
  logger.error("Designer is disabled, can't set lock");
  throw new Errors.AccessDeniedError('Designer is disabled');
};
// onlyMine : release the lock only while it is still this user's - a request that took the
// lock for itself (a config save) must not delete one a designer took in the meantime
Lock.delete = async function(user={}, { onlyMine = false } = {}){
  if (config.showDesigner && user.options.showDesigner) {
    logger.notice(`Deleting lock`);
    const res = onlyMine
      ? await mysql.do("DELETE FROM AnsibleForms.`designer_lock` WHERE id=? AND " + HOLDER_IS, [LOCK_ID, user.username, user.type])
      : await mysql.do("DELETE FROM AnsibleForms.`designer_lock` WHERE id=?", [LOCK_ID]);
    // deleting a non-existent lock is idempotent
    if (!res.affectedRows) return { message: 'Lock not present', deleted: false };
    return { message: 'Lock deleted' };
  }
  logger.error("Designer is disabled, can't delete lock");
  throw new Errors.AccessDeniedError('Designer is disabled');
};
// the lock as yaml text, empty when free
Lock.get = async function (user={}) {
  if (config.showDesigner && user.options.showDesigner) {
    const lock = await Lock.read();
    return lock === null ? "" : yaml.stringify(lock);
  }
  logger.error("Designer is disabled, can't get lock");
  throw new Errors.AccessDeniedError('Designer is disabled');
};

export default  Lock;
