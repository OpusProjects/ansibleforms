// Before 7 the only secret store was a HashiCorp Vault configured with VAULT_*
// environment variables. The first 7.x start that finds them set imports them ONCE as the
// secret store named `vault`, and records that in settings.vault_env_imported_at. From then
// on the store row is the only truth and the variables are ignored - a store deleted later
// is never re-imported, and it does not matter when or how the schema was created.
import SecretStore from "../models/secretStore.model.js";
import { VAULT_STORE_NAME } from "./providers/index.js";
import logger from "../lib/logger.js";
import mysql from "../models/db.model.js";

const DEFAULT_CACHE_TTL_SECONDS = 60;

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

async function readMarker() {
  const rows = await mysql.do("SELECT vault_env_imported_at FROM AnsibleForms.`settings` LIMIT 1");
  return rows?.[0]?.vault_env_imported_at || null;
}

// upsert : the settings row can be missing on a fresh or partly restored database
async function writeMarker() {
  const now = new Date();
  const ins = await mysql.do(
    "INSERT INTO AnsibleForms.`settings` (vault_env_imported_at) SELECT ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM AnsibleForms.`settings`)",
    [now]
  );
  if (!ins?.affectedRows) await mysql.do("UPDATE AnsibleForms.`settings` SET vault_env_imported_at = ?", [now]);
}

/**
 * At every start, once the schema is ready. Imports the VAULT_* variables the first time it
 * sees them, and only warns after that. Returns what it did : "none", "imported", "kept"
 * (a store named vault was already there) or "ignored" (imported before).
 */
export async function importVaultFromEnvOnce({ env = process.env, marker = { read: readMarker, write: writeMarker } } = {}) {
  if (!vaultEnvIsSet(env)) return "none";
  if (await marker.read()) {
    logger.warning("The VAULT_* environment variables are ignored : they were imported as the secret store 'vault' before - manage it under Connections > Secret stores and remove them from the environment");
    return "ignored";
  }
  let outcome;
  if (await SecretStore.findByName(VAULT_STORE_NAME)) {
    logger.warning(`A secret store named '${VAULT_STORE_NAME}' already exists - the VAULT_* environment variables were not imported and are ignored from now on`);
    outcome = "kept";
  } else {
    await SecretStore.create(vaultStoreFromEnv(env));
    logger.warning(`Imported the VAULT_* environment variables as the secret store '${VAULT_STORE_NAME}' - they are ignored from now on, remove them from the environment`);
    outcome = "imported";
  }
  await marker.write();
  return outcome;
}
