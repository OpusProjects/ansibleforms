// Tests for the declarative config seed (CONFIG_SEED_PATH).
//
// Three properties are load-bearing here and each one has a failure mode that is
// silent, which is why they are tested rather than eyeballed :
//
//  1. A malformed seed must be REFUSED, not partially applied. It is applied
//     unattended at startup, so a misspelled key that gets dropped instead of
//     reported produces an instance that quietly does not match its own manifest.
//  2. A `managed` record must be read-only in the API, and the flag itself must be
//     unsettable from outside - being able to set it would freeze a hand-made record,
//     being able to clear it would unlock a seeded one.
//  3. The unattended schema bootstrap must NEVER run against a database that holds
//     tables, because create_schema_and_tables.sql drops all 16 of them first.
import { test, describe, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

// the database is a hand-written responder per test : nothing here touches mysql
let dbHandler = async () => [];
const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      queries.push({ sql, vars });
      return dbHandler(sql, vars);
    },
  },
}));

const { validateSeed, interpolateEnv } = await import("../src/lib/seed-schema.js");
const appConfig = (await import("./__mocks__/app.config.js")).default;
appConfig.encryptionSecret ||= "0123456789abcdef0123456789abcdef";
const { buildRecord, listSections, canonicalJson, applyChat, differs } = await import("../src/lib/seed.js");
const seedCrypto = (await import("../src/lib/crypto.js")).default;
const CrudModel = (await import("../src/models/crud.model.js")).default;
const Schema = (await import("../src/models/schema.model.js")).default;

beforeEach(() => {
  queries.length = 0;
  dbHandler = async () => [];
});

