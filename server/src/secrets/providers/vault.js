// HashiCorp Vault : KV v2 (default) and KV v1, token authentication.
import axios from "axios";
import { agentsFor, baseUrl } from "./http.js";
import { stripTrailingSlashes, stripLeadingSlashes } from "../../lib/url.js";

function headers(store) {
  const h = { "X-Vault-Token": store.token };
  if (store.namespace) h["X-Vault-Namespace"] = store.namespace;
  return h;
}

function kvVersion(store) {
  return parseInt(store.kv_version, 10) === 1 ? 1 : 2;
}

// Normalize a vault path. Accepts:
//   "secret/data/foo/bar"   -> used as-is
//   "secret/foo/bar"        -> KV v2 : /data/ inserted after the mount
//   "foo"                   -> prefixed with the store's default mount
export function buildApiPath(rawPath, version, defaultMount) {
  let p = stripLeadingSlashes(rawPath);
  if (!p) throw new Error("Vault path is empty");
  if (!p.includes("/")) p = `${defaultMount || "secret"}/${p}`;
  if (version === 2) {
    const [mount, ...rest] = p.split("/");
    if (rest[0] !== "data" && rest[0] !== "metadata") return `${mount}/data/${rest.join("/")}`;
  }
  return p;
}

function assertConfigured(store) {
  if (!store.url || !store.token) throw new Error(`Secret store '${store.name}' has no url or no token`);
}

/** the secret's key/value pairs */
async function read(store, ref) {
  assertConfigured(store);
  const version = kvVersion(store);
  const apiPath = buildApiPath(ref, version, store.default_mount);
  let res;
  try {
    res = await axios.get(`${baseUrl(store)}/v1/${apiPath}`, { headers: headers(store), ...agentsFor(store), timeout: 10000 });
  } catch (e) {
    const status = e?.response?.status;
    const msg = e?.response?.data?.errors?.join(", ") || e.message;
    throw new Error(`Vault read failed for ${apiPath} (HTTP ${status || "?"}): ${msg}`, { cause: e });
  }
  // KV v2 wraps payload under data.data ; KV v1 puts it directly under data.
  const payload = version === 2 ? res?.data?.data?.data : res?.data?.data;
  if (!payload || typeof payload !== "object") {
    throw new Error(`Vault response for ${apiPath} did not contain a usable secret payload`);
  }
  return payload;
}

// Verifies the address, the token and the namespace WITHOUT reading a secret :
// token/lookup-self needs no policy beyond the token's own, so a correctly configured
// Vault always answers it, whatever the KV mount looks like. Read only by definition.
async function check(store, { timeoutMs = 10000 } = {}) {
  assertConfigured(store);
  try {
    const res = await axios.get(`${baseUrl(store)}/v1/auth/token/lookup-self`, { headers: headers(store), ...agentsFor(store), timeout: timeoutMs });
    const d = res?.data?.data || {};
    // never the token itself, and never its accessor
    return {
      addr: store.url,
      namespace: store.namespace || null,
      kvVersion: kvVersion(store),
      defaultMount: store.default_mount || "secret",
      renewable: !!d.renewable,
      // seconds left, or null for a token that never expires
      ttl: typeof d.ttl === "number" ? d.ttl : null,
      policies: Array.isArray(d.policies) ? d.policies : [],
    };
  } catch (e) {
    const status = e?.response?.status;
    if (status === 403) throw new Error("Vault refused the token (403) - check the token and its policies", { cause: e });
    if (status === 404) throw new Error("Vault did not recognise the token endpoint (404) - check the url", { cause: e });
    throw new Error(`Could not reach Vault at ${store.url} : ${e.message}`, { cause: e });
  }
}

// The KV mounts this token can see, for the Default mount dropdown.
// sys/internal/ui/mounts is what Vault's own UI calls: it returns only what the token is
// allowed to see and needs no root policy, unlike sys/mounts which usually requires sudo.
// A short timeout because this runs on page load.
async function mounts(store) {
  assertConfigured(store);
  let res;
  try {
    res = await axios.get(`${baseUrl(store)}/v1/sys/internal/ui/mounts`, { headers: headers(store), ...agentsFor(store), timeout: 5000 });
  } catch (e) {
    throw new Error(`Could not list the Vault mounts : ${e.message}`, { cause: e });
  }
  const secret = res?.data?.data?.secret || {};
  return Object.entries(secret)
    // only kv : a database or pki mount cannot answer a credential read
    .filter(([, v]) => String(v?.type || "").toLowerCase() === "kv")
    .map(([mountPath, v]) => ({
      path: stripTrailingSlashes(mountPath),
      version: String(v?.options?.version || v?.version || "") || null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export default { type: "vault", read, check, mounts };
