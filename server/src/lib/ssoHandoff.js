'use strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import authConfig from '../../config/auth.config.js';
import appConfig from '../../config/app.config.js';

// Short : it only has to survive the redirect from the provider back to the login page.
export const SSO_HANDOFF_EXPIRES_IN = '5m';

// Registered claims of the PROVIDER's token that describe that token, not ours : its
// lifetime and its issuer. Our handoff token sets its own - and jsonwebtoken refuses to
// sign a payload that already carries `exp` or `iss` next to the expiresIn / issuer
// options ("Bad options.expiresIn option the payload already has an exp property"),
// which is what broke every Azure AD login (#542) : azuread hands over its access token,
// and its decoded claims hold both. An `iat` or `nbf` from the provider would also shift
// the handoff's own validity window, so they go too.
const PROVIDER_TOKEN_CLAIMS = ['exp', 'iat', 'nbf', 'iss'];

// The claims of an Azure access token the login uses (extractAzureUser) - the rest is
// Graph's business : `aud`, `scp`, the signature keys, and the `groups` claim, which
// holds object ids and can run to 200 of them (7 KB in the url). The group NAMES come
// from Graph, fetched by the server at the login step (#548).
const AZURE_CLAIMS = ['upn', 'oid', 'name', 'email', 'unique_name', 'preferred_username', 'tid'];

/**
 * The Azure access token, sealed for the trip through the browser : AES-256-GCM under
 * the encryption secret, base64url. The /login endpoint opens it to call Graph. It is
 * never in the clear in the url, the browser history or a proxy log - and a stolen
 * handoff is useless without the server's secret.
 */
const sealKey = () => crypto.createHash('sha256').update(String(appConfig.encryptionSecret || authConfig.secret)).digest();
export function sealToken(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}
export function openToken(sealed) {
  const buf = Buffer.from(String(sealed || ''), 'base64url');
  if (buf.length < 29) throw new Error('The sealed token is too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/**
 * The HANDOFF token of an SSO login : the claims passport just verified, re-signed with
 * OUR secret, so the /login endpoint can tell them apart from anything a caller made up.
 * `sso` pins which endpoint may consume it ; there is deliberately no `access` claim, so
 * auth_jwt.js will not take it as an access token.
 *
 * @param {string|object} payload  azuread : the provider's access token (the claims the
 *                                 login needs are taken, the token itself travels sealed
 *                                 as `at`) ; oidc : a profile
 * @param {string} type            the login method, `azuread` or `oidc`
 */
export function signHandoff(payload, type) {
  let claims = payload;
  // azuread : { claims : the ID token's, accessToken : for Graph } (auth/auth_azuread.js)
  const azure = type === 'azuread' && payload && typeof payload === 'object' && payload.claims;
  if (azure) claims = payload.claims;
  if (typeof claims === 'string') claims = jwt.decode(claims) || {};
  if (!claims || typeof claims !== 'object') claims = {};
  let own = { ...claims };
  for (const k of PROVIDER_TOKEN_CLAIMS) delete own[k];
  if (type === 'azuread' && (azure || typeof payload === 'string')) {
    own = Object.fromEntries(AZURE_CLAIMS.filter((k) => own[k] !== undefined).map((k) => [k, own[k]]));
    own.at = sealToken(azure ? payload.accessToken : payload);
  }
  return jwt.sign(
    // jti : the login takes a handoff once (tokenRevocation.consumeOnce)
    { ...own, sso: type, jti: crypto.randomBytes(16).toString('hex') },
    authConfig.secret,
    { expiresIn: SSO_HANDOFF_EXPIRES_IN, issuer: authConfig.jwtIssuer },
  );
}

export default { signHandoff, sealToken, openToken, SSO_HANDOFF_EXPIRES_IN };