describe("the seed schema refuses anything it does not understand", () => {
  const minimal = {
    version: 1,
    awx: { items: [{ name: "tower", uri: "https://tower.example.com" }] },
  };

  test("a well formed seed validates", () => {
    assert.equal(validateSeed(minimal), true);
  });

  test("an empty document is valid : it declares nothing and releases everything", () => {
    assert.equal(validateSeed({}), true);
  });

  // additionalProperties:false everywhere. A typo that is silently dropped is the
  // worst outcome : the operator believes the value is in force.
  test("an unknown field is rejected, not ignored", () => {
    assert.throws(
      () => validateSeed({ awx: { items: [{ name: "t", uri: "u", tokenn: "x" }] } }),
      /validation failed/
    );
  });

  test("an unknown top level section is rejected", () => {
    assert.throws(() => validateSeed({ users: { items: [] } }), /validation failed/);
  });

  test("a missing required field is rejected", () => {
    assert.throws(() => validateSeed({ awx: { items: [{ name: "no-uri" }] } }), /validation failed/);
  });

  // ldap and settings are single-row sections, so `managed` freezes the WHOLE row. Declaring
  // a subset would freeze fields the seed never writes (a seed setting only `url` made the
  // Mail page 403 for ever), so the schema requires all of them.
  const FULL_LDAP = {
    server: "ldap.example.com", port: 389, ignore_certs: false, enable_tls: false,
    cert: "", ca_bundle: "", bind_user_dn: "cn=b", bind_user_pw: "pw",
    search_base: "dc=x", username_attribute: "uid", groups_attribute: "memberOf",
    enable: true, groups_search_base: "", group_class: "", group_member_attribute: "",
    group_member_user_attribute: "", mail_attribute: "",
  };
  const FULL_SETTINGS = {
    mail_server: "smtp.x", mail_port: 587, mail_secure: false, mail_username: "",
    mail_password: "", mail_from: "a@b.c", url: "https://x",
  };

  test("a fully declared ldap section validates", () => {
    assert.equal(validateSeed({ ldap: FULL_LDAP }), true);
  });

  test("ldap requires the fields a bind actually needs", () => {
    assert.throws(() => validateSeed({ ldap: { server: "ldap.example.com" } }), /validation failed/);
  });

  // one omitted field is enough : a partially declared row would be frozen but unwritten
  for (const omit of ["enable", "mail_attribute", "group_class", "cert"]) {
    test(`ldap rejects a section missing '${omit}'`, () => {
      const partial = { ...FULL_LDAP };
      delete partial[omit];
      assert.throws(() => validateSeed({ ldap: partial }), new RegExp(`required property '${omit}'`));
    });
  }

  test("a fully declared settings section validates", () => {
    assert.equal(validateSeed({ settings: FULL_SETTINGS }), true);
  });

  // THE regression for the frozen Mail page : url alone used to be accepted
  test("settings rejects a section declaring only url", () => {
    assert.throws(() => validateSeed({ settings: { url: "https://x" } }), /required property 'mail_server'/);
  });

  test("an unsupported version is rejected", () => {
    assert.throws(() => validateSeed({ version: 2 }), /validation failed/);
  });

  // Numbers that arrive through ${ENV} are strings by then, so both forms must pass
  // or every interpolated port would be a validation error.
  test("a port is accepted as an integer or as a string", () => {
    assert.equal(validateSeed({ credentials: { items: [{ name: "c", port: 3306 }] } }), true);
    assert.equal(validateSeed({ credentials: { items: [{ name: "c", port: "3306" }] } }), true);
  });

  // ajv has no "unique by property", and this is not cosmetic : the second entry wins
  // the upsert while both count as declared, so a prune would spare a record that
  // nobody reading the file knows exists.
  test("duplicate names in a section are rejected", () => {
    assert.throws(
      () => validateSeed({ credentials: { items: [{ name: "dup" }, { name: "dup" }] } }),
      /duplicate credentials names : dup/
    );
  });

  test("every reported error is included, not just the first", () => {
    try {
      validateSeed({ awx: { items: [{ nope: 1 }] } });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /nope/);
      assert.match(e.message, /required/);
    }
  });

  // Two records claiming the same singleton flag never converge : each apply zeroes the
  // others and sets the last, so the flag alternates on every boot and the seed reports
  // an update for ever. ajv cannot express it, same as the duplicate-name rule.
  test("is_default on two awx entries is rejected", () => {
    assert.throws(
      () => validateSeed({ awx: { items: [
        { name: "a", uri: "u", is_default: true },
        { name: "b", uri: "u", is_default: true },
      ] } }),
      /is_default on more than one awx entry : a, b/
    );
  });

  test("one is_default is fine", () => {
    assert.equal(validateSeed({ awx: { items: [
      { name: "a", uri: "u", is_default: true },
      { name: "b", uri: "u" },
    ] } }), true);
  });

  test("two enabled oauth2 providers of the SAME type are rejected", () => {
    assert.throws(
      () => validateSeed({ oauth2: { items: [
        { name: "a", provider: "azuread", client_id: "c", client_secret: "s", enable: true },
        { name: "b", provider: "azuread", client_id: "c", client_secret: "s", enable: true },
      ] } }),
      /enables more than one 'azuread' oauth2 provider : a, b/
    );
  });

  // different provider types are independent, so this must stay allowed
  test("two enabled oauth2 providers of DIFFERENT types are fine", () => {
    assert.equal(validateSeed({ oauth2: { items: [
      { name: "a", provider: "azuread", client_id: "c", client_secret: "s", enable: true },
      { name: "b", provider: "oidc", client_id: "c", client_secret: "s", enable: true },
    ] } }), true);
  });

  // One restart should tell the operator everything that is wrong, not the first thing.
  test("independent errors are reported together, separated by ;", () => {
    try {
      validateSeed({ version: 9, bogus: 1 });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /'bogus'/);       // the unknown section, named
      assert.match(e.message, /\/version/);     // and the bad version, in the same message
      assert.match(e.message, / ; /);
    }
  });
});

