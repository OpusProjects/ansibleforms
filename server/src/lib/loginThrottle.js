/******************************************************************/
/*                                                                */
/*  Failed logins : an account locks after LOGIN_MAX_FAILURES     */
/*  failures in a row, for LOGIN_LOCKOUT_MINUTES, and an address  */
/*  that fails LOGIN_MAX_FAILURES_PER_IP times within that window */
/*  is held back as well (one address trying many accounts).      */
/*  Kept in the database (login_failures), so every app node      */
/*  counts the same attempts. A locked attempt is refused before  */
/*  any password is checked ; a successful login clears the       */
/*  account's count. 0 turns a limit off.                         */
/*                                                                */
/******************************************************************/
import mysql from "../models/db.model.js";
import appConfig from "../../config/app.config.js";
import logger from "./logger.js";

/**
 * The keys an attempt counts under : the account (lower case, so case variants share one
 * count) and the client address.
 *
 * Args:
 *   username (string): the attempted username.
 *   ip (string): the client address.
 *
 * Returns:
 *   {user: string|null, ip: string|null}: the keys.
 */
export function keysFor(username, ip) {
  const name = String(username || "").trim().toLowerCase();
  return { user: name ? `user:${name}`.slice(0, 300) : null, ip: ip ? `ip:${ip}`.slice(0, 300) : null };
}

/**
 * Whether an attempt is held back : its account is locked, or its address failed too often.
 *
 * Args:
 *   username (string): the attempted username.
 *   ip (string): the client address.
 *
 * Returns:
 *   Promise<{blocked: boolean, minutes?: number}>: blocked, and for how many more minutes.
 */
export async function loginBlocked(username, ip) {
  const max = appConfig.loginMaxFailures;
  const maxIp = appConfig.loginMaxFailuresPerIp;
  const window = appConfig.loginLockoutMinutes;
  if ((!max && !maxIp) || !window) return { blocked: false };
  const { user, ip: ipKey } = keysFor(username, ip);
  const keys = [user, ipKey].filter(Boolean);
  if (!keys.length) return { blocked: false };
  let rows;
  try {
    rows = await mysql.do(
      "SELECT `key`, failures, TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS left_s, TIMESTAMPDIFF(SECOND, first_at, NOW()) AS age_s FROM AnsibleForms.`login_failures` WHERE `key` IN (?)",
      [keys]
    );
  } catch (err) {
    // no table yet (a database being upgraded) : never lock everybody out over it
    logger.debug(`Could not read the failed logins : ${err.message || err}`);
    return { blocked: false };
  }
  for (const r of rows || []) {
    if (r.key === user && max && Number(r.left_s) > 0) return { blocked: true, minutes: Math.ceil(Number(r.left_s) / 60) };
    if (r.key === ipKey && maxIp && Number(r.failures) >= maxIp && Number(r.age_s) < window * 60) {
      return { blocked: true, minutes: Math.max(1, Math.ceil((window * 60 - Number(r.age_s)) / 60)) };
    }
  }
  return { blocked: false };
}

/**
 * Counts a failed login : for the account (locked once it reaches LOGIN_MAX_FAILURES) and for
 * the address. A count older than the window starts again.
 *
 * Args:
 *   username (string): the attempted username.
 *   ip (string): the client address.
 *
 * Returns:
 *   Promise<boolean>: true when this failure locked the account.
 */
export async function loginFailed(username, ip) {
  const max = appConfig.loginMaxFailures;
  const window = appConfig.loginLockoutMinutes;
  if ((!max && !appConfig.loginMaxFailuresPerIp) || !window) return false;
  const { user, ip: ipKey } = keysFor(username, ip);
  let locked = false;
  for (const key of [user, ipKey].filter(Boolean)) {
    try {
      // one statement : a count older than the window starts again at 1
      await mysql.do(
        "INSERT INTO AnsibleForms.`login_failures` (`key`, failures, first_at) VALUES (?, 1, NOW()) " +
          "ON DUPLICATE KEY UPDATE failures = IF(first_at < NOW() - INTERVAL ? MINUTE AND (locked_until IS NULL OR locked_until < NOW()), 1, failures + 1), " +
          "first_at = IF(failures = 1, NOW(), first_at)",
        [key, window]
      );
      if (key === user && max) {
        const res = await mysql.do(
          "UPDATE AnsibleForms.`login_failures` SET locked_until = NOW() + INTERVAL ? MINUTE WHERE `key`=? AND failures >= ? AND (locked_until IS NULL OR locked_until < NOW())",
          [window, key, max]
        );
        if (res?.affectedRows) locked = true;
      }
    } catch (err) {
      logger.debug(`Could not count a failed login : ${err.message || err}`);
    }
  }
  if (locked) logger.warning(`Login : account '${String(username)}' locked for ${window} minutes after ${max} failed logins`);
  return locked;
}

/**
 * Clears an account's count after a successful login.
 *
 * Args:
 *   username (string): the username.
 *
 * Returns:
 *   Promise<void>: settles once cleared.
 */
export async function loginSucceeded(username) {
  const { user } = keysFor(username, null);
  if (!user) return;
  await mysql.do("DELETE FROM AnsibleForms.`login_failures` WHERE `key`=?", [user]).catch(() => {});
}

/**
 * Unlocks an account (an admin resetting it).
 *
 * Args:
 *   username (string): the username.
 *
 * Returns:
 *   Promise<void>: settles once unlocked.
 */
export async function unlockAccount(username) {
  return loginSucceeded(username);
}

export default { keysFor, loginBlocked, loginFailed, loginSucceeded, unlockAccount };
