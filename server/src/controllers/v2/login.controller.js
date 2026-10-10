'use strict';
import User from "../../models/user.model.js";
import Token from "../../models/token.model.js";
import AzureAd from "../../models/azureAd.model.js";
import OIDC from "../../models/oidc.model.js";
import passport from 'passport';
import jwt from 'jsonwebtoken';
import authConfig from '../../../config/auth.config.js';
import appConfig from '../../../config/app.config.js';
import logger from "../../lib/logger.js";
import helpers from '../../lib/common.js';
import { signHandoff, openToken } from '../../lib/ssoHandoff.js';
import { fetchAzureGroups, filterGroups } from '../../lib/azureGraph.js';
import RestResult from "../../models/restResult.model.v2.js";
import auth_oidc from "../../auth/auth_oidc.js";
import { isSingleTenant } from "../../auth/auth_azuread.js";
import i18n from "../../lib/i18n.js";
import Audit from "../../models/audit.model.js";
import { claimsDisplayName } from "../../lib/displayName.js";
import { loginBlocked, loginFailed, loginSucceeded } from "../../lib/loginThrottle.js";
import { newSessionId, revokeSession, consumeOnce } from "../../lib/tokenRevocation.js";

// Login is audited here rather than by the blanket middleware, which deliberately
// skips /auth : on a failed attempt there is no req.user, so that layer could only
// record an anonymous 'auth.login' - and a failed-login trail that does not say
// WHICH account was tried is of no use to anyone. The actor is the attempted
// username, which is the honest answer for both outcomes.
// Fire and forget : never let this delay or break a login.
//
// The credentials arrive as an http Basic header, not a json body (see
// client/src/pages/login.vue), so the attempted username has to be decoded from it
// - req.body is empty on every login. Only the half before the colon is ever read;
// the password half is never assigned to anything.
function attemptedUsername(req) {
  const header = req.headers?.authorization || '';
  const m = /^Basic\s+(.+)$/i.exec(header.trim());
  if (m) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const name = sep >= 0 ? decoded.slice(0, sep) : decoded;
      if (name) return name;
    } catch {
      // an unparsable header is still an attempt worth recording, just anonymously
    }
  }
  // other clients may post a body instead
  return req.body?.username || null;
}

function auditLogin(req, outcome, type, reason, resolvedUsername) {
  // on success the resolved account is authoritative (it may differ in case from
  // whatever was typed) ; on failure the attempted name is all there is
  const username = resolvedUsername || attemptedUsername(req);
  Audit.log({
    user: username ? { username, type: type || 'unknown' } : null,
    ip: req.ip,
    action: 'auth.login',
    outcome,
    targetType: 'user',
    target: username,
    detail: reason ? { reason } : null,
  });
}

function hasValidLoginOption(user) {
  if(user.options.allowLogin === false) {
    logger.warning(`Login is disabled for user '${user.username}' in the configuration (allowLogin option is set to false), please check your settings`)
    return false;
  } 
  return true;
}

