// A credential's type says what it is for (ssh, git, api or database) and keeps the older
// is_database flag in step, so a client or a seed that only knows the flag still works.
import { test, describe } from "vitest";
import assert from "node:assert/strict";

process.env.LOG_PATH = process.env.LOG_PATH || "/tmp/ansibleforms-test-logs";
process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_PORT = process.env.DB_PORT || "3306";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";

const { default: Credential } = await import("../src/models/credential.model.v2.js");

describe("a credential's type and its is_database flag", () => {
  test("the type sets the flag", () => {
    assert.equal(Credential.mirrorType({ credential_type: "database" }).is_database, 1);
    for (const type of ["ssh", "git", "api"]) assert.equal(Credential.mirrorType({ credential_type: type }).is_database, 0);
  });

  test("the flag alone sets the type : database, or ssh on a create", () => {
    assert.equal(Credential.mirrorType({ is_database: 1 }).credential_type, "database");
    assert.equal(Credential.mirrorType({ is_database: 0 }, true).credential_type, "ssh");
    assert.equal(Credential.mirrorType({ is_database: 0 }).credential_type, undefined, "an update leaves the stored type");
  });

  test("a create with neither is a database credential, as the column's default", () => {
    assert.equal(Credential.mirrorType({}, true).credential_type, "database");
  });

  test("an unknown type is refused", () => {
    assert.throws(() => Credential.mirrorType({ credential_type: "kerberos" }), /Unknown credential type 'kerberos'/);
  });
});
