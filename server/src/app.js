import './load-env.js'; // load the .env file if not in production => must be the first import
// Node.js core modules
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Third-party modules
import session from "cookie-session";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { jsonBody, urlencodedBody } from "./lib/bodyParsers.js";
import { applyTrustProxy } from "./lib/trustProxy.js";
import passport from "passport";

// App configuration and utilities
import Middleware from "./lib/middleware.js";
import { authRateLimit } from "./lib/authRateLimit.js";
import { cspDirectives } from "./lib/csp.js";
import authConfig from "../config/auth.config.js";
import logger from "./lib/logger.js";
import appConfig from "../config/app.config.js";

// Authentication strategies
import auth_azuread from "./auth/auth_azuread.js";
import auth_oidc from "./auth/auth_oidc.js";
import "./auth/auth_basic.js";
import "./auth/auth_jwt.js";

// API route handlers
// V1 routes (DEPRECATED - not following REST standards)

// V2 routes (CURRENT - REST standards compliant)
import queryRoutesv2 from "./routes/v2/query.routes.js";
import expressionRoutesv2 from "./routes/v2/expression.routes.js";
import versionRoutes from "./routes/v2/version.routes.js";
import profileRoutesv2 from "./routes/v2/profile.routes.js";
import userRoutesv2 from "./routes/v2/user.routes.js";
import schemaRoutes from "./routes/v2/schema.routes.js";
import lockRoutes from "./routes/v2/lock.routes.js";
import loginRoutesv2 from "./routes/v2/login.routes.js";
import tokenRoutesv2 from "./routes/v2/token.routes.js";
import jobRoutesv2 from "./routes/v2/job.routes.js";
import ldapRoutes from "./routes/v2/ldap.routes.js";
import chatSettingsRoutes from "./routes/v2/chatSettings.routes.js";
import chatRoutes from "./chat/router.js";
import oauth2Routes from "./routes/v2/oauth2.routes.js";
import credentialRoutesv2 from "./routes/v2/credential.routes.js";
import secretStoreRoutesv2 from "./routes/v2/secretStore.routes.js";
import runnerRoutesv2 from "./routes/v2/runner.routes.js";
import mailServerRoutesv2 from "./routes/v2/mailServer.routes.js";
import eventsRoutesv2 from "./routes/v2/events.routes.js";
import knownhostsRoutes from "./routes/v2/knownhosts.routes.js";
import scheduleRoutes from "./routes/v2/schedule.routes.js";
import storedJobsRoutes from "./routes/v2/stored-jobs.routes.js";
import appRoutes from "./routes/v2/app.routes.js";
import backupRoutes from "./routes/v2/backup.routes.js";
import groupRoutesv2 from "./routes/v2/group.routes.js";
import settingsRoutesv2 from "./routes/v2/settings.routes.js";
import healthRoutesv2 from "./routes/v2/health.routes.js";
import auditRoutesv2 from "./routes/v2/audit.routes.js";
import auditMiddleware from "./lib/auditMiddleware.js";
import logoRoutesv2 from "./routes/v2/logo.routes.js";
import sshRoutesv2 from "./routes/v2/ssh.routes.js";
import logRoutesv2 from "./routes/v2/log.routes.js";
import repositoryRoutesv2 from "./routes/v2/repository.routes.js";
import configRoutesv2 from "./routes/v2/config.routes.js";
import configSeedRoutesv2 from "./routes/v2/configseed.routes.js";
import formsReposRoutes from "./routes/v2/forms-repos.routes.js";
import mcpRoutes from "./mcp/router.js";

// __dirname and __filename setup for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const swaggerDocumentV2 = JSON.parse(fs.readFileSync(path.join(__dirname, "swagger_v2.json"), "utf8"));

// a small custom middleware to check whether the user has access to routes

