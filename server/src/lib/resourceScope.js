/******************************************************************/
/*                                                                */
/*  What a user may use, by role : the credentials, the secret    */
/*  stores and the runners. A role in config.yaml may list them : */
/*                                                                */
/*    - name: ops                                                 */
/*      groups: [local/ops]                                       */
/*      credentials: ["vcenter", "cmdb-.*"]   # regexes, whole    */
/*      secretStores: [vault]                 # names             */
/*      runners: [rte]                        # names             */
/*                                                                */
/*  A user none of whose roles lists a kind may use every one of  */
/*  that kind, as before. Once a role lists it, the user may use  */
/*  what any of the roles that list it allow. The admin role is   */
/*  never limited.                                                */
/*                                                                */
/*  The scope of the user a request runs for travels with it      */
/*  (AsyncLocalStorage) : resolving a credential - for a job, a   */
/*  form query or fnCredentials - checks it there.                */
/*                                                                */
/******************************************************************/
import { AsyncLocalStorage } from "async_hooks";
import Errors from "./errors.js";

const storage = new AsyncLocalStorage();

/**
 * A role's list as whole-name regexes ; a pattern that is no valid regex matches only itself.
 *
 * Args:
 *   patterns (string[]): the role's patterns.
 *
 * Returns:
 *   RegExp[]: the patterns, anchored.
 */
function compile(patterns) {
  return patterns.map((p) => {
    try {
      return new RegExp(`^(?:${p})$`);
    } catch {
      return new RegExp(`^${String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    }
  });
}

/**
 * The scope of a user : what their roles allow, from the roles of the configuration.
 *
 * Args:
 *   user (object): the user (roles : the names of their roles).
 *   configRoles (object[]): the roles of the configuration (config.yaml).
 *
 * Returns:
 *   object|null: { user, credentials: RegExp[]|null, secretStores: Set|null,
 *     runners: Set|null } - null for a kind nothing limits ; null altogether for an admin
 *     or a user nothing limits.
 */
export function scopeFromRoles(user, configRoles = []) {
  const names = user?.roles || [];
  if (!user || names.includes("admin")) return null;
  const mine = (configRoles || []).filter((r) => r && names.includes(r.name));
  const listed = (key) => {
    const lists = mine.filter((r) => Array.isArray(r[key])).map((r) => r[key].map(String));
    return lists.length ? lists.flat() : null;
  };
  const credentials = listed("credentials");
  const secretStores = listed("secretStores");
  const runners = listed("runners");
  if (!credentials && !secretStores && !runners) return null;
  return {
    user: user.username || "",
    credentials: credentials ? compile(credentials) : null,
    secretStores: secretStores ? new Set(secretStores) : null,
    runners: runners ? new Set(runners) : null,
  };
}

/**
 * Runs a function inside a scope : what it resolves is checked against it.
 *
 * Args:
 *   scope (object|null): the scope ; null runs it without one.
 *   fn (function): the function.
 *
 * Returns:
 *   any: what the function returns.
 */
export function runWithScope(scope, fn) {
  return scope ? storage.run(scope, fn) : storage.exit(fn);
}

/**
 * The scope of the request running now.
 *
 * Returns:
 *   object|null: the scope, or null outside one.
 */
export function currentScope() {
  return storage.getStore() || null;
}

/**
 * Refuses a credential the scope does not allow.
 *
 * Args:
 *   name (string): the credential's name ("__self__" for the app's own database).
 *   scope (object|null): the scope, the current one by default.
 *
 * Raises:
 *   Errors.AccessDeniedError: the scope does not allow it.
 */
export function assertCredentialAllowed(name, scope = currentScope()) {
  if (!scope?.credentials) return;
  if (scope.credentials.some((re) => re.test(String(name)))) return;
  throw new Errors.AccessDeniedError(`Your roles do not allow the credential '${name}'`);
}

/**
 * Refuses a secret store the scope does not allow (an inline secret:<store>:<ref>).
 *
 * Args:
 *   store (string): the store's name.
 *   scope (object|null): the scope, the current one by default.
 *
 * Raises:
 *   Errors.AccessDeniedError: the scope does not allow it.
 */
export function assertSecretStoreAllowed(store, scope = currentScope()) {
  if (!scope?.secretStores) return;
  if (scope.secretStores.has(String(store))) return;
  throw new Errors.AccessDeniedError(`Your roles do not allow the secret store '${store}'`);
}

/**
 * Refuses a runner the scope does not allow.
 *
 * Args:
 *   name (string): the runner's name.
 *   scope (object|null): the scope, the current one by default.
 *
 * Raises:
 *   Errors.AccessDeniedError: the scope does not allow it.
 */
export function assertRunnerAllowed(name, scope = currentScope()) {
  if (!scope?.runners) return;
  if (scope.runners.has(String(name))) return;
  throw new Errors.AccessDeniedError(`Your roles do not allow the runner '${name}'`);
}

export default { scopeFromRoles, runWithScope, currentScope, assertCredentialAllowed, assertSecretStoreAllowed, assertRunnerAllowed };