describe("secrets come from the environment, never from the file", () => {
  test("a reference is replaced by the environment value", () => {
    const out = interpolateEnv({ token: "${SEED_TOK}" }, { SEED_TOK: "s3cret" });
    assert.equal(out.token, "s3cret");
  });

  test("references are resolved inside nested objects and arrays", () => {
    const out = interpolateEnv(
      { awx: { items: [{ token: "${A}" }, { token: "pre-${B}-post" }] } },
      { A: "1", B: "2" }
    );
    assert.equal(out.awx.items[0].token, "1");
    assert.equal(out.awx.items[1].token, "pre-2-post");
  });

  // The failure this prevents : storing the literal string '${SEED_LDAP_PW}' as the
  // bind password, which authenticates against nothing and looks configured.
  test("an unresolved reference is fatal", () => {
    assert.throws(() => interpolateEnv({ pw: "${NOT_SET}" }, {}), /undefined environment variables : NOT_SET/);
  });

  test("every missing variable is named, sorted, in one error", () => {
    assert.throws(
      () => interpolateEnv({ a: "${ZZ}", b: "${AA}" }, {}),
      /undefined environment variables : AA, ZZ/
    );
  });

  test("an empty environment value is a value, not a missing variable", () => {
    const out = interpolateEnv({ pw: "${EMPTY}" }, { EMPTY: "" });
    assert.equal(out.pw, "");
  });

  test("non-strings pass through untouched", () => {
    const out = interpolateEnv({ port: 389, on: true, none: null }, {});
    assert.deepEqual(out, { port: 389, on: true, none: null });
  });

  test("a bare dollar or an unmatched brace is left alone", () => {
    const out = interpolateEnv({ a: "$HOME", b: "${bad-name}", c: "100$" }, {});
    assert.deepEqual(out, { a: "$HOME", b: "${bad-name}", c: "100$" });
  });
});

describe("a managed record is read only for the API", () => {
  test("a managed row is refused with 403, not 401", async () => {
    // 401 would be wrong here and not merely imprecise : App.vue's axios interceptor
    // treats any 401 as a dead session and signs the user out.
    dbHandler = async () => [{ managed: 1 }];
    await assert.rejects(
      () => CrudModel.assertNotManaged("credential", 7),
      (e) => e.status === 403 && e.name === "AccessDeniedError"
    );
  });

  test("an unmanaged row passes", async () => {
    dbHandler = async () => [{ managed: 0 }];
    await CrudModel.assertNotManaged("credential", 7);
  });

  test("a row that does not exist is not the guard's business", async () => {
    dbHandler = async () => [];
    await CrudModel.assertNotManaged("credential", 999);
  });

  // Models whose table has no such column must not have a `managed` predicate bolted
  // onto their queries - that would be a SQL error on every update.
  test("a model without the column is skipped without querying", async () => {
    await CrudModel.assertNotManaged("users", 1);
    assert.equal(queries.length, 0);
  });

  test("the flag is stripped from an API payload", () => {
    const data = { name: "x", managed: true };
    CrudModel.stripManaged(data, {});
    assert.equal("managed" in data, false);
  });

  // ...including managed:false, which is the direction that would UNLOCK a seeded record
  test("clearing the flag from an API payload is stripped too", () => {
    const data = { name: "x", managed: false };
    CrudModel.stripManaged(data, {});
    assert.equal("managed" in data, false);
  });

  test("the seed itself keeps the flag", () => {
    const data = { name: "x", managed: true };
    CrudModel.stripManaged(data, { fromSeed: true });
    assert.equal(data.managed, true);
  });
});

describe("a seed must not blank a field it says nothing about", () => {
  // Regression. `defaults: { description: "" }` exists because credentials.description
  // is NOT NULL with no database default, so an INSERT without it fails. It was being
  // applied to UPDATEs too, which meant a seed that never mentions `description` wiped
  // an existing one - and because declaring an existing name ADOPTS that record, that
  // silently destroyed the description on somebody's hand-made credential. Verified
  // against the running app: "DO NOT LOSE THIS TEXT" was blanked before, survives now.
  const section = { defaults: { description: "" } };

  test("defaults fill a required column on create", () => {
    const r = buildRecord(section, { name: "c", user: "u" }, true);
    assert.equal(r.description, "");
    assert.equal(r.managed, true);
  });

  test("defaults are NOT applied on update", () => {
    const r = buildRecord(section, { name: "c", user: "u" }, false);
    assert.equal("description" in r, false);
  });

  test("a declared value still wins over the default on create", () => {
    const r = buildRecord(section, { name: "c", description: "mine" }, true);
    assert.equal(r.description, "mine");
  });

  test("a section with no defaults is unaffected either way", () => {
    assert.deepEqual(buildRecord({}, { name: "a" }, true), { name: "a", managed: true });
    assert.deepEqual(buildRecord({}, { name: "a" }, false), { name: "a", managed: true });
  });

  // the real credential and repository sections are the ones that carry defaults, and
  // both are keyed on a column that is NOT NULL without a default
  test("the real sections that carry defaults only carry `description`", () => {
    for (const s of listSections.filter((x) => x.defaults)) {
      assert.deepEqual(Object.keys(s.defaults), ["description"], `${s.key} defaults`);
    }
  });
});

