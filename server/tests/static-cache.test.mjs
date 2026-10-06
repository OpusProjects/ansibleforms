// How the built client's files are cached (src/lib/staticCache.js, issue #660).
//
// Every static file used to be served `public, max-age=31536000`, including the ones that keep
// their name from release to release (css/themes.css, build-info.json, img/*). A browser that
// had them kept the old copy for a year after an upgrade and never asked again : 7.2.0 came
// with new header colours in themes.css that such a browser never loaded, and the About dialog
// compared the server build against a year-old build-info.json.
//
// These run a real express.static over a temporary folder, so they also pin the behaviour the
// fix relies on : send() keeps a Cache-Control header that setHeaders already set.
import { test, describe, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { staticCacheHeaders, injectAssetVersion } from "../src/lib/staticCache.js";

describe("cache headers of the built client", () => {
  let dir, server, base;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-static-"));
    for (const f of ["assets/index-BwH3d7XD.js", "css/themes.css", "img/logo_light.svg", "favicon.svg", "build-info.json"]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "x");
    }
    const app = express();
    app.use("/", express.static(dir, { etag: false, setHeaders: staticCacheHeaders(dir) }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cacheControl = async (file) => (await fetch(`${base}/${file}`)).headers.get("cache-control");

  test("the content-hashed bundles under assets/ are cached for good", async () => {
    assert.equal(await cacheControl("assets/index-BwH3d7XD.js"), "public, max-age=31536000, immutable");
  });

  test("files that keep their name across releases are revalidated", async () => {
    for (const file of ["css/themes.css", "img/logo_light.svg", "favicon.svg", "build-info.json"]) {
      assert.equal(await cacheControl(file), "no-cache", file);
    }
  });

  test("a revalidated file still answers 304 when it did not change", async () => {
    const first = await fetch(`${base}/css/themes.css`);
    const lastModified = first.headers.get("last-modified");
    assert.ok(lastModified, "Last-Modified is what validates without an etag");
    // a plain request, as a browser revalidates : fetch() adds cache headers of its own that
    // make the server answer 200 regardless
    const status = await new Promise((resolve, reject) => {
      http
        .get(`${base}/css/themes.css`, { headers: { "If-Modified-Since": lastModified } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject);
    });
    assert.equal(status, 304);
  });

  test("a folder named like assets elsewhere is not taken for the bundles", async () => {
    fs.mkdirSync(path.join(dir, "img/assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "img/assets/x.svg"), "x");
    assert.equal(await cacheControl("img/assets/x.svg"), "no-cache");
  });
});

describe("injectAssetVersion", () => {
  const html = `<head>
  <link rel="icon" href="favicon.svg" />
  <link rel="stylesheet" href="css/themes.css" vite-ignore />
  <script type="module" src="./assets/index-BwH3d7XD.js"></script>
</head>`;

  test("gives the stylesheet and the favicon the version as a new address", () => {
    const out = injectAssetVersion(html, "7.2.1-a1b2c3d");
    assert.match(out, /href="css\/themes\.css\?v=7\.2\.1-a1b2c3d"/);
    assert.match(out, /href="favicon\.svg\?v=7\.2\.1-a1b2c3d"/);
  });

  test("leaves the hashed bundles alone", () => {
    assert.match(injectAssetVersion(html, "7.2.1"), /src="\.\/assets\/index-BwH3d7XD\.js"/);
  });

  test("replaces a version that is already there instead of adding a second one", () => {
    const twice = injectAssetVersion(injectAssetVersion(html, "7.2.0"), "7.2.1");
    assert.match(twice, /href="css\/themes\.css\?v=7\.2\.1"/);
    assert.doesNotMatch(twice, /\?v=7\.2\.0/);
  });

  test("encodes the version, so it cannot break out of the attribute", () => {
    const out = injectAssetVersion(html, '7.2.1"><script>');
    assert.doesNotMatch(out, /<script>"/);
    assert.match(out, /themes\.css\?v=7\.2\.1%22%3E%3Cscript%3E"/);
  });

  test("without a version or html it changes nothing", () => {
    assert.equal(injectAssetVersion(html, ""), html);
    assert.equal(injectAssetVersion("", "7.2.1"), "");
  });
});
