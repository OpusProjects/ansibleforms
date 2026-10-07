// An RTE need not follow every app release : the app accepts any RTE that speaks the same
// contract (src/rte/contract.js), and refuses one that does not, saying which side to update.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let health;
vi.mock("axios", () => ({
  default: { create: () => ({ get: async () => ({ data: health }) }) },
}));

const { RTE_CONTRACT } = await import("../src/rte/contract.js");
const { default: rte } = await import("../src/runners/rte.js");
const { version: appVersion } = (await import("../package.json", { with: { type: "json" } })).default;
const runner = { name: "rte-1", type: "rte", uri: "http://rte:8000", token: "t" };

beforeEach(() => {
  health = { id: "rte-1", version: appVersion, contract: RTE_CONTRACT, ansible: "2.18.1", running: [] };
});

describe("the contract decides, not the release", () => {
  test("the same release and contract : accepted", async () => {
    const info = await rte.check(runner);
    assert.equal(info.contract, RTE_CONTRACT);
    assert.equal(info.olderRelease, false);
  });

  test("an older release that speaks the same contract : accepted, and said to be older", async () => {
    health.version = "7.0.0";
    const info = await rte.check(runner);
    assert.equal(info.olderRelease, true);
    assert.equal(info.version, "7.0.0");
  });

  test("an older contract : refused, update the RTE", async () => {
    health.contract = RTE_CONTRACT - 1;
    await assert.rejects(rte.check(runner), /needs contract \d+ : update the RTE/);
  });

  test("a newer contract : refused, update the app", async () => {
    health.contract = RTE_CONTRACT + 1;
    await assert.rejects(rte.check(runner), /update this app/);
  });

  test("no contract at all (a preview build) : refused, update the RTE", async () => {
    delete health.contract;
    await assert.rejects(rte.check(runner), /no contract .* update the RTE/);
  });
});
