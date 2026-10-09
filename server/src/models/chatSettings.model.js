'use strict';
import logger from "../lib/logger.js";
import mysql from "./db.model.js";
import crypto from "../lib/crypto.js";
import { CHAT_VENDORS, CHAT_PROVIDERS, effectiveSettings } from "../chat/vendors.js";

export { CHAT_VENDORS, CHAT_PROVIDERS, effectiveSettings };

// how the key travels : '' = the protocol's own (anthropic : x-api-key, openai : bearer)
export const CHAT_AUTH_TYPES = ['', 'bearer', 'api-key', 'x-api-key', 'none'];
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
// headers the adapters own : a proxy setting cannot replace them
const RESERVED_HEADERS = new Set(['content-type', 'content-length', 'host', 'authorization', 'api-key', 'x-api-key']);

/**
 * Extra request headers for a proxy (an org id, a gateway tag), as a JSON object of
 * strings. Anything else - a list, a nested value, a line break, a header the adapter
 * sets itself - is refused rather than sent.
 * @returns {string} the normalised JSON ('' for none)
 */
export function normaliseExtraHeaders(value) {
  if (value === undefined || value === null || value === '') return '';
  let obj = value;
  if (typeof value === 'string') {
    try { obj = JSON.parse(value); } catch { throw new Error('Extra headers must be a JSON object, like {"X-Org": "ops"}'); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Extra headers must be a JSON object, like {"X-Org": "ops"}');
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!HEADER_NAME.test(k)) throw new Error(`'${k}' is not a valid header name`);
    if (RESERVED_HEADERS.has(k.toLowerCase())) throw new Error(`'${k}' is set by AnsibleForms and cannot be an extra header ; use the auth type`);
    if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new Error(`The value of '${k}' must be text on one line`);
    out[k] = v;
  }
  if (Object.keys(out).length > 20) throw new Error('At most 20 extra headers');
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

/**
 * The chat assistant's model provider : one row, like ldap. The api key is encrypted at
 * rest with ENCRYPTION_SECRET and never leaves the server (the controller masks it).
 */
const ChatSettings = function (s) {
  this.provider = CHAT_PROVIDERS.includes(s.provider) ? s.provider : '';
  // undefined = keep, "" = clear, anything else = encrypt
  if (s.api_key !== undefined) this.api_key = s.api_key === '' ? '' : crypto.encrypt(String(s.api_key));
  // an api credential of Connections > Credentials whose password is the key ; undefined =
  // keep (the config seed sets the key itself), "" = none
  if (s.credential !== undefined) this.credential = s.credential ? String(s.credential) : null;
  this.base_url = s.base_url || '';
  this.model = s.model || '';
  this.max_turns = clampInt(s.max_turns, 1, 200, 20);
  this.max_tool_rounds = clampInt(s.max_tool_rounds, 1, 20, 6);
  this.timeout_seconds = clampInt(s.timeout_seconds, 5, 600, 60);
  this.allow_job_status = (s.allow_job_status === undefined || s.allow_job_status) ? 1 : 0;
  this.auth_type = CHAT_AUTH_TYPES.includes(s.auth_type) ? s.auth_type : '';
  this.api_version = String(s.api_version || '').trim().slice(0, 50);
  this.request_user = String(s.request_user || '').trim().slice(0, 100);
  this.extra_headers = normaliseExtraHeaders(s.extra_headers);
  this.ignore_certs = s.ignore_certs ? 1 : 0;
};

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

ChatSettings.update = async function (record) {
  logger.info(`Updating chat settings (provider ${record.provider || 'none'})`);
  const res = await mysql.do("UPDATE AnsibleForms.`chat_settings` set ?", record);
  configuredCache.fetchedAt = 0; // on or off shows on the next page load, not 30 s later
  return res;
};

/** the row with the api key DECRYPTED - for the server only */
ChatSettings.find = async function () {
  const res = await mysql.do("SELECT * FROM AnsibleForms.`chat_settings` limit 1;");
  if (!res.length) throw new Error("No chat_settings record in the database");
  const row = res[0];
  try {
    row.api_key = crypto.decrypt(row.api_key || '');
  } catch {
    logger.error("Couldn't decrypt the chat api key, did the secret key change ?");
    row.api_key = '';
  }
  return row;
};

/**
 * Checks the credential the chat is given : it exists and is an api one.
 *
 * Args:
 *   name (string): the credential's name ; empty is none.
 *
 * Raises:
 *   Error: the credential does not exist, or is not an api one.
 */
ChatSettings.assertCredentialUsable = async function (name) {
  if (!name) return;
  const { default: CrudModel } = await import('./crud.model.js');
  const cred = await CrudModel.findByName('credential', name);
  if (!cred) throw new Error(`No credential named '${name}'`);
  if (cred.credential_type !== 'api') throw new Error(`The chat needs an api credential : '${name}' is not one`);
};

/**
 * The row with the key it sends : its credential's password when it names one (read from a
 * secret store when the credential names one), else its own key. For the server only.
 *
 * Args:
 *   row (object): the row, from find().
 *
 * Returns:
 *   Promise<object>: a copy with api_key set from its credential, or the row.
 */
ChatSettings.withCredential = async function (row) {
  if (!row?.credential) return row;
  const { default: Credential } = await import('./credential.model.v2.js');
  const exact = '^' + String(row.credential).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const cred = await Credential.resolveCredential(exact);
  if (!cred) {
    logger.error(`The chat uses the credential '${row.credential}', which is not found`);
    return { ...row, api_key: '' };
  }
  return { ...row, api_key: cred.password || '' };
};

/** the row with the key it sends, for the chat itself */
ChatSettings.findResolved = async function () {
  return ChatSettings.withCredential(await ChatSettings.find());
};

/**
 * whether a provider is configured well enough to chat : a provider and a model, a base url
 * where the provider has none of its own, and a key - unless the auth type sends none, or
 * the base url is set (a local model server or an internal proxy often takes no key)
 */
ChatSettings.isConfigured = function (row) {
  const vendor = row && CHAT_VENDORS[row.provider];
  if (!vendor || !row.model) return false;
  if (vendor.url && !row.base_url) return false;
  return !!(row.api_key || row.base_url || effectiveSettings(row).auth_type === 'none');
};

// Whether a provider is configured, for the unauthenticated /app/config that every page
// load asks : cached briefly, and dropped on every update of the row.
const configuredCache = { value: false, fetchedAt: 0 };
ChatSettings.configuredCached = async function () {
  if (Date.now() - configuredCache.fetchedAt < 30 * 1000) return configuredCache.value;
  let value = false;
  try {
    value = ChatSettings.isConfigured(await ChatSettings.findResolved());
  } catch (e) {
    logger.debug(`Could not read the chat settings : ${e.message}`);
  }
  configuredCache.value = value;
  configuredCache.fetchedAt = Date.now();
  return value;
};

export default ChatSettings;