function userToJwt(user,expiryDays){

  // is something like
  // {"username":"administrator","type":"local","roles":["public","admin"]}

  var tokenExpiresIn

  if(expiryDays && (user?.options["extendedTokenExpiration"] ?? false) && !isNaN(expiryDays)){  
    // bounded : an api token lives API_TOKEN_MAX_DAYS at most, and a password change or a
    // logout of its session ends it sooner (lib/tokenRevocation.js)
    const days = Math.min(Math.max(1, Math.floor(Number(expiryDays))), authConfig.apiTokenMaxDays)
    tokenExpiresIn = `${days}d`
    logger.info(`Extended token expiration (${days} days) requested for ${user.username}`)
  }else{
    tokenExpiresIn = authConfig.jwtExpiration
  }

  // we create 2 jwt tokens (accesstoken and refresh token)
  // the session : both tokens and every refresh of them carry it, so a logout ends them all
  const sid = newSessionId()
  const token = jwt.sign({user,access:true,sid}, authConfig.secret,{ expiresIn: tokenExpiresIn, issuer: authConfig.jwtIssuer});
  const refreshtoken = jwt.sign({user,refresh:true,sid}, authConfig.secret,{ expiresIn: authConfig.jwtRefreshExpiration, issuer: authConfig.jwtIssuer});
  logger.debug(JSON.stringify(user))
  // we store the tokens in the database, to later verify a refresh token action
  logger.info("Storing refreshtoken in database for user " + user.username)
  Token.store(user.username,user.type,refreshtoken,function(err,result){
    if(err){
      logger.error("Failed to store token. ",err)
    }else{
      logger.info(result)
    }
  })
  return {
    token: token,
    refreshtoken: refreshtoken
  }
}
// get login settings
const settings = async function(req, res) {
  try {
    const [azureRaw, oidcRaw] = await Promise.all([
      AzureAd.isEnabled().catch(() => ({ enable: 0, groupfilter: null })),
      OIDC.isEnabled().catch(() => ({ enable: 0, issuer: null, groupfilter: null }))
    ]);

    // Normalize shapes regarding enable vs enabled
    const azure = {
      enable: !!azureRaw.enable,
      groupfilter: azureRaw.groupfilter,
    };

    const oidc = {
      enabled: !!oidcRaw.enable,
      issuer: oidcRaw.issuer,
      groupfilter: oidcRaw.groupfilter,
    };
    const settings = {
      azureAdEnabled: azure.enable,
      azureGroupfilter: azure.groupfilter,
      azureGraphUrl: authConfig.azureGraphUrl,
      oidcEnabled: oidc.enabled,
      oidcIssuer: oidc.issuer,
      oidcGroupfilter: oidc.groupfilter
    };
    res.json(RestResult.single(settings));
  } catch (err) {
    res.status(500).json(RestResult.error(helpers.getError(err)));
  }
}
// basic authentication with local users
const basic = async function(req, res,next) {
    // a locked account, or an address that failed too often, is refused before any password is
    // checked (lib/loginThrottle.js) : the same answer whether the account exists or not
    const blocked = await loginBlocked(attemptedUsername(req), req.ip).catch(() => ({ blocked: false }));
    if (blocked.blocked) {
      auditLogin(req, 'denied', 'unknown', 'too many failed logins');
      res.setHeader('Retry-After', String((blocked.minutes || 1) * 60));
      return res.status(429).json(RestResult.error(i18n.t(req, 'auth.authFailed'), i18n.t(req, 'auth.tooManyFailures', { minutes: blocked.minutes || 1 })));
    }

    // as login, we authenticate against our passport basic (username and password are extracted by passport)
    // in auth.js the user is searched locally and eventually returns either an error or the user
    passport.authenticate(
      'basic',
      async (err, user) => {
        try {
          // if we have an error; we return it
          var e=helpers.getError(err)
          if (e || !user) {
            // basic authentication returned no result, move to next middleware (ldap)
            // e is undefined when passport simply found no credentials (getError(null)
            // returns undefined), so this must be guarded : unguarded it threw a
            // TypeError that the catch below swallowed, leaving the request hanging
            // open for ever. Every login POST that sent a json body instead of a
            // Basic header leaked a socket that way.
            if(e && e.includes('not found')){
              // store error message if ldap is not enabled
              res.locals.basic_authentication_error=e
              return next()
            }
            if(err){
              logger.error(e)
            }
            
            auditLogin(req, 'failure', 'local', e || 'invalid credentials');
            await loginFailed(attemptedUsername(req), req.ip);
            // The specific reason stays on the server. Returning `e` told the caller
            // WHICH half failed - "user not found" for an unknown name against "wrong
            // password" for a real one - so the login form was a username oracle. The
            // reason is in the log and in the audit trail, where an operator can see it
            // and an attacker cannot.
            if (e) logger.debug(`Local authentication failed : ${e}`);
            return res.status(401).json(RestResult.error(i18n.t(req, 'auth.authFailed'), i18n.t(req, 'auth.invalidCredentials')));
          }
          // we found a user (local or ldap) with correct password; we start the login process (a function attached by passport !)
          // http://www.passportjs.org/docs/login/
          req.login(
            user,
            { session: false },
            async (error) => {
              if (error){
                logger.error(helpers.getError(error))
                //return next(error);
              }
              if(!hasValidLoginOption(user)){
                auditLogin(req, 'denied', user.type, 'login disabled for this user', user.username);
                return res.status(401).json({ error: i18n.t(req, 'auth.loginDisabled') });
              }
              auditLogin(req, 'success', user.type, null, user.username);
              await loginSucceeded(attemptedUsername(req));
              // send the tokens to the requester
              return res.json(userToJwt(user,req.query.expiryDays));
            }
          );
        } catch (error) {
          logger.error(helpers.getError(error))
          // ALWAYS answer. Logging alone left the client waiting on a socket that was
          // never written to and never closed.
          if (!res.headersSent) {
            return res.status(500).json(RestResult.error(i18n.t(req, 'auth.authFailed'), helpers.getError(error)));
          }
        }
      }
    )(req, res, next);
};

