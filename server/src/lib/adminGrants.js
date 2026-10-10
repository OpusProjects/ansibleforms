/******************************************************************/
/*                                                                */
/*  Who becomes an admin, and who may make them one. The admin    */
/*  role names local groups and users (config.yaml) ; a user with */
/*  settings access but without the admin role could put any      */
/*  account - their own - into such a group, or reset the admin   */
/*  account's password, and so make themselves admin. Granting    */
/*  admin, and changing an account or a group that grants it, is  */
/*  the admin role's own.                                         */
/*                                                                */
/******************************************************************/
import mysql from "../models/db.model.js";
import Errors from "./errors.js";

/**
 * The local groups and users the admin role names.
 *
 * Args:
 *   configRoles (object[]): the roles of the configuration (config.yaml).
 *
 * Returns:
 *   {groups: Set<string>, users: Set<string>}: their names, without the local/ prefix.
 */
export function adminGrantsFromRoles(configRoles = []) {
  const admin = (configRoles || []).find((r) => r?.name === "admin") || {};
  const local = (list) => new Set((list || []).filter((x) => typeof x === "string" && x.startsWith("local/")).map((x) => x.slice(6)));
  return { groups: local(admin.groups), users: local(admin.users) };
}

/**
 * The local groups and users the admin role names, from the configuration as it is now.
 *
 * Returns:
 *   Promise<{groups: Set<string>, users: Set<string>}>: their names.
 */
export async function adminGrants() {
  const { default: Form } = await import("../models/form.model.js");
  const base = await Form.load(null, null, null, true);
  return adminGrantsFromRoles(base?.roles || []);
}

/**
 * Whether the request is an admin's.
 *
 * Args:
 *   req (object): the request.
 *
 * Returns:
 *   boolean: true when the signed-in user has the admin role.
 */
export function isAdminRequest(req) {
  return (req?.user?.user?.roles || []).includes("admin");
}

/**
 * The names of groups, by id.
 *
 * Args:
 *   ids (number[]): the group ids.
 *
 * Returns:
 *   Promise<string[]>: their names.
 */
async function groupNames(ids) {
  const wanted = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!wanted.length) return [];
  const rows = await mysql.do("SELECT name FROM AnsibleForms.`groups` WHERE id IN (?)", [wanted]);
  return (rows || []).map((r) => r.name);
}

/**
 * Whether a local user is an admin through the admin role : named in it, or in one of its groups.
 *
 * Args:
 *   userId (number): the user.
 *   grants (object): adminGrants().
 *
 * Returns:
 *   Promise<boolean>: true when the user is an admin.
 */
async function userIsAdmin(userId, grants) {
  const rows = await mysql.do("SELECT username, group_id FROM AnsibleForms.`users` WHERE id=?", [userId]);
  const user = rows?.[0];
  if (!user) return false;
  if (grants.users.has(user.username)) return true;
  const links = await mysql.do("SELECT group_id FROM AnsibleForms.`user_groups` WHERE user_id=?", [userId]);
  const names = await groupNames([user.group_id, ...(links || []).map((l) => l.group_id)]);
  return names.some((n) => grants.groups.has(n));
}

/**
 * Refuses to a non-admin a change that would grant admin, or touch an account or a group that
 * grants it.
 *
 * Args:
 *   req (object): the request (the signed-in user).
 *   change (object): what it changes :
 *     userId : an existing user it updates, deletes, or changes the groups of ;
 *     username : the name of a user it creates ;
 *     groupIds : groups it puts a user in ;
 *     groupId : an existing group it updates or deletes ;
 *     groupName : the name a group is created with or renamed to.
 *
 * Raises:
 *   Errors.AccessDeniedError: the request is not an admin's and the change touches admin.
 */
export async function assertMayTouchAdmin(req, { userId, username, groupIds, groupId, groupName } = {}) {
  if (isAdminRequest(req)) return;
  const grants = await adminGrants();
  const refuse = (what) => { throw new Errors.AccessDeniedError(`Only an admin can ${what}`); };
  if (username && grants.users.has(String(username))) refuse("create or change an admin account");
  if (userId !== undefined && userId !== null && (await userIsAdmin(userId, grants))) refuse("change, reset or delete an admin account");
  if (groupIds && (await groupNames(groupIds)).some((n) => grants.groups.has(n))) refuse("put a user in a group that grants admin");
  if (groupId !== undefined && groupId !== null && (await groupNames([groupId])).some((n) => grants.groups.has(n))) refuse("change or delete a group that grants admin");
  if (groupName && grants.groups.has(String(groupName))) refuse("create a group that grants admin");
}

export default { adminGrantsFromRoles, adminGrants, isAdminRequest, assertMayTouchAdmin };
