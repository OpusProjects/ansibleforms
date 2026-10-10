// AWX stdout over STDOUT_MAX_BYTES_DISPLAY (1 MB by default) : issue #733.
//
// Above that limit AWX answers the display formats (?format=txt) with HTTP 200 and a
// placeholder - "Standard Output too large to display (N bytes), only download supported..."
// - instead of the log. The tracker took it for the log : it did not contain the previous
// output, so the increment-issue path deleted the last stored chunk and wrote what was left
// of the placeholder (nothing), and every later poll got the same placeholder. The log was
// lost from that point on, with no hint why.
//
// The tracker now reads the stdout as a download (?format=txt_download), which has no size
// limit and returns the same text. The placeholder is still recognized : should an AWX send
// it, it is shown once as an error line and never diffed, so nothing stored is deleted.
// Tested against a small test AWX, with the real Awx.trackJob loop.
import { test, beforeAll, afterAll, beforeEach } from "vitest";
import assert from "node:assert/strict";
import http from "http";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

const { default: Job } = await import("../src/models/job.model.js");
const { Awx, isStdoutTooLarge } = await import("../src/runners/awx/api.js");
const { default: mysql } = await import("../src/models/db.model.js");

// --------------------------------------------------------------------------------------
// the test database : the job's output rows and its status
// --------------------------------------------------------------------------------------
var jobRow = {};
var outputs = [];
mysql.do = async function (sql, params) {
  if (sql.includes("INSERT INTO AnsibleForms.`job_output`")) {
    outputs.push({ ...params[0] });
    return { insertId: outputs.length };
  }
  if (sql.includes("DELETE FROM AnsibleForms.`job_output`")) {
    outputs.pop();
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
// the test awx : job 77 prints one more line per poll, and from poll `largeFrom` on its
// log is "over the display limit" - txt answers the placeholder, txt_download the log
// --------------------------------------------------------------------------------------
var awx = {};
const PLACEHOLDER = (n) =>
  `Standard Output too large to display (${n} bytes), only download supported for sizes over 1048576 bytes.`;

function log(poll) {
  const lines = [];
  for (let i = 1; i <= poll; i++) lines.push(`line ${i}`);
  return lines.join("\n");
}

function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname == "/api/v2/jobs/77/") {
    awx.poll++;
    const finished = awx.poll >= awx.polls;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: 77,
        type: "job",
        name: "large template",
        url: "/api/v2/jobs/77/",
        status: finished ? "successful" : "running",
        finished: finished ? "2026-01-01T10:00:00Z" : null,
        artifacts: {},
        related: { stdout: "/api/v2/jobs/77/stdout/" },
      }),
    );
    return;
  }
  if (url.pathname == "/api/v2/jobs/77/stdout/") {
    const format = url.searchParams.get("format");
    awx.requests.push(format);
    const tooLarge = awx.largeFrom && awx.poll >= awx.largeFrom;
    res.writeHead(200, { "Content-Type": "text/plain" });
    const placeholder = format == "txt" ? tooLarge : tooLarge && awx.downloadSendsPlaceholder;
    res.end(placeholder ? PLACEHOLDER(1239712) : log(awx.poll));
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
  outputs = [];
  awx = { poll: 0, polls: 5, largeFrom: 0, downloadSendsPlaceholder: false, requests: [] };
});

const job = () => ({ id: 77, url: "/api/v2/jobs/77/", related: { stdout: "/api/v2/jobs/77/stdout/" } });
// the stored log, as one text
const storedLog = () =>
  outputs
    .filter((o) => o.output_type == "stdout")
    .map((o) => o.output)
    .join("\n");

// --------------------------------------------------------------------------------------
// the tests
// --------------------------------------------------------------------------------------
test("recognizes AWX's placeholder, and only it", () => {
  assert.equal(isStdoutTooLarge(PLACEHOLDER(1239712)), true);
  assert.equal(isStdoutTooLarge("PLAY [x] ***\nStandard Output too large to display (1 bytes)"), false);
  assert.equal(isStdoutTooLarge("line 1"), false);
  assert.equal(isStdoutTooLarge(undefined), false);
});

test("the stdout is read as a download, never in the display format", { timeout: 30000 }, async () => {
  await Awx.trackJob(runner, job(), 1, 0);
  assert.ok(awx.requests.length >= awx.polls, `requests : ${awx.requests}`);
  assert.ok(awx.requests.every((f) => f == "txt_download"), `requests : ${awx.requests}`);
  assert.equal(jobRow.status, "success");
});

test("a log over the display limit from the start is kept whole", { timeout: 30000 }, async () => {
  awx.largeFrom = 1;
  await Awx.trackJob(runner, job(), 1, 0);
  for (let i = 1; i <= awx.polls; i++) {
    assert.equal((storedLog().match(new RegExp(`line ${i}\\b`, "g")) || []).length, 1, `line ${i}`);
  }
  assert.ok(!storedLog().includes("too large"), "no placeholder in the output");
  assert.equal(jobRow.status, "success");
});

test("a log that crosses the display limit while it runs keeps every line, once", { timeout: 30000 }, async () => {
  awx.polls = 8;
  awx.largeFrom = 4;
  await Awx.trackJob(runner, job(), 1, 0);
  for (let i = 1; i <= awx.polls; i++) {
    assert.equal((storedLog().match(new RegExp(`line ${i}\\b`, "g")) || []).length, 1, `line ${i}`);
  }
  assert.equal(jobRow.status, "success");
});

test("should AWX send the placeholder anyway, nothing stored is lost and it says why, once", { timeout: 30000 }, async () => {
  awx.polls = 8;
  awx.largeFrom = 4;
  awx.downloadSendsPlaceholder = true;
  await Awx.trackJob(runner, job(), 1, 0);
  // the lines from before the limit are all still there : the placeholder deleted nothing
  for (let i = 1; i <= 3; i++) {
    assert.equal((storedLog().match(new RegExp(`line ${i}\\b`, "g")) || []).length, 1, `line ${i}`);
  }
  const told = outputs.filter((o) => o.output_type == "stderr" && isStdoutTooLarge(o.output));
  assert.equal(told.length, 1, "the placeholder is shown once, as an error line");
  assert.ok(!storedLog().includes("too large"), "and never as log");
  assert.equal(jobRow.status, "success", "the job still ends with AWX's status");
});