// basic authentication with LDAP users
const basic_ldap = async function(req, res,next) {
  // as login, we authenticate against our passport basic (username and password are extracted by passport)
  // in auth.js the user is searched in ldap and eventually returns either an error or the user
  passport.authenticate(
    'ldap',
    async (err, user) => {
      try {
        // if we have an error; we return it
        var e=helpers.getError(err)
        if (e || !user) {
          let reason = e;
          if(e && e.includes("No ldap configured")){
            reason = res.locals.basic_authentication_error || "Authentication failed";
          }
          // the end of the chain : local said 'not found' and fell through to here,
          // so this is the final verdict for the attempt
          auditLogin(req, 'failure', 'ldap', reason || 'invalid credentials');
          await loginFailed(attemptedUsername(req), req.ip);
          // Generic answer, same as the local branch above: `reason` distinguishes an
          // unknown username from a wrong password, and also carries ldap internals
          // (bind failures, server names) that no anonymous caller should see.
          if (reason) logger.debug(`Ldap authentication failed : ${reason}`);
          return res.status(401).json(RestResult.error(i18n.t(req, 'auth.authFailed'), i18n.t(req, 'auth.invalidCredentials')));
        }
        // we found a user (local or ldap) with correct password; we start the login process (a function attached by passport !)
        // http://www.passportjs.org/docs/login/
        req.login(
          user,
          { session: false },
          async (error) => {
            if (error){
              logger.error(helpers.getError(error))
              return next(error);
            }
          
            if(!hasValidLoginOption(user)){
              auditLogin(req, 'denied', user.type, 'login disabled for this user', user.username);
              return res.status(401).json({ error: i18n.t(req, 'auth.loginDisabled') });
            }
            auditLogin(req, 'success', user.type, null, user.username);
            await loginSucceeded(attemptedUsername(req));
            // send the tokens to the requester
            return res.json(userToJwt(user,req.query.expiryDays));
          }
        );
      } catch (error) {
        logger.error(helpers.getError(error))
        return next(error);
      }
    }
  )(req, res, next);
};

/**
 * perform logout actions
 */
const logout = async function(req, res, _next){
  // the session of the token that logs out ends here, for every token of it : the access token
  // (still valid for its lifetime otherwise), the refresh token, an api token of that login
  try {
    const bearer = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')
    if (bearer) {
      const payload = jwt.verify(bearer, authConfig.secret, { issuer: authConfig.jwtIssuer, ignoreExpiration: true })
      if (payload?.sid) await revokeSession(payload.sid, Date.now() + authConfig.apiTokenMaxDays * 86400 * 1000)
      const refreshtoken = req.body?.refreshtoken
      if (refreshtoken && payload?.user?.username) await Token.delete(payload.user.username, payload.user.type, refreshtoken)
    }
  } catch (err) {
    logger.debug(`Logout : the token could not be read, nothing revoked : ${err.message || err}`)
  }
  req.logout((err) => {
    if (err) {
      logger.error(helpers.getError(err))
      return res.status(500).json(RestResult.error(helpers.getError(err)));
    }
    res.json(RestResult.single({logoutUrl: auth_oidc.getLogoutUrl()}))
  });
};

