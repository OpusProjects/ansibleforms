// The worker lock (server/src/lib/workerLock.js) : one process does the background work, and
// it is never two, nor none for long. The database is a scripted fake connection : each test
// says who holds the lock and whether a worker heartbeats.
import { test, describe, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// the database as the lock connection sees it
const MY_ID = 100;
let db;
function freshDb() {
  return {
    holder: null,          // connection id holding the lock
    workerAlive: false,    // a nodes row with is_worker=1 and a fresh last_seen
    reachable: true,
    killed: [],
  };
}
vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: async () => {
      if (!db.reachable) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      return {
        on() {},
        destroy() {},
        end: async () => {},
        query: async ({ sql }) => {
          if (!db.reachable) throw new Error("Connection lost");
          if (/GET_LOCK/.test(sql)) {
            if (db.holder == null || db.holder === MY_ID) { db.holder = MY_ID; return [[{ got: 1 }]]; }
            return [[{ got: 0 }]];
          }
          if (/IS_USED_LOCK\(\?\) = CONNECTION_ID\(\)/.test(sql)) return [[{ mine: db.holder === MY_ID ? 1 : 0 }]];
          if (/IS_USED_LOCK/.test(sql)) return [[{ holder: db.holder }]];
          if (/FROM AnsibleForms.`nodes`/.test(sql)) return [[{ n: db.workerAlive ? 1 : 0 }]];
          if (/^KILL (\d+)/.test(sql)) { db.killed.push(Number(sql.split(" ")[1])); db.holder = null; return [{}]; }
          if (/RELEASE_LOCK/.test(sql)) { if (db.holder === MY_ID) db.holder = null; return [[{}]]; }
          return [[]];
        },
      };
    },
  },
}));
const died = [];
vi.mock("../src/lib/die.js", () => ({ die: async (message) => { died.push(message); } }));

let lock;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  db = freshDb();
  died.length = 0;
  lock = await import("../src/lib/workerLock.js");
});
afterEach(() => vi.useRealTimers());

// one check, then let its promises settle
const tick = async (ms = 10000) => { await vi.advanceTimersByTimeAsync(ms); };

describe("taking the lock", () => {
  test("a free lock is taken and the work starts once", async () => {
    const acquired = vi.fn(async () => {});
    lock.keepWorkerLock({ onAcquired: acquired, onLost: vi.fn() });
    await tick(0);
    await tick();
    assert.equal(lock.holdsWorkerLock(), true);
    assert.equal(acquired.mock.calls.length, 1);
  });

  test("a start that fails stops the process, rather than hold the lock doing nothing", async () => {
    lock.keepWorkerLock({ onAcquired: async () => { throw new Error("Invalid timezone"); }, onLost: vi.fn() });
    await tick(0);
    assert.equal(died.length, 1);
    assert.match(died[0], /failed to start.*Invalid timezone/);
  });

  test("an unreachable database is said as such, not as 'another process has it'", async () => {
    db.reachable = false;
    assert.equal(await lock.tryWorkerLock(), false);
    assert.equal(lock.workerLockMiss(), "unreachable");
    db.reachable = true;
    db.holder = 7;
    assert.equal(await lock.tryWorkerLock(), false);
    assert.equal(lock.workerLockMiss(), "busy");
  });
});

describe("keeping it", () => {
  test("lost to another process : onLost, so two never work at once", async () => {
    const lost = vi.fn();
    lock.keepWorkerLock({ onAcquired: async () => {}, onLost: lost });
    await tick(0);
    db.holder = 7; // a failover : the lock went with the old backend, another took it
    await tick();
    assert.equal(lost.mock.calls.length, 1);
    assert.equal(lock.holdsWorkerLock(), false);
  });

  test("the database gone for a while : no onLost, and the lock is taken again when it is back", async () => {
    const lost = vi.fn();
    lock.keepWorkerLock({ onAcquired: async () => {}, onLost: lost });
    await tick(0);
    db.reachable = false;
    db.holder = null; // the database restarted : every lock gone
    await tick();
    await tick();
    assert.equal(lost.mock.calls.length, 0, "unreachable is not 'another has it'");
    db.reachable = true;
    await tick();
    assert.equal(lock.holdsWorkerLock(), true);
  });
});

describe("a dead holder", () => {
  test("a holder that stays while no worker heartbeats is ended after NODE_DEAD_SECONDS, then the lock is taken", async () => {
    const { NODE_DEAD_SECONDS } = await import("../src/lib/role.js");
    db.holder = 7;
    db.workerAlive = false;
    const acquired = vi.fn(async () => {});
    lock.keepWorkerLock({ onAcquired: acquired, onWaiting: vi.fn(), onLost: vi.fn() });
    await tick(0);
    await tick((NODE_DEAD_SECONDS - 20) * 1000);
    assert.deepEqual(db.killed, [], "not before the threshold");
    await tick(40 * 1000);
    assert.deepEqual(db.killed, [7]);
    await tick();
    assert.equal(lock.holdsWorkerLock(), true, "the waiting worker took over");
    assert.equal(acquired.mock.calls.length, 1);
  });

  test("a holder whose worker heartbeats is never ended", async () => {
    const { NODE_DEAD_SECONDS } = await import("../src/lib/role.js");
    db.holder = 7;
    db.workerAlive = true;
    lock.keepWorkerLock({ onAcquired: vi.fn(), onWaiting: vi.fn(), onLost: vi.fn() });
    await tick(0);
    await tick((NODE_DEAD_SECONDS + 60) * 1000);
    assert.deepEqual(db.killed, []);
    assert.equal(lock.holdsWorkerLock(), false);
  });
});

describe("a clean stop", () => {
  test("releases the lock at once", async () => {
    assert.equal(await lock.tryWorkerLock(), true);
    await lock.releaseWorkerLock();
    assert.equal(db.holder, null);
    assert.equal(lock.holdsWorkerLock(), false);
  });
});
