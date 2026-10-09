// An RTE adding itself as a runner (server/src/rte/register.js) : its address and name, found
// again by its address, a hand-made row kept hand-made, a seed row left alone, a taken name
// never overwritten, the default taken from a stopped RTE only, and RTE_REGISTER=0.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let rows;
let writes;
let failReads;
// the nodes that wrote their heartbeat lately
let alive;
vi.mock("../src/models/runner.model.js", () => ({
  default: {
    async findAll() {
      if (failReads > 0) {
        failReads--;
        throw new Error("Table 'AnsibleForms.runners' doesn't exist");
      }
      return rows.map((r) => ({ ...r }));
    },
    async create(data, opts) {
      writes.push({ op: "create", data, opts });
      const row = { id: rows.length + 1, managed: 0, ...data };
      if (!rows.some((r) => r.type === data.type && r.is_default)) row.is_default = 1;
      rows.push(row);
      return row.id;
    },
    async update(data, id, opts) {
      writes.push({ op: "update", data, id, opts });
      Object.assign(rows.find((r) => r.id === id), data);
      return true;
    },
  },
}));
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/FROM AnsibleForms.`nodes` WHERE id IN/.test(sql)) return params[0].filter((id) => alive.has(id)).map((id) => ({ id }));
      return [];
    },
  },
}));

const { registration, registerOnce, registerSelf, ownAddress } = await import("../src/rte/register.js");
const TOKEN = "a-token-of-sixteen-chars";
const ME = "rte-abc123-8000";

beforeEach(() => {
  rows = [{ id: 1, name: "aap", type: "awx", uri: "https://aap", token: "x", managed: 0, is_default: 1 }];
  writes = [];
  failReads = 0;
  alive = new Set([ME]);
});

describe("what an RTE registers", () => {
  test("without RTE_URL : its own IP and port, named after its node", () => {
    assert.deepEqual(registration({ RTE_TOKEN: TOKEN }, { ip: "172.18.0.5", port: 8000, nodeId: ME }), {
      uri: "http://172.18.0.5:8000", name: ME, token: TOKEN, nodeId: ME,
    });
    assert.equal(registration({}, { https: true, ip: "10.0.0.7", port: 8443, nodeId: ME }).uri, "https://10.0.0.7:8443");
  });

  test("with RTE_URL : that address, named after its host, the port only when it is not 8000", () => {
    assert.deepEqual(registration({ RTE_URL: "http://rte:8000/", RTE_TOKEN: TOKEN }, { nodeId: ME }), {
      uri: "http://rte:8000", name: "rte", token: TOKEN, nodeId: ME,
    });
    assert.equal(registration({ RTE_URL: "http://127.0.0.1:8010" }).name, "127.0.0.1-8010");
    assert.equal(registration({ RTE_URL: "https://rte.af.svc.cluster.local" }).name, "rte.af.svc.cluster.local");
  });

  test("RTE_REGISTER=0 : nothing", () => {
    assert.equal(registration({ RTE_REGISTER: "0", RTE_URL: "http://rte:8000" }), null);
    assert.notEqual(registration({ RTE_REGISTER: "1", RTE_URL: "http://rte:8000" }), null);
  });

  test("an RTE_URL that is no http(s) url, or no address at all, is refused", () => {
    assert.throws(() => registration({ RTE_URL: "rte:8000" }), /http:\/\/ or https:\/\//);
    assert.throws(() => registration({ RTE_URL: "not a url" }), /not a url/);
    assert.throws(() => registration({}, { ip: null }), /set RTE_URL/);
  });

  test("its address is the first non-internal IPv4", () => {
    assert.equal(ownAddress({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }], eth0: [{ family: "IPv6", address: "fe80::1", internal: false }, { family: "IPv4", address: "172.18.0.5", internal: false }] }), "172.18.0.5");
    assert.equal(ownAddress({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }] }), null);
  });
});

