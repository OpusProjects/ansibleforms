// The secret store providers. A provider is { type, read(store, ref), check(store), mounts?(store) } ;
// adding a backend is one file here and one entry in PROVIDERS (and in the client's list in
// client/src/config/settings.js).
import vault from "./vault.js";
import SecretStore from "../../models/secretStore.model.js";
import Errors from "../../lib/errors.js";
import { getCached, setCached, clearSecretCache } from "../cache.js";

const PROVIDERS = { vault };
export const SECRET_STORE_TYPES = Object.keys(PROVIDERS);

// The store that a credential's deprecated vault_path and the inline "vault:" prefix read
// from. Upgrading from 7.0 imports the VAULT_* environment variables under this name
// (secrets/importVaultEnv.js).
export const VAULT_STORE_NAME = "vault";

const DEFAULT_CACHE_TTL_SECONDS = 60;

/** A store by name, its secrets decrypted. */
export async function getStore(name) {
  const row = name ? await SecretStore.findByName(name) : null;
  if (row) return row;
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
  setCached(key, payload, ttl);
  return payload;
}

/** Proves the store is reachable and accepts us, without returning a secret. */
export async function checkStore(store, opts) {
  return providerFor(store).check(store, opts);
}

export async function listMounts(store) {
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
  return { ...payload, user, password };
}

export { clearSecretCache };

export default { SECRET_STORE_TYPES, VAULT_STORE_NAME, readSecret, checkStore, listMounts, getStore, mapPayloadToCredential, clearSecretCache };
