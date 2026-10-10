// Live events : a change reaches this process's streams at once and the others through the
// 'live:<name>' counter, at most once a second per name ; the stream keeps itself alive.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const bumps = [];
vi.mock("../src/lib/epochs.js", () => ({ bump: (name) => bumps.push(name) }));
let rows = [];
vi.mock("../src/models/db.model.js", () => ({ default: { tryDo: async () => rows } }));

const Live = await import("../src/lib/liveEvents.js");

// a response that records what was written, and a request that can close
function fakeStream() {
  const req = new EventEmitter();
  req.setTimeout = () => {};
  const res = { headers: null, chunks: [], writeHead(code, h) { this.code = code; this.headers = h; }, write(c) { this.chunks.push(c); }, setTimeout() {}, flushHeaders() {} };
  return { req, res, events: () => res.chunks.filter((c) => c.startsWith("event: changed")).map((c) => JSON.parse(c.split("data: ")[1]).name) };
}

beforeEach(() => {
  vi.useFakeTimers();
  Live.resetLiveEvents();
  bumps.length = 0;
  rows = [];
});
afterEach(() => vi.useRealTimers());

describe("the stream", () => {
  test("opens with headers that keep proxies from buffering it, padding and a retry", () => {
    const s = fakeStream();
    Live.stream(s.req, s.res);
    assert.equal(s.res.code, 200);
    assert.match(s.res.headers["Content-Type"], /text\/event-stream/);
    assert.equal(s.res.headers["X-Accel-Buffering"], "no");
    assert.match(s.res.headers["Cache-Control"], /no-transform/);
    assert.ok(s.res.chunks[0].length > 2048, "2 KB of padding first");
    assert.match(s.res.chunks[0], /retry: 3000/);
    s.req.emit("close");
  });

  test("sends a heartbeat every 15 seconds, and forgets a closed stream", () => {
    const s = fakeStream();
    Live.stream(s.req, s.res);
    vi.advanceTimersByTime(15000);
    assert.ok(s.res.chunks.some((c) => c.startsWith(": ping")));
    s.req.emit("close");
    assert.equal(Live.clientCount(), 0);
  });
});

describe("publishing", () => {
  test("reaches this process's streams at once, and the other processes through the counter", () => {
    const s = fakeStream();
    Live.stream(s.req, s.res);
    Live.publish("jobs");
    assert.deepEqual(s.events(), ["jobs"]);
    assert.deepEqual(bumps, ["live:jobs"]);
    s.req.emit("close");
  });

  test("a burst is sent once now and once at the end of the second, never more", () => {
    const s = fakeStream();
    Live.stream(s.req, s.res);
    for (let i = 0; i < 50; i++) Live.publish("jobs");
    assert.equal(s.events().length, 1);
    vi.advanceTimersByTime(1000);
    assert.equal(s.events().length, 2, "the last change of the burst is sent too");
    assert.equal(bumps.length, 2);
    s.req.emit("close");
  });
});

describe("hearing the other processes", () => {
  test("a live counter that moved is sent ; the first read only records them", async () => {
    // opening the stream does the first read : it records where the counters stand
    rows = [{ name: "live:jobs", version: 1 }];
    const s = fakeStream();
    Live.stream(s.req, s.res);
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(s.events(), []);
    rows = [{ name: "live:jobs", version: 2 }];
    assert.deepEqual(await Live.pollLive(), ["jobs"]);
    assert.deepEqual(s.events(), ["jobs"]);
    s.req.emit("close");
  });
});
