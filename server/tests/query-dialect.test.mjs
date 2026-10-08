// Substitution happens inside Query.findAll, not in the controller, because this is the
// only layer that knows which ENGINE each datasource is - and the correct escaping differs
// between them. A config can also name several datasources at once, which is why the
// template is substituted once per datasource rather than once for the request.
//
// Escaping every value with mysql's rules corrupted `DOMAIN\user` and `C:\path` on
// postgres, mssql and oracle, where a backslash is a literal, and broke the json document
// mongodb parses.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// which db_type each named datasource resolves to
let credTypes = {};
vi.mock("../src/models/credential.model.v2.js", () => ({
  default: { resolveCredential: async (name) => ({ db_type: credTypes[name] }) },
}));

// every driver records the sql it was handed
const seen = [];
const driver = (engine) => ({ default: { query: async (name, sql) => { seen.push({ engine, name, sql }); return []; } } });
vi.mock("../src/lib/mysql.js", () => driver("mysql"));
vi.mock("../src/lib/mssql.js", () => driver("mssql"));
vi.mock("../src/lib/postgres.js", () => driver("postgres"));
vi.mock("../src/lib/oracle.js", () => driver("oracle"));
vi.mock("../src/lib/mongodb.js", () => driver("mongodb"));

const Query = (await import("../src/models/query.model.js")).default;

beforeEach(() => { seen.length = 0; credTypes = {}; });

describe("the template is substituted with the engine's own rules", () => {
  test("mysql doubles a backslash, because there it is an escape character", async () => {
    credTypes.cmdb = "mysql";
    await Query.findAll("SELECT * FROM t WHERE u = '$(u)'", "", "cmdb", true, { u: "DOMAIN\\user" });
    assert.equal(seen[0].engine, "mysql");
    assert.equal(seen[0].sql, "SELECT * FROM t WHERE u = 'DOMAIN\\\\user'");
  });

  test("postgres, mssql and oracle keep it, because there it is a literal", async () => {
    for (const engine of ["postgres", "mssql", "oracle"]) {
      seen.length = 0;
      credTypes.ds = engine;
      await Query.findAll("SELECT * FROM t WHERE u = '$(u)'", "", "ds", true, { u: "DOMAIN\\user" });
      assert.equal(seen[0].engine, engine);
      assert.equal(seen[0].sql, "SELECT * FROM t WHERE u = 'DOMAIN\\user'", engine);
    }
  });

  test("mongodb gets json escaping, so a double quote cannot break the document", async () => {
    credTypes.mongo = "mongodb";
    await Query.findAll('db~coll~{"n":"$(n)"}', "", "mongo", true, { n: 'say "hi"' });
    assert.equal(seen[0].sql, 'db~coll~{"n":"say \\"hi\\""}');
    // and it still parses, which is the whole point
    assert.deepEqual(JSON.parse(seen[0].sql.split("~")[2]), { n: 'say "hi"' });
  });

  test("one config naming two engines is substituted correctly for each", async () => {
    credTypes.a = "mysql";
    credTypes.b = "postgres";
    await Query.findAll("SELECT '$(p)'", "", ["a", "b"], true, { p: "C:\\tmp" });
    assert.equal(seen.length, 2);
    assert.equal(seen.find(s => s.name === "a").sql, "SELECT 'C:\\\\tmp'");
    assert.equal(seen.find(s => s.name === "b").sql, "SELECT 'C:\\tmp'");
  });

  test("the injection stays neutralised on every engine", async () => {
    for (const engine of ["mysql", "postgres", "mssql", "oracle"]) {
      seen.length = 0;
      credTypes.ds = engine;
      await Query.findAll("SELECT * FROM t WHERE e = '$(e)'", "", "ds", true, { e: "prod' OR 1=1 -- " });
      assert.equal(seen[0].sql, "SELECT * FROM t WHERE e = 'prod'' OR 1=1 -- '", engine);
    }
  });

  test("without values the query is run exactly as given", async () => {
    // every other caller of findAll passes no values and must be untouched
    credTypes.cmdb = "mysql";
    await Query.findAll("SELECT '$(notaplaceholder)'", "", "cmdb", true);
    assert.equal(seen[0].sql, "SELECT '$(notaplaceholder)'");
  });
});
