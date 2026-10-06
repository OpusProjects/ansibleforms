// #548 : since 6.3.0 the browser gets a handoff token, not the Azure access token - and
// still sent it to Microsoft Graph, which answered 401 and no Azure AD login completed.
// The server now reads the groups from Graph itself, at the login step.
import { describe, test, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));
const provider = { enable: 1, groupfilter: "^af-" };
vi.mock("../src/models/azureAd.model.js", () => ({ default: { isEnabled: async () => provider, find: async () => provider } }));
vi.mock("../src/models/user.model.js", () => ({ default: { getRolesAndOptions: async (groups) => ({ roles: groups, options: { allowLogin: true } }) } }));
vi.mock("../src/models/audit.model.js", () => ({ default: { log: async () => {} } }));

const { signHandoff } = await import("../src/lib/ssoHandoff.js");
const { fetchAzureGroups, filterGroups } = await import("../src/lib/azureGraph.js");
const controller = (await import("../src/controllers/v2/login.controller.js")).default;
const authConfig = (await import("../config/auth.config.js")).default;

const azureToken = jwt.sign({ aud: "graph", iss: "https://sts.windows.net/t/", exp: Math.floor(Date.now() / 1000) + 600, upn: "alice@example.com", oid: "1234" }, "microsoft");

const graph = (pages, status = 200) => vi.fn(async (url, init) => {
  graph.calls.push({ url, auth: init.headers.authorization });
  const n = graph.calls.length - 1;
  return { ok: status < 400, status, text: async () => JSON.stringify(status < 400 ? pages[n] : { error: { code: "InvalidAuthenticationToken", message: "Signing key is invalid." } }) };
});
const res = () => { const r = { statusCode: 200, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const req = (token) => ({ body: { token }, headers: {}, ip: "127.0.0.1" });

beforeEach(() => { graph.calls = []; });

describe("the groups come from Graph, through the server", () => {
  test("every page, the display names only", async () => {
    const f = graph([
      { value: [{ displayName: "af-admins" }, { displayName: null }, { id: "x" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$skiptoken=2" },
      { value: [{ displayName: "everyone" }] },
    ]);
    expect(await fetchAzureGroups("tok", "https://graph.microsoft.com/", { fetchImpl: f })).toEqual(["af-admins", "everyone"]);
    expect(graph.calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=displayName&$top=999");
    expect(graph.calls[1].url).toContain("$skiptoken=2");
    expect(graph.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  test("the group filter : a regular expression, an invalid one lets everything through", () => {
    expect(filterGroups(["af-admins", "everyone"], "^af-")).toEqual(["af-admins"]);
    expect(filterGroups(["af-admins", "everyone"], "")).toEqual(["af-admins", "everyone"]);
    expect(filterGroups(["af-admins"], "(")).toEqual(["af-admins"]);
  });

  test("the login : handoff in, Graph called with the opened access token, filtered groups prefixed, a jwt out", async () => {
    vi.stubGlobal("fetch", graph([{ value: [{ displayName: "af-admins" }, { displayName: "everyone" }] }]));
    const r = res();
    await controller.azureadoauth2login(req(signHandoff(azureToken, "azuread")), r);
    expect(r.statusCode).toBe(200);
    expect(graph.calls[0].auth).toBe(`Bearer ${azureToken}`);
    const user = jwt.verify(r.body.token, authConfig.secret).user;
    expect(user).toMatchObject({ username: "alice@example.com", type: "azuread", groups: ["azuread/af-admins"], roles: ["azuread/af-admins"] });
  });

  test("a handoff without a sealed access token falls back to its groups claim, filtered too", async () => {
    vi.stubGlobal("fetch", graph([]));
    const r = res();
    await controller.azureadoauth2login(req(signHandoff({ upn: "alice@example.com", oid: "1234", groups: ["af-ops", "everyone"] }, "azuread")), r);
    expect(r.statusCode).toBe(200);
    expect(graph.calls).toHaveLength(0);
    expect(jwt.verify(r.body.token, authConfig.secret).user.groups).toEqual(["azuread/af-ops"]);
  });

  test("Graph refusing the token fails the login with the reason, logged on the server", async () => {
    vi.stubGlobal("fetch", graph([], 401));
    const r = res();
    await controller.azureadoauth2login(req(signHandoff(azureToken, "azuread")), r);
    expect(r.statusCode).toBe(401);
    expect(JSON.stringify(r.body)).toMatch(/Microsoft Graph returned 401 InvalidAuthenticationToken/);
  });

  test("an access token in the url, or a made-up handoff, is refused", async () => {
    vi.stubGlobal("fetch", graph([{ value: [] }]));
    for (const token of [azureToken, jwt.sign({ upn: "mallory", sso: "azuread" }, "not-our-secret")]) {
      const r = res();
      await controller.azureadoauth2login(req(token), r);
      expect(r.statusCode).toBe(401);
    }
    expect(graph.calls).toHaveLength(0);
  });
});
