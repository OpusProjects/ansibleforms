/******************************************************************/
/*                                                                */
/*  Revoked tokens. An access token is a signed JWT, valid until  */
/*  it expires whatever happens meanwhile ; these make two events */
/*  end it at once :                                              */
/*    - a logout ends its session : every token carries the id of */
/*      the login it comes from (sid), kept across refreshes ;    */
/*    - a password change ends every session of the user issued   */
/*      before it (iat older than the change).                    */
/*  Kept in token_revocations (shared by every app node) and in   */
/*  memory here, reloaded when another node revokes something     */
/*  (the 'token_revocations' epoch) : checking a request costs no */
/*  query.                                                        */
/*                                                                */
/******************************************************************/
import { randomBytes } from "crypto";
import logger from "./logger.js";

// the database layer and the epochs, loaded when first needed : the token check is imported by
// code (and tests) that never reach the database
const db = async () => (await import("../models/db.model.js")).default;
const epochs = () => import("./epochs.js");

const EPOCH = "token_revocations";

// sid -> expires (ms) ; "type/username" -> revoked before (unix seconds)
let sessions = new Map();
let users = new Map();
let loaded = null;

/**
 * A new session id, for the tokens of one login.
 *
 * Returns:
 *   string: 32 hex characters.
 */
export function newSessionId() {
  return randomBytes(16).toString("hex");
}

/**
 * The key a user's revocation is kept under.
 *
 * Args:
 *   username (string): the username.
 *   type (string): local, ldap, azuread, oidc.
 *
 * Returns:
 *   string: "type/username".
 */
function userKey(username, type) {
  return `${type || "local"}/${username}`;
}

/**
 * Reads the revocations still in force.
 *
 * Returns:
 *   Promise<void>: settles once read ; a missing table leaves nothing revoked.
 */
async function load() {
  try {
    const mysql = await db();
    const rows = await mysql.do("SELECT `key`, revoked_before, UNIX_TIMESTAMP(expires_at) AS exp FROM AnsibleForms.`token_revocations` WHERE expires_at > NOW()");
    const s = new Map();
    const u = new Map();
    for (const r of rows || []) {
      if (String(r.key).startsWith("sid:")) s.set(String(r.key).slice(4), Number(r.exp) * 1000);
      else if (String(r.key).startsWith("user:")) u.set(String(r.key).slice(5), Number(r.revoked_before));
    }
    sessions = s;
    users = u;
  } catch (err) {
    logger.debug(`Could not read the token revocations : ${err.message || err}`);
  }
}

// another node revoked something : read the table again
let subscribed = false;
async function subscribe() {
  if (subscribed) return;
  subscribed = true;
  try {
    (await epochs()).onEpoch(EPOCH, () => {
      loaded = load();
      return loaded;
    });
  } catch (err) {
    logger.debug(`Could not follow the token revocations : ${err.message || err}`);
  }
}

/**
 * Whether a token is revoked : its session ended, or its user changed the password after it was
 * issued.
 *
 * Args:
 *   payload (object): the verified token payload ({ user, sid, iat }).
 *
 * Returns:
 *   Promise<boolean>: true when the token may no longer be used.
 */
/**
 * Reads the table once, before the first check or revocation of this process.
 *
 * Returns:
 *   Promise<void>: settles once read.
 */
function ensureLoaded() {
  if (!loaded) loaded = subscribe().then(load);
  return loaded;
}

export async function isRevoked(payload) {
  await ensureLoaded();
  const sid = payload?.sid;
  if (sid && sessions.has(sid) && sessions.get(sid) > Date.now()) return true;
  const before = users.get(userKey(payload?.user?.username, payload?.user?.type));
  // iat is in whole seconds : a token of the very second of the change is ended too, or one an
  // attacker obtained in that second would outlive it
  if (before && Number(payload?.iat || 0) <= before) return true;
  return false;
}

/**
 * Ends one session (a logout) until its tokens would have expired anyway.
 *
 * Args:
 *   sid (string): the session id.
 *   expiresAtMs (number): when its last token expires (ms).
 *
 * Returns:
 *   Promise<void>: settles once stored.
 */
export async function revokeSession(sid, expiresAtMs) {
  if (!sid) return;
  await ensureLoaded();
  const until = Math.max(Date.now() + 60000, Number(expiresAtMs) || 0);
  sessions.set(sid, until);
  const mysql = await db();
  await mysql.do(
    "INSERT INTO AnsibleForms.`token_revocations` (`key`, expires_at) VALUES (?, FROM_UNIXTIME(?)) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)",
    [`sid:${sid}`, Math.ceil(until / 1000)]
  );
  (await epochs()).bump(EPOCH);
}

/**
 * Ends every session of a user issued before now (a password change), for as long as the longest
 * token could live.
 *
 * Args:
 *   username (string): the username.
 *   type (string): local, ldap, azuread, oidc.
 *   maxLifetimeSeconds (number): the longest a token can live.
 *
 * Returns:
 *   Promise<void>: settles once stored.
 */
export async function revokeUser(username, type, maxLifetimeSeconds) {
  if (!username) return;
  await ensureLoaded();
  const key = userKey(username, type);
  const now = Math.floor(Date.now() / 1000);
  users.set(key, now);
  const mysql = await db();
  await mysql.do(
    "INSERT INTO AnsibleForms.`token_revocations` (`key`, revoked_before, expires_at) VALUES (?, ?, FROM_UNIXTIME(?)) " +
      "ON DUPLICATE KEY UPDATE revoked_before = VALUES(revoked_before), expires_at = VALUES(expires_at)",
    [`user:${key}`, now, now + Math.max(60, Number(maxLifetimeSeconds) || 0)]
  );
  (await epochs()).bump(EPOCH);
}

/**
 * Removes the revocations that no token can need any more.
 *
 * Returns:
 *   Promise<void>: settles once removed.
 */
export async function purgeRevocations() {
  const mysql = await db();
  await mysql.do("DELETE FROM AnsibleForms.`token_revocations` WHERE expires_at < NOW()").catch(() => {});
}

// tests only
export function resetRevocationsForTests() {
  sessions = new Map();
  users = new Map();
  loaded = null;
}

export default { newSessionId, isRevoked, revokeSession, revokeUser, purgeRevocations };
