import Audit from '../models/audit.model.js';
import mysql from '../models/db.model.js';
import crudConfigs from '../../config/crud.config.js';

// Blanket auditing for state-changing HTTP requests.
//
// This is mounted once and covers every non-GET v2 request, which buys two things
// that per-model calls do not :
//
//  - DENIED attempts. A 401/403 never reaches a model, so an explicit Audit.log()
//    in the model can never record it - yet "someone repeatedly tried to change
//    roles and was refused" is the single most useful line in a security review.
//  - No blind spots as routes are added. A new endpoint is audited the day it
//    exists, without anyone remembering to instrument it.
//
// Models still log their own semantic events on top of this (an option delta, an
// approval) where the interesting part is WHAT changed, which only they know.

// GETs are reads : auditing them would bury the mutations in noise. The polling
// endpoints alone would produce thousands of rows an hour.
const AUDITED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Login is deliberately excluded : the login controller logs it itself, with the
// attempted username, which this layer cannot see (there is no req.user yet on a
// failed attempt, so every failure would be an anonymous 'auth.login' with no
// indication of who was tried).
const SKIP = [/^\/api\/v\d+\/auth\//, /^\/api\/v\d+\/token/];

// '/api/v2/settings/config' -> 'settings.config'. Route PARAMETERS are dropped so that
// 'user.42' and 'user.43' collapse into one action and the id lands in `target`, where it
// can be filtered on.
//
// Pass the matched route pattern ('/:name/pull/') rather than the concrete path when one
// is available. The id-ish fallback below only recognises numeric and hex segments, so
// 'POST /repository/myrepo/pull' used to be recorded as 'repository.myrepo.pull.create' -
// a distinct action per repository, which filled the facets dropdown with junk and made
// the action column impossible to aggregate or filter on. Named parameters are common
// here (:name, :folder, :backupName), so this was not an edge case.
/**
 * @param {boolean} routeMatched Whether express actually dispatched to a route handler
 *   (i.e. `req.route` was set). When it did NOT - an app-level guard such as `authobj`
 *   or checkSettingsMiddleware refused before routing - every path segment after the
 *   resource is CALLER CONTROLLED, and must not reach the action.
 *
 *   That was the 404 guard's hole. A 404 is skipped precisely so an unauthenticated
 *   caller cannot write one row per request with an action of its own choosing, but
 *   `DELETE /api/v2/repository/<anything>` answers 401, not 404 - so it wrote
 *   `repository.<anything>.delete`. `Audit.facets` is an unbounded SELECT DISTINCT
 *   action feeding the admin's filter dropdown, so that is both an anti-forensics
 *   flood and unbounded junk in the UI. Keeping only the resource segment bounds the
 *   vocabulary to the mount list: a path that matches no mount 404s and is skipped.
 */
function actionFrom(baseUrl, path, method, routeMatched = true) {
  const full = (baseUrl || '') + (path || '');
  let parts = full
    .replace(/^\/api\/v\d+\//, '')
    .split('/')
    .filter(Boolean)
    // ':name' - an express parameter, present when the caller passed the route pattern
    .filter((p) => !p.startsWith(':'))
    .filter((p) => !/^\d+$/.test(p) && !/^[0-9a-f-]{16,}$/i.test(p));
  if (!routeMatched) parts = parts.slice(0, 1);
  const verb = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] || method.toLowerCase();
  return (parts.join('.') || 'unknown') + '.' + verb;
}

// What the action was performed ON. With the route pattern in hand the parameter's value
// is read positionally, which works for a name as well as an id - req.params is not used
// because express may have restored it by the time the response settles.
function targetFrom(path, routePath, baseUrl) {
  const segments = (path || '').split('/').filter(Boolean);
  if (routePath) {
    const pattern = String(routePath).split('/').filter(Boolean);
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':') && segments[i]) return segments[i];
    }
  }
  // No pattern. Either the path matched no route at all, or an app-level guard refused
  // before routing - and in the second case the row is about something real, so naming
  // what was attempted matters ("refused to delete WHICH repository"). These segments are
  // caller controlled, which is fine for `target`: it is data, clamped to 255 by Audit.log
  // and never used as a facet, unlike `action`.
  // The FULL path, rebuilt from baseUrl + path. `path` alone is MOUNT-RELATIVE whenever
  // an app-level guard refuses: express strips the mount prefix before running the
  // handlers and only restores it inside next(), which a guard answering 403 never
  // calls. So for DELETE /api/v2/repository/myrepo this saw ['myrepo'], slice(3) was
  // empty, and the fallback below rejects a non-numeric segment - meaning `target` was
  // null on exactly the rows this branch exists to name ("refused to delete WHICH
  // repository"). Verified: at finish time baseUrl is '/api/v2/repository' and path is
  // '/myrepo'. The routed case is unaffected, because there `path` and `routePath` are
  // both router-relative and the positional match above already handled it.
  const full = ((baseUrl || '') + (path || '')).split('/').filter(Boolean);
  const tail = full.slice(3).join('/');   // drop 'api', 'vN', and the resource
  if (tail) return tail;
  const last = segments[segments.length - 1];
  return last && (/^\d+$/.test(last) || /^[0-9a-f-]{16,}$/i.test(last)) ? last : null;
}