describe("a JSON column is compared canonically, or the row rewrites for ever", () => {
  // MySQL SORTS an object's keys when it stores JSON - verified against the running 8.4
  // container: '{"b":2,"a":1}' comes back as '{"a":1,"b":2}'. JSON.parse preserves the
  // declared order, so a plain stringify comparison differs every boot, rewriting the row
  // and re-running the "only one enabled provider per type" side effect each time.
  test("key order does not make two equal documents differ", () => {
    assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  });

  test("nested key order is normalised too", () => {
    assert.equal(canonicalJson({ x: { d: 1, c: 2 } }), canonicalJson({ x: { c: 2, d: 1 } }));
  });

  // array order IS meaningful and must not be sorted away
  test("array order is preserved", () => {
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  test("a genuine difference is still a difference", () => {
    assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
    assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 1, b: 1 }));
  });

  test("null and scalars round-trip", () => {
    assert.equal(canonicalJson(null), "null");
    assert.equal(canonicalJson("x"), '"x"');
  });
});

describe("secret stores are seedable", () => {
  const store = { name: "vault", type: "vault", url: "https://vault:8200", token: "${VAULT_TOKEN}", kv_version: 2, cache_ttl_seconds: "60", extra: { a: 1 } };

  test("a secret store and a credential reading from it validate", () => {
    assert.doesNotThrow(() => validateSeed({
      secret_stores: { items: [store] },
      credentials: { items: [{ name: "db", secret_store: "vault", secret_ref: "secret/db" }] },
    }));
  });

  test("a store without its type is rejected", () => {
    assert.throws(() => validateSeed({ secret_stores: { items: [{ name: "v", url: "u" }] } }), /validation failed/);
  });

  test("an unknown store field is rejected", () => {
    assert.throws(() => validateSeed({ secret_stores: { items: [{ ...store, tokn: "x" }] } }), /validation failed/);
  });

  test("stores are applied before the credentials that name them", () => {
    const keys = listSections.map((s) => s.key);
    assert.ok(keys.indexOf("secret_stores") < keys.indexOf("credentials"));
  });

  // extra is a TEXT column holding JSON : an object declared for it must compare by
  // content, or the row rewrites on every boot
  test("an object declared for a JSON text column compares by content", () => {
    assert.equal(differs({ extra: { b: 2, a: 1 } }, { extra: '{"a":1,"b":2}' }), false);
    assert.equal(differs({ extra: { a: 1 } }, { extra: '{"a":2}' }), true);
    assert.equal(differs({ extra: { a: 1 } }, { extra: null }), true);
  });
});

describe("the unattended schema bootstrap cannot wipe a live database", () => {
  test("an absent schema is empty", async () => {
    dbHandler = async (sql) => (/SHOW DATABASES/.test(sql) ? [] : []);
    assert.equal(await Schema.isEmpty(), true);
  });

  test("a schema with no tables is empty", async () => {
    dbHandler = async (sql) => (/SHOW DATABASES/.test(sql) ? [{ x: 1 }] : []);
    assert.equal(await Schema.isEmpty(), true);
  });

  // THE regression test for this feature. create_schema_and_tables.sql DROPs all 16
  // tables, so a false 'empty' here destroys the instance. A database whose users
  // table is empty - which is what isProvisioned() calls un-provisioned - must still
  // read as NOT empty, because it can be full of forms, jobs and audit history.
  test("a schema that holds tables is NOT empty, even with no users", async () => {
    dbHandler = async (sql) => {
      if (/SHOW DATABASES/.test(sql)) return [{ x: 1 }];
      if (/SHOW TABLES/.test(sql)) return [{ Tables_in_AnsibleForms: "jobs" }];
      return [{ total: 0 }];
    };
    assert.equal(await Schema.isEmpty(), false);
  });

  test("isEmpty asks about tables, never about rows", async () => {
    dbHandler = async (sql) => (/SHOW DATABASES/.test(sql) ? [{ x: 1 }] : [{ Tables_in_AnsibleForms: "jobs" }]);
    await Schema.isEmpty();
    assert.equal(queries.some((q) => /COUNT\(\*\)/i.test(q.sql)), false);
  });
});

