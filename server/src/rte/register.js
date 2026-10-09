// An RTE is a runner without anybody adding it : it writes its own row under Connections >
// Runners, so a new install - or a 6.5 install moving to 7 - runs its first playbook without a
// click or a seed. It can, because it has what that row needs : the database, its RTE_TOKEN and
// the ENCRYPTION_SECRET to store that token encrypted. The token never goes through `nodes`.
//
// The address the app reaches it on :
//   RTE_URL set : that (http://rte:8000, a compose service or a kubernetes service) - one row
//                 named after its host, shared by every replica behind it
//   not set     : http(s)://<this container's IP>:<PORT>, named after the node (rte-<host>-<port>)
//                 - a recreated container is a new row, and the old one goes (below)
//
// Checked again every CHECK_MS for as long as the RTE runs :
//   - no row with this address : created ; the first rte runner becomes the default
//   - a row this RTE (or one before it) registered : its token follows RTE_TOKEN
//   - a row added by hand : its token follows RTE_TOKEN, it stays a hand-made row
//   - a row from the config seed : left alone, the seed is authoritative
//   - a row with this name but another address : never overwritten, logged
//   - the default rte runner is a registered row whose RTE stopped answering : this one takes
//     the default, so a recreated container does not leave the default on a dead address
// The worker removes a registered row whose RTE has not answered for a while
// (Runner.removeUnresponsive). RTE_REGISTER=0 turns all of this off.
import os from "os";
import logger from "../lib/logger.js";
import mysql from "../models/db.model.js";
import Runner from "../models/runner.model.js";
import { stripTrailingSlashes } from "../lib/url.js";
import { nodeId as ownNodeId } from "../lib/role.js";

const CHECK_MS = 30000;
// a node that has not written its heartbeat (every 10 s) for this long has stopped : another
// RTE may take its row or the default. Three heartbeats, so a slow database is not a death.
export const GONE_SECONDS = 30;

// this container's first non-internal IPv4 address
export function ownAddress(interfaces = os.networkInterfaces()) {
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) {
      if ((a.family === "IPv4" || a.family === 4) && !a.internal) return a.address;
    }
  }
  return null;
}

// what this RTE registers, or null when RTE_REGISTER=0
export function registration(env = process.env, { https = false, port = 8000, ip = ownAddress(), nodeId = ownNodeId } = {}) {
  if (String(env.RTE_REGISTER ?? "").trim() === "0") return null;
  const given = stripTrailingSlashes(String(env.RTE_URL || "").trim());
  if (!given) {
    if (!ip) throw new Error("this container has no IPv4 address to register : set RTE_URL to the address the app reaches it on");
    return { uri: `${https ? "https" : "http"}://${ip}:${port}`, name: nodeId, token: env.RTE_TOKEN || "", nodeId };
  }
  let url;
  try {
    url = new URL(given);
  } catch {
    throw new Error(`RTE_URL '${given}' is not a url, use for example http://rte:8000`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`RTE_URL '${given}' must start with http:// or https://`);
  }
  // several RTEs on one host differ by their port
  const name = url.port && url.port !== "8000" ? `${url.hostname}-${url.port}` : url.hostname;
  return { uri: given, name, token: env.RTE_TOKEN || "", nodeId };
}

// the node ids among these that stopped answering : no heartbeat for GONE_SECONDS, or no row
async function goneNodes(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Set();
  const rows = await mysql.do(
    "SELECT id FROM AnsibleForms.`nodes` WHERE id IN (?) AND last_seen > (NOW() - INTERVAL ? SECOND)",
    [wanted, GONE_SECONDS],
  );
  const alive = new Set(rows.map((r) => r.id));
  return new Set(wanted.filter((id) => !alive.has(id)));
}

// one check ; what changed, for the log, or null when nothing did
export async function registerOnce(reg) {
  const opts = { fromRte: true };
  const rows = (await Runner.findAll()) || [];
  const others = rows.filter((r) => r.type === "rte" && r.is_default && r.node_id && r.node_id !== reg.nodeId);
  let mine = rows.find((r) => r.type === "rte" && stripTrailingSlashes(String(r.uri || "")) === reg.uri);
  const gone = await goneNodes([mine?.node_id, ...others.map((r) => r.node_id)]);
  const said = [];

  if (mine?.managed) {
    if (mine.token !== reg.token) {
      logger.warning(`RTE : the config seed declares runner '${mine.name}' (${reg.uri}) with another token than this RTE's RTE_TOKEN : jobs on it will be refused`);
    }
    return null;
  }
  if (mine) {
    const change = {};
    if (mine.token !== reg.token) change.token = reg.token;
    // a registered row follows the RTE behind it : a replica, or this one after a restart -
    // never taken from a live one, or two replicas would write it in turn
    if (mine.node_id && mine.node_id !== reg.nodeId && gone.has(mine.node_id)) change.node_id = reg.nodeId;
    if (Object.keys(change).length) {
      await Runner.update(change, mine.id, opts);
      if (change.token) said.push(`runner '${mine.name}' now has this RTE's RTE_TOKEN`);
    }
  } else {
    const taken = rows.find((r) => r.name === reg.name);
    if (taken) {
      logger.warning(`RTE : a runner named '${reg.name}' exists with another address (${taken.uri}) : not registering ${reg.uri} - change RTE_URL, or add this RTE under Connections > Runners`);
      return null;
    }
    const id = await Runner.create(
      { name: reg.name, type: "rte", uri: reg.uri, token: reg.token, node_id: reg.nodeId, description: "Registered by the RTE itself" },
      opts,
    );
    mine = { id, name: reg.name, is_default: !rows.some((r) => r.type === "rte" && r.is_default) };
    said.push(`added itself as runner '${reg.name}' (${reg.uri})${mine.is_default ? ", the default" : ""}`);
  }

  // the default on a registered row whose RTE stopped : this one takes it
  const deadDefault = others.find((r) => gone.has(r.node_id) && r.id !== mine.id);
  if (deadDefault && !mine.is_default) {
    await Runner.update({ is_default: 1 }, mine.id, opts);
    said.push(`runner '${mine.name}' is now the default, '${deadDefault.name}' stopped answering`);
  }
  return said.length ? said.join(" ; ") : null;
}

// For as long as the RTE runs, in the background : on a database being upgraded the runners
// table comes with the worker's schema patch, maybe after this RTE started.
export function registerSelf(env = process.env, { https = false, port = 8000, checkMs = CHECK_MS } = {}) {
  let reg;
  try {
    reg = registration(env, { https, port });
  } catch (e) {
    logger.error(`RTE : ${e.message} ; not registering as a runner`);
    return null;
  }
  if (!reg) {
    logger.notice("RTE : RTE_REGISTER=0, so this RTE does not add itself as a runner : add it under Connections > Runners");
    return null;
  }
  logger.notice(`RTE : registers itself as runner '${reg.name}' (${reg.uri})${env.RTE_URL ? "" : " ; set RTE_URL for a fixed address and name"}`);
  let failing = false;
  let timer = null;
  const tick = async () => {
    try {
      const done = await registerOnce(reg);
      if (done) logger.notice(`RTE : ${done}`);
      failing = false;
    } catch (e) {
      // the first failure says why ; the next ones only in debug, until it works again
      const message = `RTE : could not register as a runner, retrying : ${e.message || e}`;
      if (failing) logger.debug(message);
      else logger.warning(message);
      failing = true;
    } finally {
      timer = setTimeout(tick, checkMs);
      timer.unref?.();
    }
  };
  tick();
  return { stop: () => clearTimeout(timer) };
}
