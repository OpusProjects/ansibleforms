import mysql from './db.model.js';
import logger from '../lib/logger.js';

// The audit trail : who did what, when, and whether it worked.
//
// Append only at the API surface : there is no update or delete route, `audit` is not
// in crud.config.js, and the only thing that removes rows is the retention sweep. That
// is the point - a record you can edit is not evidence.
// Two caveats worth knowing rather than pretending away: a database RESTORE replaces the
// table wholesale (the dump contains DROP TABLE), and POST /api/v2/query runs arbitrary
// SQL against a named credential, so an install whose credential points at its own
// AnsibleForms database can reach this table that way.
//
// TWO RULES, both load bearing :
//
// 1. NEVER store secret material. This log records that a credential changed, not
//    what it changed to. Callers pass explicit, already-safe fields; `scrub` is the
//    second line of defence for when someone forgets. Never hand it a raw req.body.
// 2. NEVER break the caller. Auditing is observability, not a transaction : a full
//    disk must not turn a working request into a 500. Failures are logged loudly
//    instead, so a silently empty audit log is not a thing that can happen.
var Audit = function(){}

// Anything whose KEY looks like it holds a secret is dropped, at any depth. Value
// based detection is hopeless (a password can look like anything), so this is
// deliberately key based and deliberately greedy - a missing detail field is a
// cosmetic loss, a leaked credential is not.
// Derived from the actual column names in src/db/*.sql - password, mail_password,
// bind_user_pw, client_secret, token, refresh_token, ca_bundle, cert, private keys -
// plus the shapes a future column is likely to take. `pw` is matched only as a whole
// word segment so 'bind_user_pw' is caught without redacting anything containing
// those two letters.
// Separator-agnostic : header names arrive hyphenated (`x-api-key`, `set-cookie`) and
// object keys use underscores, so both count as word boundaries. `key` is matched as a
// whole word segment rather than anywhere, so `monkey` survives.
const SEP = '[_\\-.]';
const SECRET_KEY = new RegExp(
  'pass|pwd|(^|' + SEP + ')pw(' + SEP + '|$)|secret|token|credential|private|cert|bundle' +
  '|(^|' + SEP + ')keys?(' + SEP + '|$)|' + SEP + 'key$|^key$' +
  // authentication and session material, which is not a "password" by name
  '|^authoriz|^proxy-authoriz|cookie|bearer|(^|' + SEP + ')basic(' + SEP + '|$)|session|(^|' + SEP + ')sid(' + SEP + '|$)' +
  '|csrf|xsrf|nonce|(^|' + SEP + ')otp(' + SEP + '|$)|(^|' + SEP + ')mfa(' + SEP + '|$)|(^|' + SEP + ')pin(' + SEP + '|$)' +
  '|salt|signature|(^|' + SEP + ')sig(' + SEP + '|$)|(^|' + SEP + ')jwt(' + SEP + '|$)|(^|' + SEP + ')hash' +
  '|connstring|connectionstring|(^|' + SEP + ')dsn(' + SEP + '|$)|(^|' + SEP + ')gpg|(^|' + SEP + ')sas(' + SEP + '|$)' +
  // extravars are the single most secret-bearing field in this product
  '|extravars|extra_vars',
  'i'
);
// camelCase, matched CASE SENSITIVELY on purpose : 'apiKey' and 'sshToken' have to be
// caught, but a case-insensitive '[a-z]key$' would also redact 'monkey' and 'turkey'.
// NOT anchored at the end, so 'apiKeyValue' and 'tokenHeader' cannot slip past.
// also `^key[A-Z]` for 'keyMaterial' / 'keyData' - case sensitivity is what keeps
// 'keyboard' out of it.
const SECRET_KEY_CAMEL = /[a-z0-9](Keys?|Pass|Pwd|Secret|Token|Credential|Cert|Cookie|Session|Signature|Salt|Hash)|^key[A-Z]/;
function isSecretKey(key) {
  return SECRET_KEY.test(key) || SECRET_KEY_CAMEL.test(key);
}
const REDACTED = '[redacted]';
const MAX_DETAIL = 8000; // a detail blob is a summary, not a payload dump

