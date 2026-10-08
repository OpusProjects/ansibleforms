'use strict';
import { Agent, fetch as undiciFetch } from 'undici';
import { ChatError } from '../errors.js';
import { stripTrailingSlashes } from '../../lib/url.js';

// "Ignore certificate errors" : a proxy on a self-signed certificate. Its own fetch with its
// own agent, so only these calls skip the check - never the rest of the server.
let insecureAgent = null;
function insecureFetch(url, options) {
  insecureAgent = insecureAgent || new Agent({ connect: { rejectUnauthorized: false } });
  return undiciFetch(url, { ...options, dispatcher: insecureAgent });
}

/**
 * POST json to a model provider. The api key only ever travels in a header ; a failure is
 * reported with the provider's status and the start of its message - never the request.
 */
export async function postJson(url, headers, body, { timeoutSeconds = 60, provider = 'provider', ignoreCerts = false } = {}) {
  let res;
  try {
    res = await (ignoreCerts ? insecureFetch : fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ChatError(timedOut ? 'provider_timeout' : 'provider_unreachable',
      timedOut ? `${provider} did not answer within ${timeoutSeconds}s` : `${provider} could not be reached at ${where(url)} : ${networkReason(err)}`, 502);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || text.slice(0, 200);
    throw new ChatError('provider_error', `${provider} returned ${res.status} : ${detail}`, 502);
  }
  if (!json) throw new ChatError('provider_error', `${provider} did not return JSON`, 502);
  return json;
}

/** the host a call went to - never the path or query, which may carry more than a host */
function where(url) {
  try { return new URL(url).origin; } catch { return 'the base url'; }
}

/**
 * Why a call did not get through. Node's fetch only says "fetch failed" ; the reason is in
 * its cause : an unknown host, a refused connection, a certificate the container does not
 * trust. That reason is what an admin needs to fix it.
 */
export function networkReason(err) {
  const cause = err?.cause;
  const code = cause?.code || cause?.errors?.[0]?.code;
  const hint = {
    ENOTFOUND: 'the host name does not resolve',
    EAI_AGAIN: 'the host name does not resolve (DNS)',
    ECONNREFUSED: 'the connection was refused - check the host and port',
    ECONNRESET: 'the connection was reset',
    ETIMEDOUT: 'the connection timed out',
    EHOSTUNREACH: 'the host cannot be reached',
    ENETUNREACH: 'the network cannot be reached',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate is not trusted - set NODE_EXTRA_CA_CERTS to its CA, or ignore certificate errors',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the certificate is not trusted - set NODE_EXTRA_CA_CERTS to its CA, or ignore certificate errors',
    SELF_SIGNED_CERT_IN_CHAIN: 'the certificate is not trusted (self-signed CA) - set NODE_EXTRA_CA_CERTS to its CA, or ignore certificate errors',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'the certificate is self-signed - set NODE_EXTRA_CA_CERTS to it, or ignore certificate errors',
    CERT_HAS_EXPIRED: 'the certificate has expired',
    ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate does not match the host name',
  }[code];
  if (hint) return `${hint} (${code})`;
  if (code) return `${cause?.message || err?.message} (${code})`;
  return cause?.message || err?.message || String(err);
}

/** a url with a path appended in front of its query string (Azure keeps api-version there) */
export function withPath(base, path) {
  const [head, query] = String(base).split('?');
  return `${stripTrailingSlashes(head)}${path}${query ? `?${query}` : ''}`;
}

/** the url with ?api-version=... when the settings name one and the url does not carry it */
export function withApiVersion(url, apiVersion) {
  if (!apiVersion || /[?&]api-version=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}api-version=${encodeURIComponent(apiVersion)}`;
}

/**
 * The headers of a provider call : the key the way the settings say (auth type, or the
 * protocol's own when empty), and the proxy's extra headers. No key : no auth header.
 */
export function requestHeaders(settings, defaultAuth) {
  const headers = {};
  if (settings.extra_headers) {
    try { Object.assign(headers, JSON.parse(settings.extra_headers)); } catch { /* validated on save */ }
  }
  const type = settings.auth_type || defaultAuth;
  if (settings.api_key && type !== 'none') {
    if (type === 'bearer') headers.authorization = `Bearer ${settings.api_key}`;
    else if (type === 'api-key') headers['api-key'] = settings.api_key;
    else if (type === 'x-api-key') headers['x-api-key'] = settings.api_key;
  }
  return headers;
}

/** tool call arguments the model sent as text ; broken JSON is flagged, not thrown */
export function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { __invalid_json__: true };
  } catch {
    return { __invalid_json__: true };
  }
}

export default { postJson, withPath, withApiVersion, requestHeaders, parseArguments };