// catches middleware error (non implemented strategy for example)
const errorHandler = async function(err,req, res,_next) {
  res.redirect(`${appConfig.baseUrl}/login?error=${err}`)
};

/**
 * generate the callback options for login via identity provider oauth2
 * 
 * Some information about how the identity provide mechanism works:
 * 
 * 1. The user clicks on the identity provider login button
 * 2. A browser storage authIssuer key is set with the identity provider name (azuread, oidc, ...)
 * 3. The user is redirected to the ansibleforms backend server identity provider api https://ansibleformsurl/auth/azureadoauth2 or https://ansibleformsurl/auth/oidc, ...
 * 4. The backend uses passport to authenticate the user with the identity provider and redirects the user away to the identity provider (microsft, google, ...)
 * 5. The identity provider authenticates the user and redirects the user back to the callback url https://ansibleformsurl/auth/azureadoauth2/callback or https://ansibleformsurl/auth/oidc/callback
 * 6. The backend server receives the callback and uses passport to verify the returned payload.  it passes the payload to an authCallback function
 * 7. The authCallback function redirects the user back to the frontend with a HANDOFF token (/login?token=), signed by us : the claims the login needs, and for azuread the provider's access token sealed inside it (lib/ssoHandoff.js).
 * 8. The frontend posts the handoff token to the backend /auth/azureadoauth2/login (or /auth/oidc/login) endpoint.
 * 9. For azuread the backend opens the sealed access token and fetches the user's groups from Microsoft Graph, filtered with the provider's group filter (lib/azureGraph.js). For oidc the groups are a claim of the profile, filtered with the same group filter.
 * 10. The backend grabs more information from payload if needed (username,...) and assembles a user-object, the roles and options are added
 * 11. The backend converts the user object to json and signs it as a jwt token an returns it in the response
 * 12. The frontend grabs the token and stores it in the local storage, ready for jwt-bearer authentication
 * 
 */
const authCallback = function(req, res, next, type) {
  return async (err, payload) => {
    // The HANDOFF token : the claims passport just verified, re-signed with OUR secret
    // (lib/ssoHandoff.js explains why). Signed inside the try and only without an error :
    // a failing sign used to be an unhandled rejection, and the browser was never
    // redirected (#542).
    try {
      if (err) {
        logger.error(helpers.getError(err))
        return next(err)
      }
      const token = signHandoff(payload, type);
      // in the fragment : the browser keeps it, no server, proxy or access log ever sees it
      res.redirect(`${appConfig.baseUrl}/login#token=${token}`)
    } catch (err) {
      logger.error(helpers.getError(err))
      return next(err)
    }
  }
};


/**
 * Verifies a handoff token minted by authCallback. Throws if it was not signed by us,
 * has expired, or was issued for a different provider - which also stops an ACCESS token
 * being replayed here, since it carries no matching `sso` claim.
 */
async function verifyHandoff(token, type) {
  if (!token) throw new Error('No token given');
  const payload = jwt.verify(token, authConfig.secret, { issuer: authConfig.jwtIssuer });
  if (payload.sso !== type) throw new Error('This token was not issued for this login method');
  // once : a handoff that was seen (a browser history, a shared link) is worth nothing
  if (!payload.jti || !(await consumeOnce(`handoff:${payload.jti}`, (Number(payload.exp) || 0) * 1000))) {
    throw new Error('This login token was used already');
  }
  return payload;
}

/**
 * A login method that is switched off must not be a way in. Both endpoints are
 * unauthenticated, and neither used to check this at all.
 */
