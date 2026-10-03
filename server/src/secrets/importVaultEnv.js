// Before 7.1 the only secret store was a HashiCorp Vault configured with VAULT_*
// environment variables. Upgrading imports them ONCE as the secret store named `vault` :
// importVaultFromEnv runs from the schema patch that adds credentials.secret_store, which
// happens a single time in a database's life. From then on the store row is the only
// truth and the variables are ignored - a store deleted later is never re-imported.
import SecretStore from "../models/secretStore.model.js";
import { VAULT_STORE_NAME } from "./providers/index.js";
import logger from "../lib/logger.js";

const DEFAULT_CACHE_TTL_SECONDS = 60;

// the upgrade's own message says it all on the boot that imports
let importedThisBoot = false;

/**
 * VAULT_CACHE_TTL_MS (milliseconds) to the store's cache_ttl_seconds. A plain
 * Math.round(ms/1000) went wrong twice : "60s" parses to NaN, and anything below 500ms
 * rounds to 0, which is "do not cache" for a store. A positive value therefore clamps to
 * one second, an unparseable one falls back to the default. An explicit 0 stays 0.
 */
export function resolveCacheTtlSeconds(ms, fallbackSeconds = DEFAULT_CACHE_TTL_SECONDS) {
  const parsed = parseInt(ms, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackSeconds;
  if (parsed === 0) return 0;
  return Math.max(1, Math.round(parsed / 1000));
}

export function vaultEnvIsSet(env = process.env) {
  return !!(env.VAULT_ADDR && env.VAULT_TOKEN);
}

/** The secret store row the VAULT_* variables describe. */
export function vaultStoreFromEnv(env = process.env) {
  return {
    name: VAULT_STORE_NAME,
    type: "vault",
    description: "Imported from the VAULT_* environment variables",
    url: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    namespace: env.VAULT_NAMESPACE || null,
    kv_version: parseInt(env.VAULT_KV_VERSION || "2", 10) === 1 ? 1 : 2,
    default_mount: env.VAULT_DEFAULT_MOUNT || "secret",
    ignore_certs: ["true", "1"].includes(String(env.VAULT_SKIP_VERIFY || "").toLowerCase()),
    cache_ttl_seconds: resolveCacheTtlSeconds(env.VAULT_CACHE_TTL_MS),
  };
}

/** Called once, by the upgrade. Returns what it did, for the patch log. */
export async function importVaultFromEnv(env = process.env) {
  if (!vaultEnvIsSet(env)) return "No VAULT_* environment variables to import";
  if (await SecretStore.findByName(VAULT_STORE_NAME)) {
    const message = `A secret store named '${VAULT_STORE_NAME}' already exists - the VAULT_* environment variables were not imported`;
    logger.warning(message);
    return message;
  }
  await SecretStore.create(vaultStoreFromEnv(env));
  importedThisBoot = true;
  const message = `Imported the VAULT_* environment variables as the secret store '${VAULT_STORE_NAME}' - they are ignored from now on, remove them from the environment`;
  logger.warning(message);
  return message;
}

/** At every start : variables still set are ignored, and the operator should know. */
export function warnIgnoredVaultEnv(env = process.env) {
  if (!vaultEnvIsSet(env) || importedThisBoot) return false;
  logger.warning(`The VAULT_* environment variables are ignored since 7.1 (they are imported once, when upgrading) - manage the Vault under Connections > Secret stores and remove them from the environment`);
  return true;
}
