// Syslog is documented as off until LOG_SYSLOG_HOST names a host, but the host used to
// default to "localhost" : every install opened a udp socket and sent its whole log to
// port 514 on its own machine. Without the variable there must be no syslog transport.
import { test, expect, vi } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
delete process.env.LOG_SYSLOG_HOST;

// Stand-ins that record what happens to them. Subclassing the real transports would drag in
// real sockets and real files, and this is about lifecycle, not about winston's internals.
const built = { file: [], syslog: [] };
class FakeTransport {
  constructor(opts = {}) { this.level = opts.level; this.closed = false; this.opts = opts; }
  on() { return this; }
  close() { this.closed = true; }
  log(info, cb) { if (cb) cb(); }
}
class FakeDailyRotateFile extends FakeTransport {
  constructor(opts) { super(opts); built.file.push(this); }
}
class FakeSyslog extends FakeTransport {
  constructor(opts) { super(opts); built.syslog.push(this); }
}

const piped = new Set();
vi.mock("winston", () => {
  const printf = () => ({});
  const logger = {
    transports: [],
    level: "info",
    add(t) { piped.add(t); return this; },
    // exactly what the real remove() does: unpipe, and nothing else
    remove(t) { piped.delete(t); return this; },
    warning() {}, error() {}, info() {}, notice() {}, debug() {},
  };
  return {
    default: {
      format: { printf },
      config: { syslog: { levels: { emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7 } } },
      createLogger: (opts) => { (opts.transports || []).forEach((t) => piped.add(t)); return logger; },
      transports: { Console: FakeTransport, DailyRotateFile: FakeDailyRotateFile, Syslog: FakeSyslog },
    },
  };
});
vi.mock("winston-daily-rotate-file", () => ({ default: {} }));
vi.mock("winston-syslog", () => ({ default: {} }));

const { default: logConfig } = await import("../config/log.config.js");
await import("../src/lib/logger.js");

test("without LOG_SYSLOG_HOST there is no syslog host", () => {
  expect(logConfig.sysloghost).toBe("");
});

test("without LOG_SYSLOG_HOST no syslog transport is built", () => {
  expect(built.syslog).toHaveLength(0);
});
