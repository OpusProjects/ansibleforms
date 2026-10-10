// The expression endpoint used to evaluate whatever expression was in the request body, on
// a route carrying nothing but JWT auth - so any authenticated user could call any fn.*
// helper, fn.fnCredentials included, and read every stored credential and secret store
// reference without a form ever offering one.
//
// It is now bound to the form, like the query endpoint: the client sends formName +
// fieldName + the values its placeholders resolved to, and the server takes the EXPRESSION
// TEXT from the definition, loaded with the caller's own roles. A raw expression is still
// accepted from a settings or designer user - they write the forms anyway.
import { test, describe, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let formResult = null;
let formLoadArgs = null;
vi.mock("../src/models/form.model.js", () => ({
  default: {
    load: async (roles, name) => {
      formLoadArgs = { roles, name };
      if (!formResult) throw new Error("no config");
      return formResult;
    },
  },
}));

// what reaches the evaluator - the real one would run fn.*, nothing here should
let ran = null;
vi.mock("../src/models/expression.model.js", () => ({
  default: {
    execute: async (expr, noLog) => { ran = { expr, noLog }; return "ok"; },
  },
}));

const controller = (await import("../src/controllers/v2/expression.controller.js")).default;
const { spliceExpressionValues, replacePlaceholderInString } = await import("../src/lib/formEngine/placeholders.js");

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const call = async (body, user, query = {}) => {
  const res = makeRes();
  await controller.execute({ body, query, user: { user } }, res);
  return res;
};

const plainUser = { username: "bob", type: "local", roles: ["public"], options: {} };
const settingsUser = { username: "root", type: "local", roles: ["admin"], options: { showSettings: true } };
const designerUser = { username: "ann", type: "local", roles: ["designers"], options: { showDesigner: true } };

beforeEach(() => {
  ran = null; formLoadArgs = null;
  formResult = {
    constants: { SITE: "bru", ENVS: ["dev", "prod"] },
    forms: [{
      name: "Servers",
      fields: [
        { name: "vms", type: "enum", expression: "fn.fnRestJwtSecure('get','https://vc/api/vms?dc=$(dc)','',fn.fnCredentials('vcenter'))" },
        { name: "hidden", type: "expression", expression: "fn.upper('$(name)')", noLog: true },
        { name: "local", type: "expression", expression: "'$(name)'", runLocal: true },
        { name: "creds", type: "credential", expression: "'vcenter'" },
        { name: "site", type: "expression", expression: "'$(SITE)-$(name)'" },
        { name: "who", type: "expression", expression: "'$(__user__.username)'" },
        { name: "envs", type: "expression", expression: "$(ENVS).length" },
      ],
      subforms: [{ name: "Disk", fields: [{ name: "size", type: "expression", expression: "$(gb) * 1024" }] }],
    }],
  };
});

describe("a raw expression is refused for an ordinary user", () => {
  test("403, and nothing is evaluated", async () => {
    const res = await call({ expression: "fn.fnCredentials('.*')" }, plainUser);
    assert.equal(res.statusCode, 403, "401 would log the user out; this is a permission answer");
    assert.equal(ran, null, "the expression must never have run");
  });

  test("a settings user may still send a raw expression", async () => {
    const res = await call({ expression: "fn.fnCredentials('x')" }, settingsUser);
    assert.equal(res.statusCode, 200);
    assert.equal(ran.expr, "fn.fnCredentials('x')");
  });

  test("so may a designer, also when previewing a form that is not saved yet", async () => {
    const res = await call({ formName: "Unsaved", fieldName: "f", expression: "1+1" }, designerUser);
    assert.equal(res.statusCode, 200);
    assert.equal(ran.expr, "1+1");
    assert.equal(formLoadArgs, null, "nothing to bind to : the raw text is evaluated as before");
  });
});

describe("a form-bound expression comes from the definition, not the body", () => {
  test("the form's own expression runs - fnCredentials included, as the architect wrote it", async () => {
    const res = await call({
      formName: "Servers", fieldName: "vms",
      values: { dc: "dc1" },
      expression: "fn.fnCredentials('.*') // what the caller tried to run",
    }, plainUser);
    assert.equal(res.statusCode, 200);
    assert.equal(ran.expr, "fn.fnRestJwtSecure('get','https://vc/api/vms?dc=dc1','',fn.fnCredentials('vcenter'))");
  });

  test("the form is loaded with the CALLER's roles", async () => {
    await call({ formName: "Servers", fieldName: "vms", values: { dc: "x" } }, plainUser);
    assert.deepEqual(formLoadArgs.roles, ["public"]);
    assert.equal(formLoadArgs.name, "Servers");
  });

  test("a form the caller cannot see is a 404", async () => {
    formResult = { forms: [] };
    const res = await call({ formName: "Secret", fieldName: "vms", values: {} }, plainUser);
    assert.equal(res.statusCode, 404);
    assert.equal(ran, null);
  });

  test("a field without an expression is refused", async () => {
    const res = await call({ formName: "Servers", fieldName: "nope", values: {} }, plainUser);
    assert.equal(res.statusCode, 404);
    assert.equal(ran, null);
  });

  test("a field the browser evaluates itself is never run on the server", async () => {
    for (const fieldName of ["local", "creds"]) {
      const res = await call({ formName: "Servers", fieldName, values: { name: "a" } }, plainUser);
      assert.equal(res.statusCode, 404, fieldName);
    }
    assert.equal(ran, null);
  });

  test("a subform field is reached through the root form", async () => {
    const res = await call({ formName: "Servers", subformName: "Disk", fieldName: "size", values: { gb: 2 } }, plainUser);
    assert.equal(res.statusCode, 200);
    assert.equal(ran.expr, "2 * 1024");
    assert.equal(formLoadArgs.name, "Servers");
  });

  test("the field's noLog applies", async () => {
    await call({ formName: "Servers", fieldName: "hidden", values: { name: "a" } }, plainUser);
    assert.equal(ran.noLog, true);
  });

  test("constants come from the configuration, __user__ from the token", async () => {
    await call({ formName: "Servers", fieldName: "site", values: { SITE: "evil", name: "web" } }, plainUser);
    assert.equal(ran.expr, "'bru-web'");
    await call({ formName: "Servers", fieldName: "who", values: { "__user__.username": "admin" } }, plainUser);
    assert.equal(ran.expr, '"bob"');
    await call({ formName: "Servers", fieldName: "envs", values: { ENVS: "fn.fnCredentials('.*')" }, literals: [] }, plainUser);
    assert.equal(ran.expr, '["dev","prod"].length');
  });
});

describe("a value cannot become code", () => {
  const attack = "fn.fnCredentials('.*')";

  test("a string value stays a string, wherever the placeholder sits", () => {
    assert.equal(spliceExpressionValues("$(x)", { x: attack }), JSON.stringify(attack));
    assert.equal(spliceExpressionValues("'$(x)'", { x: attack }), JSON.stringify(attack));
    assert.equal(spliceExpressionValues("'a $(x)'", { x: "'); " + attack + "; ('" }), "'a \\'); fn.fnCredentials(\\'.*\\'); (\\''");
    assert.equal(spliceExpressionValues('"a $(x)"', { x: '"+' + attack + '+"' }), '"a \\"+fn.fnCredentials(\'.*\')+\\""');
  });

  test("a template literal cannot be closed or interpolated", () => {
    // a backtick and ${ are written as unicode escapes : inert in the template literal
    assert.equal(spliceExpressionValues("`a ${'b'} $(x)`", { x: "${" + attack + "}" }), "`a ${'b'} \"\\u0024{fn.fnCredentials('.*')}\"`");
    assert.equal(spliceExpressionValues("`$(x)`", { x: "`+" + attack + "+`" }), "`\"\\u0060+fn.fnCredentials('.*')+\\u0060\"`");
  });

  test("a value in a template literal reads back exactly, nothing run", () => {
    // evaluated : the value comes back as the text it was, backslashes included, and the
    // attack is never called (fn is not even defined here)
    const evaluate = (src) => new Function(`return ${src}`)();
    for (const x of ["${" + attack + "}", "`+" + attack + "+`", "a\\`b", "\\${x}", "\\\\`", "plain"]) {
      // in a template literal the spliced JSON literal's escapes are read too : the value back,
      // in its quotes
      assert.equal(evaluate(spliceExpressionValues("`$(x)`", { x })), '"' + x + '"');
      assert.equal(evaluate(spliceExpressionValues("`v:$(x)`", { x })), 'v:"' + x + '"');
      assert.equal(evaluate(spliceExpressionValues("'$(x)'", { x })), x);
      assert.equal(evaluate(spliceExpressionValues('"pre $(x)"', { x })), "pre " + x);
    }
  });

  test("a literal is JSON data re-serialised by the server, never the caller's text", () => {
    assert.equal(spliceExpressionValues("$(rows).length", { rows: [{ a: attack }] }, ["rows"]), `[{"a":"fn.fnCredentials('.*')"}].length`);
    assert.equal(spliceExpressionValues("$(rows).length", { rows: attack }, ["rows"]), `${JSON.stringify(attack)}.length`);
  });

  test("numbers stay numbers, missing values become undefined, null stays null", () => {
    assert.equal(spliceExpressionValues("$(n) + 1", { n: 5 }), "5 + 1");
    assert.equal(spliceExpressionValues("'$(m)'", {}), "undefined");
    assert.equal(spliceExpressionValues("$(m)", { m: "__null__" }), "null");
    assert.equal(spliceExpressionValues("$(m)", { m: null }), "null");
  });

  test("the same splice the browser makes for ordinary values", () => {
    assert.equal(spliceExpressionValues("fn.fnLs('$(dir)')", { dir: "/app" }), 'fn.fnLs("/app")');
    assert.equal(spliceExpressionValues("fn.fnLs('$(dir)/vars')", { dir: "/app" }), "fn.fnLs('/app/vars')");
    assert.equal(spliceExpressionValues("$(list).map(x=>x)", { list: ["a", "b"] }, ["list"]), '["a","b"].map(x=>x)');
  });
});

describe("the server splice gives the expression the browser would have run", () => {
  // replacePlaceholderInString is the mirror of the browser's substitution ; what it records
  // in resolved/literals is what AppForm sends. Splicing that into the definition's text must
  // give the same expression, or a form would evaluate differently once bound.
  const values = {
    dir: "/app", name: "O'Brien", n: 3, flag: true, empty: "",
    host: { name: "web1", ip: "10.0.0.1" },
    rows: [{ id: 1 }, { id: 2 }],
    tags: ["a", "b"],
    nothing: null,
    __user__: { username: "bob", roles: ["public"] },
  };
  const fieldOptions = {
    host: { type: "enum", placeholderColumn: "name" },
    rows: { type: "list" },
    tags: { type: "expression" },
    __user__: { type: "expression" },
  };
  const cases = [
    "fn.fnLs('$(dir)')",
    "fn.fnLs('$(dir)/vars')",
    "'$(name)'.length",
    '"hi $(name)!"',
    "$(n) + 1",
    "$(flag) ? 1 : 0",
    "'$(empty)' || 'x'",
    "'$(host)'",
    "'$(host.ip)'",
    "$(rows).length",
    "$(tags).join(',')",
    "'$(tags)'",
    "$(nothing) === null",
    "'$(__user__.username)'",
    "$(__user__).roles",
    "fn.fnRestBasic('get','https://x/$(dir)?h=$(host.name)','','cred')",
    "'$(missing)'",
  ];
  for (const expr of cases) {
    test(expr, () => {
      const r = replacePlaceholderInString(expr, { values, fieldOptions }, true, "expression");
      expect(spliceExpressionValues(expr, r.resolved, r.literals)).toBe(r.value);
    });
  }
});
