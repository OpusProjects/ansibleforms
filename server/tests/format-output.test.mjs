// tests for Helpers.formatOutput ; run with `npm test` (node --test)
// covers the classic ansible output coloring (regression) and the
// awx workflow status lines coloring (issue #420)
const { test } = await import("vitest");
import assert from "node:assert/strict";

// minimal env so the config modules load without a real setup
process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

const { default: Helpers } = await import("../src/lib/common.js");

function record(output, output_type = "stdout", timestamp = "2026-01-01 10:00:00") {
  return { output, output_type, timestamp };
}

test("classic ansible output coloring is unchanged", () => {
  const out = Helpers.formatOutput(
    [
      record("PLAY [all] " + "*".repeat(64)),
      record("TASK [copy] " + "*".repeat(60) + "\nok: [host1]\nchanged: [host2]\nskipping: [host3]"),
      record("[WARNING]: something odd"),
      record("[ERROR]: something bad"),
      record("fatal: [host3]: FAILED! => {\"msg\": \"boom\"}", "stderr"),
      record("localhost : ok=2 changed=1 unreachable=0 failed=1 skipped=1"),
    ],
    false
  );
  assert.match(out, /has-text-weight-bold'>PLAY \[all\]/);
  assert.match(out, /has-text-success'>ok: \[host1\]/);
  assert.match(out, /has-text-warning'>changed: \[host2\]/);
  assert.match(out, /has-text-info'>skipping: \[host3\]/);
  assert.match(out, /has-text-purple'>\[WARNING\]: something odd/);
  assert.match(out, /has-text-danger'>\[ERROR\]: something bad/);
  assert.match(out, /has-text-danger'>fatal: \[host3\]/);
  assert.match(out, /tag is-success'>ok=2/);
  assert.match(out, /tag is-danger'>failed=1/);
  // the host red : it failed
  assert.match(out, /has-text-danger'>localhost<\/span> :/);
});

test("workflow node status lines are colored by status", () => {
  const out = Helpers.formatOutput(
    [
      record("WORKFLOW NODE [node one] (successful) " + "*".repeat(40)),
      record("WORKFLOW NODE [node two] (failed)"),
      record("WORKFLOW NODE [node three] (error)"),
      record("WORKFLOW NODE [node four] (canceled)"),
      record("WORKFLOW NODE [node five] (skipped)"),
      record("WORKFLOW NODE [node six] (pending)"),
      record("WORKFLOW NODE [node seven] (running)"),
      record("WORKFLOW [my workflow] (failed) " + "*".repeat(40)),
    ],
    false
  );
  assert.match(out, /has-text-weight-bold has-text-success'>WORKFLOW NODE \[node one\] \(successful\)/);
  assert.match(out, /has-text-weight-bold has-text-danger'>WORKFLOW NODE \[node two\] \(failed\)/);
  assert.match(out, /has-text-weight-bold has-text-danger'>WORKFLOW NODE \[node three\] \(error\)/);
  assert.match(out, /has-text-weight-bold has-text-warning'>WORKFLOW NODE \[node four\] \(canceled\)/);
  assert.match(out, /has-text-weight-bold has-text-info'>WORKFLOW NODE \[node five\] \(skipped\)/);
  assert.match(out, /has-text-weight-bold has-text-info'>WORKFLOW NODE \[node six\] \(pending\)/);
  // running has no status color, just bold
  assert.match(out, /has-text-weight-bold'>WORKFLOW NODE \[node seven\] \(running\)/);
  // the workflow summary line itself
  assert.match(out, /has-text-weight-bold has-text-danger'>WORKFLOW \[my workflow\] \(failed\)/);
});

test("workflow banner does not bleed its color into the next lines", () => {
  const out = Helpers.formatOutput(
    [record("WORKFLOW NODE [node one] (failed) " + "*".repeat(40) + "\nplain output line")],
    false
  );
  // the plain line after the banner must not be red
  assert.match(out, /<span class=''>plain output line<\/span>/);
});

test("workflow lines stay plain in text mode (download)", () => {
  const out = Helpers.formatOutput(
    [record("WORKFLOW NODE [node one] (successful) ****")],
    true
  );
  assert.equal(out.includes("<span"), false);
  assert.match(out, /WORKFLOW NODE \[node one\] \(successful\)/);
});
