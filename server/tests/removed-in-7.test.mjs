// A form still using what 7.0.0 removed gets one clear line per item, not the page of
// "must match exactly one schema" the schema produces for an unknown field type.
import { describe, test, expect, vi } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

const { removedIn7 } = await import("../src/models/form.model.js");
const Form = (await import("../src/models/form.model.js")).default;

const form = (extra = {}, fields = []) => ({ name: "Upgrade firmware", type: "ansible", playbook: "p.yml", roles: ["public"], categories: [], fields, ...extra });

describe("what 7.0.0 removed is named, one line each", () => {
  test("a table field, tableFields, noOutput and disableRelaunch", () => {
    const f = form({ disableRelaunch: true }, [
      { name: "packages", type: "table", tableFields: [{ name: "a", type: "text" }] },
      { name: "secret", type: "text", noOutput: true },
      { name: "ok", type: "text" },
    ]);
    expect(removedIn7(f)).toEqual([
      "Form 'Upgrade firmware' : disableRelaunch was removed in 7.0.0, see https://ansibleforms.com/upgrade-7 - use allowRelaunch: false",
      "Field 'packages' : the table field was removed in 7.0.0, see https://ansibleforms.com/upgrade-7 - use a list field with a subform",
      "Field 'secret' : noOutput was removed in 7.0.0, see https://ansibleforms.com/upgrade-7 - use output: false",
    ]);
  });

  test("validateForm throws just those lines, before the schema", () => {
    const f = form({}, [{ name: "packages", type: "table", tableFields: [] }]);
    expect(() => Form.validateForm(f)).toThrow(/^Field 'packages' : the table field was removed in 7\.0\.0/);
    try { Form.validateForm(f); } catch (e) { expect(e.message).not.toMatch(/must match exactly one schema/); }
  });

  test("a clean form has nothing to report", () => {
    expect(removedIn7(form({}, [{ name: "a", type: "text", output: false }]))).toEqual([]);
    expect(removedIn7(null)).toEqual([]);
  });
});