describe("registering", () => {
  const reg = { uri: "http://rte:8000", name: "rte", token: TOKEN, nodeId: ME };

  test("a new RTE is created, marked with its node, and is the first default", async () => {
    assert.match(await registerOnce(reg), /added itself as runner 'rte' \(http:\/\/rte:8000\), the default/);
    assert.equal(writes.length, 1);
    const { op, data, opts } = writes[0];
    assert.equal(op, "create");
    assert.equal(opts.fromRte, true);
    assert.deepEqual({ name: data.name, type: data.type, uri: data.uri, token: data.token, node_id: data.node_id }, { name: "rte", type: "rte", uri: "http://rte:8000", token: TOKEN, node_id: ME });
  });

  test("the next checks, or a replica behind the same address, change nothing", async () => {
    await registerOnce(reg);
    assert.equal(await registerOnce(reg), null);
    alive.add("rte-other-8000");
    assert.equal(await registerOnce({ ...reg, nodeId: "rte-other-8000" }), null);
    assert.equal(writes.length, 1);
  });

  test("a registered row whose RTE stopped follows the one now behind its address", async () => {
    rows.push({ id: 2, name: "rte", type: "rte", uri: "http://rte:8000", token: TOKEN, node_id: "rte-old-8000", managed: 0, is_default: 1 });
    await registerOnce(reg);
    assert.deepEqual(writes.map((w) => w.data), [{ node_id: ME }]);
  });

  test("a row added by hand : found by its address, its token follows RTE_TOKEN, it stays hand-made", async () => {
    rows.push({ id: 2, name: "my-rte", type: "rte", uri: "http://rte:8000/", token: "old-token-old-token", node_id: null, managed: 0, is_default: 1 });
    assert.match(await registerOnce(reg), /'my-rte' now has this RTE's RTE_TOKEN/);
    assert.deepEqual(writes.map((w) => w.data), [{ token: TOKEN }]);
  });

  test("a runner from the config seed is left alone", async () => {
    rows.push({ id: 2, name: "rte", type: "rte", uri: "http://rte:8000", token: "seed-token-seed-token", managed: 1, is_default: 1 });
    assert.equal(await registerOnce(reg), null);
    assert.equal(writes.length, 0);
  });

  test("a runner with that name and another address is never overwritten", async () => {
    rows.push({ id: 2, name: "rte", type: "rte", uri: "http://other:8000", token: "t", managed: 0 });
    assert.equal(await registerOnce(reg), null);
    assert.equal(writes.length, 0);
  });

  test("an awx runner at the same address is not this RTE", async () => {
    rows.push({ id: 2, name: "awx-here", type: "awx", uri: "http://rte:8000", token: "t", managed: 0 });
    await registerOnce(reg);
    assert.equal(writes[0].op, "create");
  });
});

describe("the default", () => {
  const reg = { uri: "http://172.18.0.9:8000", name: ME, token: TOKEN, nodeId: ME };

  test("taken from a registered RTE that stopped : a recreated container", async () => {
    rows.push({ id: 2, name: "rte-old-8000", type: "rte", uri: "http://172.18.0.5:8000", token: TOKEN, node_id: "rte-old-8000", managed: 0, is_default: 1 });
    const said = await registerOnce(reg);
    assert.match(said, /is now the default, 'rte-old-8000' stopped answering/);
    assert.equal(rows.find((r) => r.name === ME).is_default, 1);
  });

  test("never taken from a live RTE", async () => {
    alive.add("rte-other-8000");
    rows.push({ id: 2, name: "rte-other-8000", type: "rte", uri: "http://172.18.0.5:8000", token: TOKEN, node_id: "rte-other-8000", managed: 0, is_default: 1 });
    await registerOnce(reg);
    assert.ok(!rows.find((r) => r.name === ME).is_default);
  });

  test("never taken from a runner added by hand or by the seed", async () => {
    rows.push({ id: 2, name: "by-hand", type: "rte", uri: "http://somewhere:8000", token: TOKEN, node_id: null, managed: 0, is_default: 1 });
    await registerOnce(reg);
    assert.ok(!rows.find((r) => r.name === ME).is_default);
  });
});

describe("in the background", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  test("RTE_REGISTER=0 does nothing", async () => {
    assert.equal(registerSelf({ RTE_REGISTER: "0", RTE_TOKEN: TOKEN }), null);
    await settle();
    assert.equal(writes.length, 0);
  });

  test("a bad RTE_URL does not stop the RTE", () => {
    assert.equal(registerSelf({ RTE_URL: "rte:8000", RTE_TOKEN: TOKEN }), null);
  });

  test("keeps trying until the runners table is there", async () => {
    failReads = 2;
    const running = registerSelf({ RTE_URL: "http://rte:8000", RTE_TOKEN: TOKEN }, { checkMs: 1 });
    for (let i = 0; i < 50 && !writes.length; i++) await settle();
    running.stop();
    assert.equal(failReads, 0);
    assert.equal(writes.filter((w) => w.op === "create").length, 1);
  });

  test("a deleted row comes back on the next check", async () => {
    const running = registerSelf({ RTE_URL: "http://rte:8000", RTE_TOKEN: TOKEN }, { checkMs: 1 });
    for (let i = 0; i < 50 && !writes.length; i++) await settle();
    rows = rows.filter((r) => r.name !== "rte");
    for (let i = 0; i < 50 && writes.length < 2; i++) await settle();
    running.stop();
    assert.equal(writes.filter((w) => w.op === "create").length, 2);
  });
});
