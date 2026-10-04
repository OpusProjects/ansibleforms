// CyberArk Central Credential Provider (CCP) : the REST interface of the CyberArk Application
// Access Manager. The application authenticates by its AppID, which the vault admin restricts
// to client certificates, allowed machines (IP/hostname) and/or OS users.
//
//   GET {url}/AIMWebService/api/Accounts?AppID=<app_id>&Safe=..&Object=..
//   200 { Content, UserName, Address, Database, PolicyID, Safe, Folder, Name, ... }
//   4xx { ErrorCode: "APPAP004E", ErrorMsg: "Password object matching query [..] was not found" }
//
// The reference names the account, as ;-separated pairs :
//   Safe=Linux;Object=root-srv01
//   Safe=DB;UserName=forms;Address=db01.example.com
//   Query=Safe=Linux;Folder=Root;Object=root-srv01   (the rest is passed as CCP's Query)
import axios from "axios";
import { agentsFor, baseUrl } from "./http.js";
import SecretStore from "../../models/secretStore.model.js";

const PATH = "/AIMWebService/api/Accounts";

// What a reference may set. AppID is the store's, never the reference's : a form author
// must not be able to borrow another application's identity.
const ALLOWED = ["Safe", "Folder", "Object", "UserName", "Address", "Database", "PolicyID", "Reason", "Query", "QueryFormat", "ConnectionTimeout", "FailRequestOnPasswordChange"];
const CANONICAL = Object.fromEntries(ALLOWED.map((k) => [k.toLowerCase(), k]));

/** the reference as CCP query parameters, AppID and Reason added */
export function buildQuery(store, ref) {
  const params = {};
  const raw = String(ref || "").trim();
  if (!raw) throw new Error("CyberArk reference is empty - use e.g. Safe=<safe>;Object=<account>");
  if (/^query=/i.test(raw)) {
    // everything after Query= is CCP's own query syntax, ; included
    params.Query = raw.slice(raw.indexOf("=") + 1);
  } else {
    for (const pair of raw.split(";")) {
      if (!pair.trim()) continue;
      const eq = pair.indexOf("=");
      if (eq < 1) throw new Error(`CyberArk reference : '${pair.trim()}' is not key=value`);
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (key.toLowerCase() === "appid") continue;
      const canonical = CANONICAL[key.toLowerCase()];
      if (!canonical) throw new Error(`CyberArk reference : '${key}' is not supported - use ${ALLOWED.join(", ")}`);
      params[canonical] = value;
    }
  }
  if (params.Query && !params.QueryFormat) params.QueryFormat = "Exact";
  const extra = SecretStore.extraOf(store);
  if (!params.Reason && extra.reason) params.Reason = String(extra.reason);
  if (!store.app_id) throw new Error(`Secret store '${store.name}' has no AppID`);
  return { AppID: store.app_id, ...params };
}

function queryString(params) {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function timeoutOf(store, fallback) {
  const t = parseInt(SecretStore.extraOf(store).timeout_ms, 10);
  return Number.isFinite(t) && t > 0 ? t : fallback;
}

// "APPAP004E : Password object matching query [...] was not found" - never the request,
// which can name the safe and account but holds nothing secret either
function describeError(e) {
  const status = e?.response?.status;
  const data = e?.response?.data;
  if (data && typeof data === "object" && (data.ErrorCode || data.ErrorMsg)) {
    return { status, code: data.ErrorCode || "", text: `${data.ErrorCode || "error"} : ${data.ErrorMsg || ""}`.trim() };
  }
  return { status, code: "", text: e?.message || String(e) };
}

async function request(store, params, timeoutMs) {
  return axios.get(`${baseUrl(store)}${PATH}?${queryString(params)}`, {
    ...agentsFor(store),
    timeout: timeoutMs,
    headers: { Accept: "application/json" },
  });
}

/** the account, under the names the registry maps : username, password, address, port, database */
async function read(store, ref) {
  const params = buildQuery(store, ref);
  let res;
  try {
    res = await request(store, params, timeoutOf(store, 10000));
  } catch (e) {
    const err = describeError(e);
    throw new Error(`CyberArk CCP read failed (HTTP ${err.status || "?"}): ${err.text}`, { cause: e });
  }
  const account = res?.data;
  if (!account || typeof account !== "object" || account.Content === undefined) {
    throw new Error("CyberArk CCP answered without a password (no Content in the response)");
  }
  const { Content, UserName, Address, Port, Database, ...rest } = account;
  return {
    ...rest,
    username: UserName ?? "",
    password: Content,
    ...(Address ? { address: Address } : {}),
    ...(Port ? { port: Port } : {}),
    ...(Database ? { database: Database } : {}),
  };
}

// Without extra.check_ref : ask for nothing in particular. A provider that knows the AppID
// answers with an APPAP error about the missing query ; one that refuses the application
// (wrong AppID, certificate or machine) answers 403. With extra.check_ref : a real read,
// reporting who and where, never the password.
async function check(store, { timeoutMs } = {}) {
  const timeout = timeoutMs || timeoutOf(store, 10000);
  const extra = SecretStore.extraOf(store);
  const base = { addr: store.url, appId: store.app_id || null, clientCertificate: !!store.client_cert };
  if (extra.check_ref) {
    const account = await read({ ...store, extra: JSON.stringify({ ...extra, timeout_ms: timeout }) }, extra.check_ref);
    return { ...base, checkRef: extra.check_ref, userName: account.username, address: account.address || null };
  }
  if (!store.app_id) throw new Error(`Secret store '${store.name}' has no AppID`);
  try {
    await request(store, { AppID: store.app_id }, timeout);
    return { ...base, note: "CCP answered" };
  } catch (e) {
    const err = describeError(e);
    if (err.status === 403 || err.status === 401) {
      throw new Error(`CyberArk CCP refused AppID '${store.app_id}' (HTTP ${err.status}): ${err.text} - check the AppID and its allowed machines or certificate`, { cause: e });
    }
    if (err.status && /^APPAP/i.test(err.code)) {
      return { ...base, note: `CCP reachable and AppID accepted (${err.text}) - set extra.check_ref to test a real account` };
    }
    throw new Error(`Could not reach CyberArk CCP at ${store.url} : ${err.text}`, { cause: e });
  }
}

export default { type: "cyberark_ccp", read, check };
