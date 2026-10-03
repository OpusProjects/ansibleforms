// Keep-alive agents for the secret store providers, one per TLS setup, so a read reuses its
// TCP+TLS socket instead of doing the full handshake on every credential resolution.
import http from "http";
import https from "https";
import { createHash } from "crypto";

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 10 });
const httpsAgents = new Map();

const digest = (v) => (v ? createHash("sha256").update(String(v)).digest("hex").slice(0, 16) : "");

/**
 * axios options for a store : the agent honours ignore_certs, a CA bundle and, for stores
 * that authenticate with one (CyberArk CCP), a client certificate and key.
 */
export function agentsFor(store) {
  const key = [store.ignore_certs ? 1 : 0, digest(store.ca_bundle), digest(store.client_cert), digest(store.client_key)].join("|");
  let agent = httpsAgents.get(key);
  if (!agent) {
    agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      rejectUnauthorized: !store.ignore_certs,
      ca: store.ca_bundle || undefined,
      cert: store.client_cert || undefined,
      key: store.client_key || undefined,
    });
    httpsAgents.set(key, agent);
  }
  return { httpAgent, httpsAgent: agent };
}

export function baseUrl(store) {
  return String(store.url || "").replace(/\/+$/, "");
}