function scrub(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return REDACTED; // runaway nesting, and cycles
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? REDACTED : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

function serializeDetail(detail) {
  if (detail === null || detail === undefined) return null;
  try {
    const text = JSON.stringify(scrub(detail));
    if (text === undefined) return null;
    return text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL) + '...[truncated]' : text;
  } catch (e) {
    // a cyclic or unserializable detail must not lose the whole entry
    logger.warning(`Audit detail could not be serialized : ${e.message || e}`);
    return null;
  }
}

// The subject of an entry. A cron task has no user, so actor stays null and
// actor_type becomes 'system' - which is itself worth being able to filter on.
function actorFrom(user) {
  if (!user) return { actor: null, actor_type: 'system' };
  return {
    actor: user.username || null,
    actor_type: user.type || 'local',
  };
}

/**
 * The address as an operator would write it.
 *
 * node listens dual-stack, so a client reaching it over IPv4 is reported as the IPv4-mapped
 * IPv6 address `::ffff:203.0.113.7`, while an address taken from X-Forwarded-For (TRUST_PROXY)
 * is plain `203.0.113.7`. The same client then appeared in two spellings depending on the
 * path it took. Only the mapped prefix in front of a dotted quad is removed ; anything else,
 * real IPv6 included, is kept as it is.
 *
 * @param {string|undefined|null} ip the address express reported (req.ip)
 * @returns {string|undefined|null} the same address, without the ::ffff: prefix
 */
function plainIp(ip) {
  if (typeof ip !== 'string') return ip;
  return ip.replace(/^::ffff:(?=\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$)/i, '');
}

/**
 * Record one event. Fire and forget : callers do not await this for correctness,
 * and it never throws.
 *
 * @param {object} entry
 * @param {object} [entry.user]        the acting user (req.user.user), omit for system
 * @param {string} entry.action        dotted verb, eg 'role.update', 'auth.login'
 * @param {string} [entry.outcome]     success | failure | denied   (default success)
 * @param {string} [entry.targetType]  eg 'role', 'credential', 'job'
 * @param {string} [entry.target]      name or id of the thing acted on
 * @param {string} [entry.ip]
 * @param {object} [entry.detail]      small structured summary, scrubbed before write
 */
Audit.log = async function (entry) {
  try {
    const { actor, actor_type } = actorFrom(entry.user);
    // EVERY column has to be clamped, not just the obvious ones. MySQL runs with
    // STRICT_TRANS_TABLES, so one over-long value fails the whole INSERT and the event
    // vanishes - which turns "log a 300 character username" into audit evasion.
    const clamp = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
    await mysql.do(
      'INSERT INTO AnsibleForms.`audit` (actor, actor_type, ip, action, target_type, target, outcome, detail) VALUES (?,?,?,?,?,?,?,?)',
      [
        clamp(actor, 255),
        clamp(actor_type, 20),
        clamp(plainIp(entry.ip), 45),
        clamp(entry.action || 'unknown', 64),
        clamp(entry.targetType, 64),
        clamp(entry.target, 255),
        clamp(entry.outcome || 'success', 16),
        serializeDetail(entry.detail),
      ]
    );
  } catch (e) {
    // loud, because an audit trail that quietly stopped recording is worse than
    // one that was never switched on
    // never re-stringify entry.action here : it may be the very thing that threw
    try {
      logger.error(`Failed to write an audit entry : ${e.message || e}`);
    } catch {
      // nothing left to do ; auditing must not escalate into an unhandled rejection
    }
  }
};

