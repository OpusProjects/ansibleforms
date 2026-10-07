// A stop (server/src/lib/shutdown.js) : every role's closers run, last-registered first, a
// failing one does not keep the others from running, and a second signal does not start over.
import { test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";

test("closers run in reverse order, through a failure, once", async () => {
  const { onShutdown, installShutdown } = await import("../src/lib/shutdown.js");
  const ran = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
  onShutdown("database", async () => { ran.push("database"); });
  onShutdown("worker lock", async () => { ran.push("worker lock"); throw new Error("already gone"); });
  onShutdown("web server", async () => { ran.push("web server"); });
  installShutdown();
  process.emit("SIGTERM");
  process.emit("SIGTERM");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ran, ["web server", "worker lock", "database"], "the server first, the database pool it uses last");
  assert.equal(exit.mock.calls.length, 1);
  assert.deepEqual(exit.mock.calls[0], [0]);
  exit.mockRestore();
});