// The identifying field of a CREATE, read from the body by an explicit ALLOWLIST of key
// names - never the body itself, and never a key merely because it looks harmless.
//
// A collection-level POST (`POST /api/v2/user`, `/group`, `/repository`) carries no :param,
// so targetFrom had nothing positional to read and every create was recorded with a blank
// target - the single most common gap in the table, and exactly the rows where "who created
// WHAT" is the question being asked.
//
// The allowlist is the whole safety argument, so keep it to fields that NAME a thing:
//   - `expression` and `query` are deliberately absent : they are user data, and a raw query
//     can carry values that key-based scrubbing cannot see (the same reason pathOnly drops
//     the query string).
//   - `password`, tokens and the rest can never be reached, because a key is only read when
//     it appears here.
// Only a short scalar is accepted, so an object or an array under one of these names cannot
// smuggle a document in; Audit.log clamps to the column width as a second line of defence.
const TARGET_BODY_KEYS = ['name', 'username', 'formName', 'folder', 'backupName', 'repository', 'datasource', 'title'];

function targetFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of TARGET_BODY_KEYS) {
    const v = body[key];
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).trim();
      if (s && s.length <= 255) return s;
    }
  }
  return null;
}

// Last resort, so that no row is ever written with a blank target: the resource the action
// is about. `POST /api/v2/expression` has no identifier to name - the thing being acted on
// IS the expression endpoint - and 'expression' is a truthful answer where null was simply
// a hole in the table. Derived from the mount, so it needs no list to maintain.
function resourceFrom(baseUrl, path) {
  const segments = ((baseUrl || '') + (path || '')).split('/').filter(Boolean);
  // drop 'api' and 'vN'; the first remaining segment is the resource
  const rest = segments[0] === 'api' ? segments.slice(2) : segments;
  return rest[0] || null;
}

// The NAME of the record an id points at, so an update or a delete of an SSO provider, a user,
// a group... is recorded as 'Contoso Entra ID' rather than '5'. Read BEFORE the handler runs : a
// delete has removed the row by the time the response settles. The api resource maps to its
// crud.config entry (its table and its natural key field) ; a resource without one keeps the id.
const RESOURCE_TABLES = {
  user: 'users',
  group: 'groups',
  repository: 'repositories',
  'stored-jobs': 'stored_jobs',
};

/**
 * Starts reading the name of the record an update or a delete is about.
 *
 * Args:
 *   method (string): the request's method.
 *   originalUrl (string): the request's url.
 *
 * Returns:
 *   Promise<string|null>|null: the name (null when there is none), or null when the request
 *     names no record by its id.
 */
