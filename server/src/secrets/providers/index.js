// The secret store providers. A provider is { type, read(store, ref), check(store), mounts?(store) } ;
// adding a backend is one file here and one entry in PROVIDERS (and in the client's list in
// client/src/config/settings.js).
import vault from "./vault.js";
import cyberark_ccp from "./cyberark_ccp.js";
import SecretStore from "../../models/secretStore.model.js";
import Errors from "../../lib/errors.js";
import { getCached, setCached, clearSecretCache } from "../cache.js";
import { LEASE_SECONDS, leaseCacheSeconds } from "../lease.js";

const PROVIDERS = { vault, cyberark_ccp };
export const SECRET_STORE_TYPES = Object.keys(PROVIDERS);

// The store that a credential's deprecated vault_path and the inline "vault:" prefix read
// from. Upgrading from 7.0 imports the VAULT_* environment variables under this name
// (secrets/importVaultEnv.js).
export const VAULT_STORE_NAME = "vault";

const DEFAULT_CACHE_TTL_SECONDS = 60;

/** A store by name, its secrets decrypted. */
export async function getStore(name) {
  const row = name ? await SecretStore.findByName(name) : null;
  // the token of its credential, when it names one
  if (row) return SecretStore.withCredential(row);
  throw new Errors.NotFoundError(`No secret store named '${name}'`);
}

function providerFor(store) {
  const provider = PROVIDERS[store.type];
  if (!provider) throw new Errors.BadRequestError(`Secret store '${store.name}' has an unknown type '${store.type}'`);
  return provider;
}

function ttlOf(store) {
  const ttl = parseInt(store.cache_ttl_seconds, 10);
  return Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_CACHE_TTL_SECONDS;
}

/** The secret's key/value pairs, from the store's cache while its ttl lasts. */
export async function readSecret(storeName, ref) {
  const store = await getStore(storeName);
  const provider = providerFor(store);
  const ttl = ttlOf(store);
  // the connection is part of the key, so an edited url or namespace never serves the
  // payload the old one returned (a saved store flushes the cache as well)
  const key = [store.type, store.name, store.url, store.namespace || "", ref].join("|");
  if (ttl > 0) {
    const cached = getCached(key);
    if (cached) return cached;
  }
  const payload = await provider.read(store, ref);
  const lease = payload?.[LEASE_SECONDS];
  if (lease !== undefined) delete payload[LEASE_SECONDS];
  // a leased secret (Vault dynamic credentials) is kept for its lease, not the store's ttl :
  // every read issues a new account. A store set to 0 still means "never cache".
  setCached(key, payload, ttl > 0 && lease ? leaseCacheSeconds(lease) : ttl);
  return payload;
}

/** Proves the store is reachable and accepts us, without returning a secret. */
export async function checkStore(store, opts) {
  // a store loaded by id (the admin page's Test) : the token of its credential too
  store = await SecretStore.withCredential(store);
  return providerFor(store).check(store, opts);
}

export async function listMounts(store) {
  store = await SecretStore.withCredential(store);
  const provider = providerFor(store);
  if (!provider.mounts) throw new Errors.BadRequestError(`A ${store.type} secret store has no mounts to list`);
  return provider.mounts(store);
}

/**
 * A payload as a credential : user and password under the names stores commonly use.
 * Other keys are passed through so they stay available to expressions and playbooks.
 */
export function mapPayloadToCredential(payload) {
  if (!payload || typeof payload !== "object") return {};
  const user = payload.user ?? payload.username ?? payload.login ?? "";
  const password = payload.password ?? payload.token ?? payload.api_key ?? payload.apikey ?? payload.secret ?? "";
  const out = { ...payload, user, password };
  // the connection, under the names a secret commonly uses ; only set when present, so an
  // empty field of a credential row is never overwritten with undefined
  const host = payload.host ?? payload.address;
  const dbName = payload.db_name ?? payload.database;
  if (host !== undefined) out.host = host;
  if (dbName !== undefined) out.db_name = dbName;
  return out;
}

/**
 * An inline secret instead of a credential name, anywhere a name is accepted :
 *   "secret:<store>:<ref>"  e.g. "secret:cyberark:Safe=Linux;Object=root"
 *   "vault:<path>"          the store named `vault`
 * Returns { store, ref }, or null for an ordinary credential name.
 */
export function parseInlineSecret(name) {
  if (typeof name !== "string") return null;
  const lower = name.toLowerCase();
  if (lower.startsWith("vault:")) return { store: VAULT_STORE_NAME, ref: name.slice(6).trim() };
  if (lower.startsWith("secret:")) {
    const rest = name.slice(7);
    const colon = rest.indexOf(":");
    if (colon < 1) throw new Errors.BadRequestError(`'${name}' : use secret:<store>:<ref>`);
    return { store: rest.slice(0, colon).trim(), ref: rest.slice(colon + 1).trim() };
  }
  return null;
}

export { clearSecretCache };

export default { SECRET_STORE_TYPES, VAULT_STORE_NAME, readSecret, checkStore, listMounts, getStore, mapPayloadToCredential, parseInlineSecret, clearSecretCache };