async function assertProviderEnabled(model, name) {
  const row = await model.isEnabled().catch(() => null);
  if (!row || !row.enable) throw new Error(`${name} login is not enabled`);
  return row;
}

/**
 * The Azure groups, by name, from Graph - with the access token the handoff carries
 * sealed. A handoff without one (minted before 6.5.3) falls back to the groups claim and
 * the client's list, as before.
 */
async function azureGroups(payload, bodyGroups, groupfilter) {
  if (!payload.at) return filterGroups(ssoGroups(payload, bodyGroups, 'azuread'), groupfilter);
  const groups = await fetchAzureGroups(openToken(payload.at), authConfig.azureGraphUrl, { withIds: true });
  // the group filter is on the names, as it always was ; a kept group is known by its object id
  // (unique, the way to name it in a role) and by its name (as roles named it before 7)
  const keptNames = new Set(filterGroups(groups.map((g) => g.name), groupfilter));
  const kept = groups.filter((g) => keptNames.has(g.name));
  logger.debug(`azuread login: ${groups.length} groups from Graph, ${kept.length} after the group filter`);
  return [...new Set(kept.flatMap((g) => [g.id, g.name].filter(Boolean)))];
}

/**
 * The groups to trust.
 *
 * The provider's own claim wins whenever it is present, because it is inside the token we
 * signed. `req.body.groups` is whatever the browser chose to send, so it is used ONLY
 * when the provider returned none, and that fallback is logged: a caller can otherwise
 * name any group and getRolesAndOptions will grant the roles that match it. Either way
 * the caller passes the result through the provider's group filter (filterGroups).
 */
function ssoGroups(payload, bodyGroups, type) {
  const fromToken = payload.groups;
  if (Array.isArray(fromToken)) return fromToken;
  const fromBody = Array.isArray(bodyGroups) ? bodyGroups : [];
  if (fromBody.length) {
    logger.warning(`${type} login: the provider returned no groups claim, falling back to the groups the client reported - configure the provider to emit groups so this is not client controlled`);
  }
  return fromBody;
}

const extractAzureUser = async function(payload, groups) {
  return {
    // the upn when the token has it (an access token, or an ID token with the optional claim),
    // else the preferred username - the same value for a work account
    username: payload.upn || payload.preferred_username,
    id: payload.oid,
    // the person's name from the token, for the header (see lib/displayName.js)
    ...(claimsDisplayName(payload) && { displayName: claimsDisplayName(payload) }),
    groups: groups.map(g => `azuread/${g}`) // groups are prefixed with azuread/ to avoid conflicts with oidc groups etc
  }
};

const extractOidcUser = async function(payload, groups) {
  return {
    username: payload.preferred_username,
    ...(claimsDisplayName(payload) && { displayName: claimsDisplayName(payload) }),
    groups: groups.map(g => `oidc/${g}`) // groups are prefixed with oidc/ to avoid conflicts with azuread groups etc
  }
};

// this redirects to Azure AD login but with the proper application client id & secret
const azureadoauth2 = async function(req, res,next) {
  logger.debug("Redirect to azure")
  // redirect to azure
  try {
    passport.authenticate('azure_ad_oauth2')(req,res,next)
  } catch(err) {
    logger.error(`Azure AD redirect failed: ${err?.message || err}`)
    next(err)
  }
};

