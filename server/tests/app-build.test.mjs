// The server's build and the X-App-Build header (src/lib/appBuild.js, issue #660).
//
// A tab left open across an upgrade runs the old client : every response of the new server
// names its build in X-App-Build, so the client can tell it is stale and offer a reload.
import { test, describe, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { readBuildInfo, appBuildHeader } from "../src/lib/appBuild.js";

describe("readBuildInfo", () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-build-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "7.2.0" }));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a development server : package.json's version and no sha", () => {
    assert.deepEqual(readBuildInfo(dir), { version: "7.2.0", gitSha: "" });
  });

  test("a docker build : build-info.json's version and sha", () => {
    fs.writeFileSync(path.join(dir, "build-info.json"), JSON.stringify({ version: "7.3.0-rc.1", gitSha: "a1b2c3d" }));
    assert.deepEqual(readBuildInfo(dir), { version: "7.3.0-rc.1", gitSha: "a1b2c3d" });
  });

  test("a folder without either : empty, never an exception", () => {
    assert.deepEqual(readBuildInfo(path.join(dir, "missing")), { version: "", gitSha: "" });
  });
});

describe("appBuildHeader", () => {
  const serve = async (sha) => {
    const app = express();
    app.use(appBuildHeader(sha));
    app.get("/api/v2/thing", (req, res) => res.json({ ok: true }));
    app.get("/api/v2/broken", (req, res) => res.status(500).json({ error: "x" }));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };

  test("every response names the build, errors included", async () => {
    const { server, base } = await serve("a1b2c3d");
    try {
      assert.equal((await fetch(`${base}/api/v2/thing`)).headers.get("x-app-build"), "a1b2c3d");
      assert.equal((await fetch(`${base}/api/v2/broken`)).headers.get("x-app-build"), "a1b2c3d");
    } finally {
      server.close();
    }
  });

  test("a development server (no sha) sends no header", async () => {
    const { server, base } = await serve("");
    try {
      assert.equal((await fetch(`${base}/api/v2/thing`)).headers.get("x-app-build"), null);
    } finally {
      server.close();
    }
  });
});
