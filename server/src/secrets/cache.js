// The secret payloads read from a store, kept for the store's own cache_ttl_seconds.
// Its own module so the secret store model can flush it without importing the providers.
import NodeCache from "node-cache";

// stdTTL is only the fallback : every set() passes the store's ttl. node-cache reads a ttl
// of 0 as UNLIMITED, so a store with cache_ttl_seconds 0 bypasses this cache instead.
const cache = new NodeCache({ stdTTL: 60, checkperiod: 60 });

export function getCached(key) {
  return cache.get(key);
}

export function setCached(key, payload, ttlSeconds) {
  if (ttlSeconds > 0) cache.set(key, payload, ttlSeconds);
}

// a store that changed or went away must not keep serving what it returned before
export function clearSecretCache() {
  cache.flushAll();
}