function nameLookup(method, originalUrl) {
  if (!['PUT', 'PATCH', 'DELETE'].includes(method)) return null;
  const segments = pathOnly(originalUrl).split('/').filter(Boolean);
  if (segments[0] !== 'api' || !/^\d+$/.test(segments[3] || '')) return null;
  const crud = crudConfigs[RESOURCE_TABLES[segments[2]] || segments[2]];
  const field = crud?.fields?.find((f) => f.isNaturalKey)?.name || (crud?.fields?.some((f) => f.name === 'name') ? 'name' : null);
  if (!crud?.table || !field) return null;
  return mysql
    .do(`SELECT \`${field}\` AS n FROM ${crud.table} WHERE id=?`, [segments[3]])
    .then((rows) => (rows && rows[0] && rows[0].n != null ? String(rows[0].n) : null))
    .catch(() => null);
}

function outcomeFor(status) {
  if (status === 401 || status === 403) return 'denied';
  return status >= 400 ? 'failure' : 'success';
}

// Only the PATH. A query string can carry a credential (`?token=...`), and key-based
// scrubbing cannot help with a secret that arrives inside a value - so the query is
// dropped rather than recorded. Filters and ids that matter are already captured in
// `action` and `target`.
function pathOnly(originalUrl) {
  const url = String(originalUrl || '');
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

const auditMiddleware = function (req, res, next) {
  if (!AUDITED_METHODS.includes(req.method) || SKIP.some((re) => re.test(req.originalUrl || ''))) {
    return next();
  }
  // Recorded once the response is settled, so the outcome is real rather than assumed.
  //
  // BOTH events are needed. 'finish' fires on a normal response; a client that hangs up
  // mid-request emits 'close' WITHOUT 'finish', and the handler has usually already
  // performed its mutation by then - so listening only on 'finish' let any caller
  // suppress the record of its own state change by aborting. `done` keeps it to one row.
  var done = false;
  // the record's name, read now : a delete removes it before the response settles
  const named = nameLookup(req.method, req.originalUrl);
  const record = (aborted) => {
    if (done) return;
    done = true;
    const status = res.statusCode;
    // An unrouted path still reaches this middleware, so an unauthenticated client could
    // otherwise write one row per request with an action of its own choosing - an
    // anti-forensics flood, and unbounded junk in Audit.facets. A 404 changed nothing,
    // so there is nothing to audit.
    if (!aborted && status === 404) return;
    Promise.resolve(named).then((name) => Audit.log({
      user: req.user?.user,
      ip: req.ip,
      // req.route is NOT set while this middleware runs (it is mounted before routing),
      // but it is by the time the response settles - which is why the record is written
      // here rather than up front.
      action: actionFrom(req.baseUrl, req.route?.path || req.path, req.method, !!req.route),
      // positional :param first (the object is named in the URL), then the body's
      // identifying field for a collection-level create, then the resource itself - so a
      // row is never written without saying what it was about
      target: name
        || targetFrom(req.path, req.route?.path, req.baseUrl)
        || targetFromBody(req.body)
        || resourceFrom(req.baseUrl, req.path),
      // an aborted request is recorded as a failure : the mutation may well have run,
      // but the client never accepted the answer
      outcome: aborted ? 'failure' : outcomeFor(status),
      // NEVER the body : it carries passwords, tokens and whole config documents.
      // NEVER the query string either (see pathOnly). Method, path and status are the
      // safe summary ; a model that wants to say more logs its own entry.
      detail: aborted
        ? { method: req.method, url: pathOnly(req.originalUrl), aborted: true }
        : { method: req.method, url: pathOnly(req.originalUrl), status },
    }));
  };
  res.on('finish', () => record(false));
  res.on('close', () => record(!res.writableFinished));
  return next();
};

export default auditMiddleware;
export { actionFrom, targetFrom, targetFromBody, resourceFrom, outcomeFor, pathOnly };
