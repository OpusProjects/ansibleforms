// Microsoft Entra ID (Azure AD) login, on openid-client : the authorization code flow with
// PKCE, state and nonce, the ID token checked by the library (signature, issuer, audience,
// expiry) - and the tenant pinned. The login is against the configured tenant's own v2.0
// issuer, never the common endpoint, and the token's `tid` must be that tenant : a user of
// another Microsoft tenant is refused, not let in as `public`.
//
// The access token the same login returns is for Microsoft Graph (User.Read,
// GroupMember.Read.All) : the login step reads the user's groups with it (lib/azureGraph.js).
import passport from 'passport';
import * as openidClient from 'openid-client';
import { Strategy as OpenIdClientStrategy } from 'openid-client/passport';
import AzureAd from '../models/azureAd.model.js';
import logger from '../lib/logger.js';

// the tenant ids that are not one tenant : refused, they would let any tenant in
const NOT_A_TENANT = new Set(['', 'common', 'organizations', 'consumers']);

// what the login asks for : the ID token's claims, and an access token for Graph
export const AZURE_SCOPES = 'openid profile email User.Read GroupMember.Read.All';

/**
 * Whether a tenant id names one tenant (a GUID or a domain), not a multi-tenant endpoint.
 *
 * Args:
 *   tenantId (string): the configured tenant id.
 *
 * Returns:
 *   boolean: true for one tenant.
 */
export function isSingleTenant(tenantId) {
  return !NOT_A_TENANT.has(String(tenantId || '').trim().toLowerCase());
}

/**
 * Checks the claims of a login : the token's tenant must be the configured one.
 *
 * Args:
 *   claims (object): the ID token's claims.
 *   tenantId (string): the configured tenant id (a GUID, or a domain of the tenant).
 *
 * Raises:
 *   Error: the token is of another tenant.
 */
export function assertTenant(claims, tenantId) {
  const tid = String(claims?.tid || '').toLowerCase();
  const want = String(tenantId || '').trim().toLowerCase();
  // a domain as tenant id : the issuer, pinned by the discovery, names the tenant's GUID ;
  // a GUID : it must be the token's tid
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(want);
  if (!tid) throw new Error('The Entra ID token carries no tenant (tid)');
  if (guid && tid !== want) throw new Error(`The Entra ID token is of another tenant (${tid})`);
  if (!guid && !String(claims?.iss || '').toLowerCase().includes(`/${tid}/`)) {
    throw new Error('The Entra ID token does not come from the tenant it names');
  }
}

const initialize = async () => {
  logger.debug('Initializing Entra ID strategy');
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  let azure;
  let azureConfig;
  try {
    azure = await AzureAd.isEnabled();
    if (azure.enable) azureConfig = await AzureAd.find();
    else logger.info('Entra ID is not enabled');
  } catch (err) {
    logger.error('Failed to get the Entra ID configuration. ', err);
    return false;
  }
  try {
    passport.unuse('azure_ad_oauth2');
  } catch (err) {
    logger.error('Failed to remove the Entra ID strategy. ', err);
  }
  if (!azure?.enable) return true;
  if (!azureConfig?.client_id || !azureConfig?.redirect_uri) {
    logger.error('Could not enable Entra ID : the client id and the redirect uri are required');
    return false;
  }
  if (!isSingleTenant(azureConfig.tenant_id)) {
    logger.error(`Could not enable Entra ID : set the tenant id to your tenant ('${azureConfig.tenant_id || ''}' would let any Microsoft tenant log in)`);
    return false;
  }
  try {
    const tenant = encodeURIComponent(String(azureConfig.tenant_id).trim());
    const issuer = new URL(`https://login.microsoftonline.com/${tenant}/v2.0`);
    const config = await openidClient.discovery(issuer, azureConfig.client_id, { client_secret: azureConfig.client_secret });
    const verify = (tokens, done) => {
      try {
        const claims = tokens.claims();
        assertTenant(claims, azureConfig.tenant_id);
        logger.debug(`Entra ID login for subject=${claims.sub || 'unknown'}`);
        // the claims and the Graph access token, for the handoff (lib/ssoHandoff.js)
        return done(null, { claims, accessToken: tokens.access_token });
      } catch (err) {
        logger.warning(`Entra ID login refused : ${err.message}`);
        return done(err);
      }
    };
    passport.use('azure_ad_oauth2', new OpenIdClientStrategy({
      config,
      scope: AZURE_SCOPES,
      callbackURL: new URL(azureConfig.redirect_uri),
    }, verify));
    logger.info('Entra ID strategy initialized');
    return true;
  } catch (err) {
    logger.error(`Failed to initialize the Entra ID strategy. ${err?.message || err}`);
    return false;
  }
};

export default {
  initialize,
};
