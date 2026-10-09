// The uri of an awx runner may carry its API path : https://aap.example.com/api/controller/v2
// for AAP 2.5+, https://awx.example.com/api/v2 for AWX. A uri without an /api/ path - a runner
// made before, or a seed that declares one - still gets AWX_API_PREFIX, as it always did. These
// pin which of the two apiPrefix answers.
import { test, describe } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

const { apiPrefix } = await import("../src/runners/awx/api.js");

describe("apiPrefix", () => {
  test("a uri with its API path gets nothing more", () => {
    assert.equal(apiPrefix({ uri: "https://aap.example.com/api/controller/v2" }), "");
    assert.equal(apiPrefix({ uri: "https://awx.example.com/api/v2" }), "");
    assert.equal(apiPrefix({ uri: "https://ci.example.com/tower/api/v2" }), "");
  });

  test("a uri without one (made before, a seed) gets AWX_API_PREFIX", () => {
    assert.equal(apiPrefix({ uri: "https://awx.example.com" }), "/api/v2");
    assert.equal(apiPrefix({ uri: "https://awx.example.com/tower" }), "/api/v2");
  });

  test("a word containing api is not an API path", () => {
    assert.equal(apiPrefix({ uri: "https://rapid.example.com/apiary" }), "/api/v2");
  });

  test("no runner, or a uri that is not a url, gets AWX_API_PREFIX", () => {
    assert.equal(apiPrefix(undefined), "/api/v2");
    assert.equal(apiPrefix({ uri: "not a url" }), "/api/v2");
  });
});

// AWX's links (a template's related.launch, a job's url) are root-relative and carry the API
// path themselves : added to a uri that has its own, it would be doubled
const { serverOf } = await import("../src/runners/awx/api.js");

describe("serverOf", () => {
  test("a uri with its API path : the server only, what AWX's links are added to", () => {
    assert.equal(serverOf({ uri: "https://aap.example.com/api/controller/v2" }), "https://aap.example.com");
    assert.equal(serverOf({ uri: "https://ci.example.com/tower/api/v2" }), "https://ci.example.com");
    assert.equal(serverOf({ uri: "https://awx.example.com:8043/api/v2" }), "https://awx.example.com:8043");
  });

  test("a uri without one : as it is, as before", () => {
    assert.equal(serverOf({ uri: "https://awx.example.com" }), "https://awx.example.com");
    assert.equal(serverOf({ uri: "https://awx.example.com/tower" }), "https://awx.example.com/tower");
  });

  test("no runner, or a uri that is not a url, is left as it is", () => {
    assert.equal(serverOf(undefined), "");
    assert.equal(serverOf({ uri: "not a url" }), "not a url");
  });
});