describe("the chat assistant's provider is seedable (a single-row section)", () => {
  const FULL_CHAT = {
    provider: "anthropic", api_key: "${CHAT_API_KEY}", base_url: "", model: "claude-opus-5-5",
    max_turns: 20, max_tool_rounds: 6, timeout_seconds: 60, allow_job_status: true,
  };
  const summary = () => ({ created: [], updated: [], unchanged: 0, adopted: [], released: [], deleted: [] });

  test("a fully declared chat section validates, its key from the environment", () => {
    assert.equal(validateSeed({ chat: FULL_CHAT }), true);
    assert.equal(interpolateEnv({ chat: FULL_CHAT }, { CHAT_API_KEY: "sk-live" }).chat.api_key, "sk-live");
    assert.throws(() => interpolateEnv({ chat: FULL_CHAT }, {}), /undefined environment variables : CHAT_API_KEY/);
  });

  test("every field is required, and the provider is one we have", () => {
    const { model, ...partial } = FULL_CHAT; // eslint-disable-line no-unused-vars
    assert.throws(() => validateSeed({ chat: partial }), /required property 'model'/);
    assert.throws(() => validateSeed({ chat: { ...FULL_CHAT, provider: "watson" } }), /validation failed/);
  });

  test("applied : adopted, the key encrypted, the row managed", async () => {
    const writes = [];
    dbHandler = async (sql, rec) => {
      if (/^UPDATE/.test(sql)) { writes.push(rec); return { affectedRows: 1 }; }
      return [{ provider: "", api_key: "", model: "", managed: 0 }];
    };
    const s = summary();
    await applyChat({ ...FULL_CHAT, api_key: "sk-live" }, s);
    assert.deepEqual(s.adopted, ["chat"]);
    assert.deepEqual(s.updated, ["chat"]);
    assert.equal(writes[0].managed, 1);
    assert.equal(writes[0].provider, "anthropic");
    assert.notEqual(writes[0].api_key, "sk-live");
    assert.equal(seedCrypto.decrypt(writes[0].api_key), "sk-live");
  });

  test("the proxy settings are optional, and extra headers may be a yaml mapping", async () => {
    assert.equal(validateSeed({ chat: { ...FULL_CHAT, auth_type: "api-key", api_version: "2024-10-21", request_user: "af-chat", ignore_certs: true, extra_headers: { "X-Org": "ops" } } }), true);
    assert.throws(() => validateSeed({ chat: { ...FULL_CHAT, auth_type: "basic" } }), /validation failed/);
    const writes = [];
    dbHandler = async (sql, rec) => {
      if (/^UPDATE/.test(sql)) { writes.push(rec); return { affectedRows: 1 }; }
      return [{ ...FULL_CHAT, api_key: seedCrypto.encrypt("sk-live"), allow_job_status: 1, managed: 1, extra_headers: '{"X-Org":"ops"}', request_user: "af-chat" }];
    };
    const s = summary();
    await applyChat({ ...FULL_CHAT, api_key: "sk-live", request_user: "af-chat", extra_headers: { "X-Org": "ops" } }, s);
    assert.equal(s.unchanged, 1, "a mapping equal to the stored JSON is no change");
    await applyChat({ ...FULL_CHAT, api_key: "sk-live", request_user: "af-chat", extra_headers: { "X-Org": "dev" } }, summary());
    assert.equal(writes[0].extra_headers, '{"X-Org":"dev"}');
  });

  test("an unchanged managed row is not rewritten", async () => {
    const writes = [];
    dbHandler = async (sql, rec) => {
      if (/^UPDATE/.test(sql)) { writes.push(rec); return { affectedRows: 1 }; }
      return [{ ...FULL_CHAT, api_key: seedCrypto.encrypt("sk-live"), allow_job_status: 1, managed: 1 }];
    };
    const s = summary();
    await applyChat({ ...FULL_CHAT, api_key: "sk-live" }, s);
    assert.equal(s.unchanged, 1);
    assert.deepEqual(writes, []);
  });
});
