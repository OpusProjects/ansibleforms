// How long a secret a provider returned stays valid, in seconds. A symbol, so it can never
// collide with a key of the secret itself ; the registry takes it off before anyone sees it.
export const LEASE_SECONDS = Symbol("leaseSeconds");

// Reuse a leased secret for 80% of its lease : long enough not to issue a new account on
// every use, short enough that nothing is used in the moment its lease ends.
export function leaseCacheSeconds(leaseSeconds) {
  return Math.max(1, Math.floor(leaseSeconds * 0.8));
}