// Read side. Filters are all optional and combine with AND ; the caller gets a page
// plus the total so a table can paginate server side (the audit table is the one
// place in this app where loading every row is not an option).
Audit.find = async function (filter = {}) {
  // Query strings are not trustworthy input. `?actor=a&actor=b` arrives as an ARRAY,
  // which mysql2 escapes as `actor = 'a', 'b'` - a parse error, i.e. a 500 from a plain
  // url. Take the first value and stringify, so a hostile query is an empty result set
  // rather than an error page echoing the SQL back.
  const one = (v) => {
    const picked = Array.isArray(v) ? v[0] : v;
    return picked === undefined || picked === null || picked === '' ? null : String(picked);
  };
  // A date has to parse, or mysql raises ER_WRONG_VALUE. Anything unparsable is
  // ignored rather than 500ing. Sent as UTC 'YYYY-MM-DD HH:MM:SS' because created_at is
  // a zone-less DATETIME : passing an ISO string with a 'Z' makes mysql drop the zone
  // and read the value as server-local, silently shifting the filter.
  const when = (v) => {
    const raw = one(v);
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };

  const where = [];
  const vars = [];
  const actor = one(filter.actor);
  const action = one(filter.action);
  const targetType = one(filter.targetType);
  const target = one(filter.target);
  const outcome = one(filter.outcome);
  const from = when(filter.from);
  const to = when(filter.to);
  if (actor) { where.push('actor = ?'); vars.push(actor); }
  if (action) { where.push('action = ?'); vars.push(action); }
  if (targetType) { where.push('target_type = ?'); vars.push(targetType); }
  if (target) { where.push('target LIKE ?'); vars.push(`%${target}%`); }
  if (outcome) { where.push('outcome = ?'); vars.push(outcome); }
  if (from) { where.push('created_at >= ?'); vars.push(from); }
  if (to) { where.push('created_at <= ?'); vars.push(to); }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const limit = Math.min(Math.max(parseInt(one(filter.limit), 10) || 100, 1), 1000);
  // an offset needs a CEILING as well as a floor : parseInt('9'.repeat(20)) is 1e20,
  // which renders in exponential notation and is a parse error, and a huge-but-valid
  // offset is a deep table scan on the one table designed to grow without bound
  const MAX_OFFSET = 1000000;
  const rawOffset = parseInt(one(filter.offset), 10);
  const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(rawOffset, 0), MAX_OFFSET) : 0;

  const counted = await mysql.do('SELECT COUNT(*) AS total FROM AnsibleForms.`audit`' + clause, vars);
  const records = await mysql.do(
    'SELECT id, created_at, actor, actor_type, ip, action, target_type, target, outcome, detail ' +
    'FROM AnsibleForms.`audit`' + clause + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [...vars, limit, offset]
  );
  return {
    total: counted[0]?.total || 0,
    limit,
    offset,
    // detail is stored as text ; hand the caller the object it passed in
    records: records.map((r) => ({ ...r, detail: r.detail ? safeParse(r.detail) : null })),
  };
};

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

// The distinct actions and actors present, so a filter dropdown does not have to be
// a hardcoded list that drifts from what is actually recorded.
Audit.facets = async function () {
  const actions = await mysql.do('SELECT DISTINCT action FROM AnsibleForms.`audit` ORDER BY action');
  const actors = await mysql.do('SELECT DISTINCT actor FROM AnsibleForms.`audit` WHERE actor IS NOT NULL ORDER BY actor');
  return {
    actions: actions.map((r) => r.action),
    actors: actors.map((r) => r.actor),
  };
};

// Retention. Shipped with the feature rather than after it, because an append-only
// table with no sweep is the same unbounded-growth bug that job_output already has.
Audit.removeOlderThan = async function (days, batchSize = 5000) {
  const keep = parseInt(days, 10);
  if (!keep || keep < 1) return 0;
  // batched : on a table sized as this one is meant to be, one unbounded DELETE is a
  // single huge transaction that blocks every audit write while it runs
  var removed = 0;
  for (;;) {
    const res = await mysql.do(
      'DELETE FROM AnsibleForms.`audit` WHERE created_at < (NOW() - INTERVAL ? DAY) LIMIT ?',
      [keep, batchSize]
    );
    const n = res?.affectedRows || 0;
    removed += n;
    // `n < batchSize` alone spins for ever when batchSize is 0 (0 < 0 is false), so a
    // fruitless batch also ends the loop - matching Job.removeOlderThan
    if (n === 0 || n < batchSize) break;
  }
  return removed;
};

// exported for tests : the scrubber is the security property of this module
Audit._scrub = scrub;

export default Audit;
