import RestResult from "../models/restResult.model.v2.js";
import i18n from "./i18n.js";

var Middleware = function(){

}

// Build a route guard for a single permission.
//
// The status code matters more than it looks : the client has ONE global axios
// interceptor for 401 (App.vue), which means "your token is no good" - it clears
// the token storage and bounces you to the login page. A permission failure is
// not that. The user IS authenticated, they simply may not have this endpoint,
// and a page that calls it opportunistically (the designer probing settings, an
// admin table loading its lookups) must be able to catch the error and carry on.
// Answering 401 there logged the user straight out instead, and in a non-english
// locale - where the message no longer matched the interceptor's english test -
// it fell through to the refresh branch, refreshed successfully (the token was
// always valid), retried, got 401 again, and looped.
//
// So : 403 when we know who you are and you may not do this, 401 only when we
// could not establish who you are at all (req.user missing or malformed, which
// authobj should already have rejected - this is the defensive path).
function permissionGuard(hasPermission, detailKey){
  return (req, res, next) => {
    try {
      if (!hasPermission(req.user.user)) {
        res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), i18n.t(req, detailKey)));
      } else {
        next();
      }
    } catch (e) {
      res.status(401).json(RestResult.error(i18n.t(req, 'errors.noAccess'), i18n.t(req, detailKey)));
    }
  }
}

// a middleware in the routes to check if use is administrator
Middleware.checkAdminMiddleware = permissionGuard(u => u.roles.includes("admin"), 'errors.notAdmin')

Middleware.checkSettingsMiddleware = permissionGuard(u => u.options.showSettings, 'errors.noSettingsAccess')

Middleware.checkDesignerMiddleware = permissionGuard(u => u.options.showDesigner, 'errors.noDesignerAccess')

Middleware.checkLogsMiddleware = permissionGuard(u => u.options.showLogs, 'errors.noLogsAccess')

Middleware.checkBackupMiddleware = permissionGuard(u => u.options.allowBackupOps, 'errors.noDatabaseAccess')

Middleware.checkScheduledJobsMiddleware = permissionGuard(u => u.options.allowScheduledJobs, 'errors.noScheduleAccess')

// The /api/v2/schedule mount. "Run later (one-time)" on a form is offered to
// allowPlannedJobs (on for everyone by default), and it creates a one-time schedule -
// but the whole mount used to sit behind allowScheduledJobs (admin-only by default), so
// every non-admin who pressed it got "You do not have permission to manage scheduled jobs".
//
// allowScheduledJobs stays what it was : the admin-level right to see and change ALL
// schedules. allowPlannedJobs on its own opens exactly ONE door, POST / (create), and the
// controller then narrows that to a one-time run of a form the user may run, which runs
// as that user rather than as admin (Schedule.plan). Listing, reading, editing, deleting
// and launching stay refused, so a planner never sees anybody else's schedules.
Middleware.checkScheduleOrPlannedJobsMiddleware = (req, res, next) => {
  try {
    const user = req.user.user;
    if (user.options.allowScheduledJobs) return next();
    if (user.options.allowPlannedJobs && req.method === 'POST' && req.path === '/') return next();
    res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), i18n.t(req, 'errors.noScheduleAccess')));
  } catch (e) {
    // same 401-vs-403 rule as permissionGuard : 401 only when we cannot tell who you are
    res.status(401).json(RestResult.error(i18n.t(req, 'errors.noAccess'), i18n.t(req, 'errors.noScheduleAccess')));
  }
}

Middleware.checkStoredJobsMiddleware = permissionGuard(u => u.options.allowStoredJobs, 'errors.noStoredJobsAccess')
Middleware.checkChatMiddleware = permissionGuard(u => u.options.allowChat !== false, 'errors.noChatAccess')

// The schedules page is gated on allowScheduledJobs rather than showSettings, but
// its form dropdown reads config/formnames - a list that is deliberately NOT role
// filtered (unlike config/formlist), so it has to stay behind a permission.
// Either administrative right is enough to see it.
Middleware.checkSettingsOrScheduledJobsMiddleware = permissionGuard(
  u => u.options.showSettings || u.options.allowScheduledJobs, 'errors.noSettingsAccess')

export default Middleware