// callback with the Azure AD access token
const azureadoauth2callback = async function(req, res,next) {
  logger.debug("Azure AD callback")
  try {
    passport.authenticate('azure_ad_oauth2', authCallback(req, res, next,"azuread"))(req, res, next)
  } catch(err) {
    logger.error(`Azure AD callback failed: ${err?.message || err}`)
    next(err)
  }
};
// callback with the Azure AD user info (including groups)
const azureadoauth2login = async function(req, res,_next) {
  try {
    logger.debug("Azure AD login")
    const payload = await verifyHandoff(req.body.token, 'azuread')
    const provider = await assertProviderEnabled(AzureAd, 'azuread')
    // the tenant once more, at the login itself : the handoff of a login against another tenant
    // is refused even if the strategy was reconfigured meanwhile
    const azureConfig = await AzureAd.find()
    if (!isSingleTenant(azureConfig.tenant_id)) throw new Error('Entra ID login needs the tenant id of your tenant')
    if (payload.tid && /^[0-9a-f-]{36}$/i.test(String(azureConfig.tenant_id).trim()) && String(payload.tid).toLowerCase() !== String(azureConfig.tenant_id).trim().toLowerCase()) {
      throw new Error('This Entra ID login is of another tenant')
    }
    const user = await extractAzureUser(payload, await azureGroups(payload, req.body.groups, provider.groupfilter))
    user.type = "azuread"
    const ro = await User.getRolesAndOptions(user.groups,user)
    user.roles = ro.roles
    user.options = ro.options  
    if(!hasValidLoginOption(user)){
      auditLogin(req, 'denied', 'azuread', 'login disabled for this user', user.username);
      return res.status(401).json({ error: i18n.t(req, 'auth.loginDisabled') });
    }
    // Audited like every other way in. These two paths recorded NOTHING - and /auth is
    // deliberately skipped by the blanket middleware, so an SSO login left no trace at all,
    // successful or refused. The audit trail is the control that would surface a problem here.
    auditLogin(req, 'success', 'azuread', null, user.username);
    // return token
    res.json(userToJwt(user))

  } catch(err){
    logger.error(helpers.getError(err))
    return res.status(401).json(RestResult.error(i18n.t(req, 'auth.azureFailed'), helpers.getError(err)));
  }
};

// this redirects to OIDC Provider login but with the proper application client id & secret
const oidc = async function(req, res,next) {
  logger.debug("Redirect to Open ID Issuer")
  // redirect to Open ID Connect Provider
  passport.authenticate('oidc')(req,res,next)
};

// callback with the OIDC access token
const oidcCallback = async function(req, res,next) {
  passport.authenticate('oidc', authCallback(req, res, next, 'oidc'))(req, res, next)
};
// callback with the OIDC user info (including groups)
const oidcLogin = async function(req, res, _next) {
  try {
    const payload = await verifyHandoff(req.body.token, 'oidc')
    const provider = await assertProviderEnabled(OIDC, 'oidc')
    // The provider's group filter is applied HERE, on the groups we trust. It used to be
    // applied only by the browser, to the list it posts - but ssoGroups ignores that list
    // whenever the token carries a groups claim, so the filter had no effect at all and
    // every group of the user ended up in the jwt. Same semantics as Entra ID and
    // LDAP : a regular expression, an invalid one keeps every group and is logged.
    const groups = filterGroups(ssoGroups(payload, req.body.groups, 'oidc'), provider.groupfilter)
    logger.debug(`oidc login: ${groups.length} groups after the group filter`)
    const user = await extractOidcUser(payload, groups)
    user.type = "oidc"
    const ro = await User.getRolesAndOptions(user.groups,user)
    user.roles = ro.roles
    user.options = ro.options  
    if(!hasValidLoginOption(user)){
      auditLogin(req, 'denied', 'oidc', 'login disabled for this user', user.username);
      return res.status(401).json({ error: i18n.t(req, 'auth.loginDisabled') });
    }
    // Audited like every other way in. These two paths recorded NOTHING - and /auth is
    // deliberately skipped by the blanket middleware, so an SSO login left no trace at all,
    // successful or refused. The audit trail is the control that would surface a problem here.
    auditLogin(req, 'success', 'oidc', null, user.username);
    // return token
    res.json(userToJwt(user))

  } catch(err){
    logger.error(helpers.getError(err))
    return res.status(401).json(RestResult.error(i18n.t(req, 'auth.oidcFailed'), helpers.getError(err)));
  }
};

export default {
  basic,
  basic_ldap,
  logout,
  errorHandler,
  settings,
  azureadoauth2,
  azureadoauth2callback,
  azureadoauth2login,
  oidc,
  oidcCallback,
  oidcLogin
}