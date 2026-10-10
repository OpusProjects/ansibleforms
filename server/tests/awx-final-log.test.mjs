// The final stdout of an AWX job replaces the chunks stored while it ran : issue #735.
//
// AWX has no incremental stdout, so the tracker reads the whole stdout on every poll and
// keeps what was added, cutting at the length of the previous snapshot. But AWX assembles a
// running job's stdout from its events, which land slightly out of order : a line can show
// up in the middle of the text a few polls after the lines around it. The cut then falls in
// the wrong place, and a job that printed fast ended with lines missing or stored twice.
//
// Once the job has ended its stdout is final, so the tracker now stores it once in place of
// the chunks. Tested against a small test AWX whose snapshots insert a line late, with the
// real Awx.trackJob loop.
import { test, beforeAll, afterAll, beforeEach } from "vitest";
import assert from "node:assert/strict";
import http from "http";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

const { default: Job } = await import("../src/models/job.model.js");
const { Awx } = await import("../src/runners/awx/api.js");
const { default: mysql } = await import("../src/models/db.model.js");

// --------------------------------------------------------------------------------------
// the test database : the job's output rows, with their id, order and stream
// --------------------------------------------------------------------------------------
var jobRow = {};
var rows = [];
var nextId = 1;
mysql.do = async function (sql, params) {
  if (sql.includes("INSERT INTO AnsibleForms.`job_output`")) {
    const row = { id: nextId++, ...params[0] };
    rows.push(row);
    return { insertId: row.id };
  }
  if (sql.includes("DELETE FROM AnsibleForms.`job_output` WHERE job_id=? ORDER BY `order` DESC LIMIT 1")) {
    const last = [...rows].sort((a, b) => b.order - a.order || b.id - a.id)[0];
    rows = rows.filter((r) => r !== last);
    return { affectedRows: 1 };
  }
  if (sql.includes("DELETE FROM AnsibleForms.`job_output` WHERE job_id=? AND output_type='stdout'")) {
    const [, fromOrder, keepId] = params;
    rows = rows.filter((r) => !(r.output_type == "stdout" && r.order >= fromOrder && r.id != keepId));
    return { affectedRows: 1 };
  }
  if (sql.includes("UPDATE AnsibleForms.`jobs` set ?")) {
    Object.assign(jobRow, params[0]);
    return { changedRows: 1 };
  }
  // Job.transitionStatus : only from the statuses it names
  if (sql.includes("UPDATE AnsibleForms.`jobs` SET ? WHERE id=? AND status IN (?)")) {
    if (!params[2].includes(jobRow.status ?? "running")) return { affectedRows: 0 };
    Object.assign(jobRow, params[0]);
    return { affectedRows: 1, changedRows: 1 };
  }
  if (sql.includes("SELECT abort_requested")) return [{ abort_requested: 0 }];
  if (sql.includes("SELECT id FROM AnsibleForms.`jobs`")) return [{ id: params[0] }];
  return [];
};
Job.sendStatusNotification = async () => {};

// --------------------------------------------------------------------------------------
// the test awx : job 88 has ten lines ; line i shows up on poll `arrival[i]`, so a late
// line is inserted in the middle of a later snapshot, as AWX's events do
// --------------------------------------------------------------------------------------
var awx = {};
const LINES = 10;
const PLACEHOLDER = "Standard Output too large to display (1239712 bytes), only download supported for sizes over 1048576 bytes.";

function snapshot(poll) {
  const lines = [];
  for (let i = 1; i <= LINES; i++) if ((awx.arrival[i] ?? i) <= poll) lines.push(`line ${i}`);
  return lines.join("\n");
}
const finalLog = () => snapshot(Infinity);

function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname == "/api/v2/jobs/88/") {
    awx.poll++;
    const finished = awx.poll >= awx.polls;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: 88,
        type: "job",
        name: "fast template",
        url: "/api/v2/jobs/88/",
        status: finished ? "successful" : "running",
        finished: finished ? "2026-01-01T10:00:00Z" : null,
        artifacts: {},
        related: { stdout: "/api/v2/jobs/88/stdout/" },
      }),
    );
    return;
  }
  if (url.pathname == "/api/v2/jobs/88/stdout/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    const last = awx.poll >= awx.polls;
    res.end(last && awx.finalIsPlaceholder ? PLACEHOLDER : snapshot(awx.poll));
    return;
  }
  res.writeHead(404);
  res.end();
}

var server;
var runner;
beforeAll(async () => {
  server = http.createServer(handleRequest);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  runner = { uri: `http://127.0.0.1:${server.address().port}`, token: "test-token", ignore_certs: true };
});
afterAll(() => server.close());
beforeEach(() => {
  jobRow = {};
  rows = [];
  nextId = 1;
  // lines 3 and 7 show up three polls after the lines that follow them
  awx = { poll: 0, polls: 12, arrival: { 3: 6, 7: 10 }, finalIsPlaceholder: false };
});

const job = () => ({ id: 88, url: "/api/v2/jobs/88/", related: { stdout: "/api/v2/jobs/88/stdout/" } });
// the stored stdout, in order, without the final status line
const storedLog = () =>
  rows
    .filter((r) => r.output_type == "stdout" && !r.output.startsWith("ok: [Successfully completed"))
    .sort((a, b) => a.order - b.order)
    .map((r) => r.output)
    .join("\n");

// --------------------------------------------------------------------------------------
// the tests
// --------------------------------------------------------------------------------------
test("the test AWX does insert lines late, so the snapshots are not append-only", () => {
  awx.poll = 0;
  assert.ok(!snapshot(6).startsWith(snapshot(5)), "a late line changes the middle of the text");
});

test("after the job, the stored log is exactly AWX's final stdout : every line once, in order", { timeout: 30000 }, async () => {
  await Awx.trackJob(runner, job(), 1, 0);
  assert.equal(storedLog(), finalLog());
  assert.equal(jobRow.status, "success");
  // and the status line still comes after it
  const last = [...rows].sort((a, b) => b.order - a.order)[0];
  assert.match(last.output, /^ok: \[Successfully completed/);
});

test("a final stdout that is AWX's too-large placeholder does not replace the stored log", { timeout: 30000 }, async () => {
  awx.finalIsPlaceholder = true;
  await Awx.trackJob(runner, job(), 1, 0);
  assert.ok(!storedLog().includes("too large"), "the placeholder is not stored as the log");
  assert.ok(storedLog().includes("line 1"), "what was stored is kept");
});