// start the app
const load = async (app) => {
  // the database and the worker's bootstrap come first (app-start.js)
  await auth_azuread.initialize(); // we wait for the azuread to be ready
  await auth_oidc.initialize(); // we wait for the oidc to be ready

  // which address req.ip - and so every audit row - names : the connection's peer unless
  // TRUST_PROXY says which reverse proxies may report the client in X-Forwarded-For.
  // Set on this app, not on the one index.js wraps it in for BASE_URL : req.ip asks the app
  // handling the request, and with a base url that is still this one (see lib/trustProxy.js)
  applyTrustProxy(app);

  // security headers with helmet, the Content-Security-Policy included (lib/csp.js) : scripts
  // from the app only, no framing by another site. CONTENT_SECURITY_POLICY=0 sends it report
  // only : the browser says what it would block, and blocks nothing.
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives(), reportOnly: !appConfig.contentSecurityPolicy },
    crossOriginEmbedderPolicy: false // allow embedding if needed
  }));

  // passport : the session only carries an SSO login's state, nonce and PKCE verifier across the
  // round trip to the provider. Signed with the app's own secret - a constant known to all let
  // anybody forge it - http only, and not sent along on another site's requests.
  app.use(
    session({
      name: "af_session",
      secret: authConfig.secret,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // register regenerate & save after the cookieSession middleware initialization
  app.use(function (request, response, next) {
    if (request.session && !request.session.regenerate) {
      request.session.regenerate = (cb) => {
        cb();
      };
    }
    if (request.session && !request.session.save) {
      request.session.save = (cb) => {
        cb();
      };
    }
    next();
  });

  // Body size caps. Generous defaults to accommodate large form designs and
  // job extravars; configurable via API_BODY_LIMIT_MB. File uploads have their
  // own limit (UPLOAD_MAX_GB) enforced by multer in upload.controller.js.
  // installed once ; the limit behind them is rebuilt when API_BODY_LIMIT_MB changes, so it
  // needs no restart (see lib/bodyParsers.js)
  app.use(jsonBody);
  app.use(urlencodedBody);

  // mysql2 has a bug that can throw an uncaught exception if the mysql server crashes (not enough mem for example)
  // also git commands can chain child processes and cause issues
  process.on("uncaughtException", function (err) {
    logger.error("Uncaught exception: ", err);
  });

  process.on("unhandledRejection", function (reason) {
    logger.error("Unhandled promise rejection: ", reason);
  });

  // using json web tokens as middleware
  // the jwtauthentication strategy from passport (/auth/auth.js)
  // is used as a middleware.  Every route will check the token for validity
  // the token, then the gate of a user who still has the default password : every
  // authenticated route mounts both
  const authobj = [passport.authenticate("jwt", { session: false }), Middleware.passwordChangeGate];

  // api docs for v1 and v2
  // note : the swagger paths must include the base url (subpath hosting, issue #106)
  const swaggerOptions = {
    customSiteTitle: "Ansibleforms Swagger UI",
    customfavIcon: `${appConfig.baseUrl}/favicon.svg`,
    docExpansion: "none",
  };
  // v2 docs
  swaggerDocumentV2.basePath = `${appConfig.baseUrl}/api/v2`;
  app.use(`/api/v2/docs`, cors(), swaggerUi.serveFiles(swaggerDocumentV2, swaggerOptions), swaggerUi.setup(swaggerDocumentV2, swaggerOptions));

  // Audit every state-changing api request. Mounted BEFORE the route guards on
  // purpose : it only registers a res.on('finish') handler, which reads req.user
  // lazily once the response is known - so an authenticated actor is still
  // attributed, while a request refused by authobj or a permission guard is
  // recorded as 'denied' instead of vanishing before any model is reached.
  app.use(`/api`, auditMiddleware);

  // ========== V2 API Routes (CURRENT) ==========
  
  // api routes for querying
  app.use(`/api/v2/query`, cors(), authobj, Middleware.resourceScope, queryRoutesv2);
  app.use(`/api/v2/expression`, cors(), authobj, Middleware.resourceScope, expressionRoutesv2);

  // api route for version (no auth)
  app.use(`/api/v2/version`, cors(), versionRoutes);

  // api route for profile
  app.use(`/api/v2/profile`, cors(), authobj, profileRoutesv2);

  // schema route : GET is public, POST guards itself (open only while the database
  // has no accounts to authenticate against, admin-only afterwards - see the routes)
  app.use(`/api/v2/schema`, cors(), schemaRoutes);

  // lock route
  app.use(`/api/v2/lock`, cors(), authobj, lockRoutes);

  // api routes for authorization
  // a ceiling per address before anything else (lib/authRateLimit.js) ; the account lockout
  // is lib/loginThrottle.js
  const authLimiter = authRateLimit();
  app.use(`/api/v2/auth`, cors(), authLimiter, loginRoutesv2);
  app.use(`/api/v2/token`, cors(), authLimiter, tokenRoutesv2);

  // api routes for the vue3 app
  app.use(`/api/v2/app`, cors(), appRoutes);

  // api routes for admin management
  app.use(`/api/v2/job`, cors(), authobj, Middleware.resourceScope, jobRoutesv2);
  // what changes, as it changes (lib/liveEvents.js) : every signed-in user, names only
  app.use(`/api/v2/events`, cors(), authobj, eventsRoutesv2);
  app.use(`/api/v2/user`, cors(), authobj, Middleware.checkSettingsMiddleware, userRoutesv2);
  app.use(`/api/v2/group`, cors(), authobj, Middleware.checkSettingsMiddleware, groupRoutesv2);
  app.use(`/api/v2/settings`, cors(), authobj, Middleware.checkSettingsMiddleware, settingsRoutesv2);
  app.use(`/api/v2/health`, cors(), authobj, Middleware.checkSettingsMiddleware, healthRoutesv2);
  app.use(`/api/v2/audit`, cors(), authobj, Middleware.checkSettingsMiddleware, auditRoutesv2);
  // custom logo ; reading is public (header and login page), changing it is guarded in the routes
  app.use(`/api/v2/logo`, cors(), logoRoutesv2);
  app.use(`/api/v2/sshkey`, cors(), authobj, Middleware.checkSettingsMiddleware, sshRoutesv2);
  app.use(`/api/v2/ldap`, cors(), authobj, Middleware.checkSettingsMiddleware, ldapRoutes);
  app.use(`/api/v2/chatsettings`, cors(), authobj, Middleware.checkSettingsMiddleware, chatSettingsRoutes);
  app.use(`/api/v2/oauth2`, cors(), authobj, Middleware.checkSettingsMiddleware, oauth2Routes);
  app.use(`/api/v2/credential`, cors(), authobj, Middleware.checkSettingsMiddleware, credentialRoutesv2);
  app.use(`/api/v2/secretstore`, cors(), authobj, Middleware.checkSettingsMiddleware, secretStoreRoutesv2);
  app.use(`/api/v2/runner`, cors(), authobj, Middleware.checkSettingsMiddleware, runnerRoutesv2);
  app.use(`/api/v2/mailserver`, cors(), authobj, Middleware.checkSettingsMiddleware, mailServerRoutesv2);
  app.use(`/api/v2/knownhosts`, cors(), authobj, Middleware.checkSettingsMiddleware, knownhostsRoutes);
  // allowScheduledJobs for everything ; allowPlannedJobs only for creating a one-time run
  app.use(`/api/v2/schedule`, cors(), authobj, Middleware.checkScheduleOrPlannedJobsMiddleware, Middleware.resourceScope, scheduleRoutes);
  app.use(`/api/v2/stored-jobs`, cors(), authobj, Middleware.checkStoredJobsMiddleware, storedJobsRoutes);

  // backup/restore/list routes
  app.use(`/api/v2/backup`, cors(), authobj, backupRoutes);
  app.use(`/api/v2/log`, cors(), authobj, Middleware.checkLogsMiddleware, logRoutesv2);
  app.use(`/api/v2/repository`, cors(), authobj, Middleware.checkSettingsMiddleware, repositoryRoutesv2);
  // forms repositories (issue #414) : designer users can push without settings access
  app.use(`/api/v2/forms-repos`, cors(), authobj, Middleware.checkDesignerMiddleware, formsReposRoutes);
  app.use(`/api/v2/config`, cors(), authobj, configRoutesv2);
  // separate mount from /config on purpose : the seed is not the forms configuration and
  // does not share its permissions - this one is settings admin, like the pages it rewrites
  app.use(`/api/v2/config-seed`, cors(), authobj, Middleware.checkSettingsMiddleware, configSeedRoutesv2);

  // An AI feature is always mounted, behind a gate that reads its switch per request :
  // turning it on or off from the settings takes effect at once (envSettings.js), no
  // restart. Off, the endpoint answers 404 as if it were not there.
  const featureOn = (key) => (req, res, next) => (appConfig[key] ? next() : res.status(404).json({ error: 'Not found' }));

  // MCP server for AI agents (ENABLE_MCP) : every tool runs as the authenticated user, whose
  // roles must allow the MCP server (allowMcp)
  app.use(`/api/v2/mcp`, featureOn('enableMcp'), cors(), authobj, Middleware.checkMcpMiddleware, Middleware.resourceScope, mcpRoutes);
  if (appConfig.enableMcp) logger.notice(`MCP endpoint enabled on ${appConfig.baseUrl}/api/v2/mcp`);

  // The chat assistant (ENABLE_CHAT) : the same form service as the MCP server, in
  // process, as the authenticated user ; the allowChat role option may switch it off
  app.use('/api/v2/chat', featureOn('enableChat'), cors(), authobj, Middleware.checkChatMiddleware, Middleware.resourceScope, chatRoutes);
  if (appConfig.enableChat) logger.notice("Chat assistant enabled on /api/v2/chat");

}


export default {
  load
}
