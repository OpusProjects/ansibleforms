// hasApproval is accepted by the schema on a form and on a step, but nothing reads it, so a
// form that sets it gets no approval point from it. Deprecated in 7.0.0 and removed in 8.0.0
// (DEPRECATED.md) : until then a form that uses it still validates, and the log says so.
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));
// the models' logger is aliased to tests/__mocks__/logger.js (vitest.config.js) : listen on it
const logger = (await import("./__mocks__/logger.js")).default;
const warnings = [];
vi.spyOn(logger, "warning").mockImplementation((m) => { warnings.push(String(m)); });

const { deprecatedIn7_3 } = await import("../src/models/form.model.js");
const Form = (await import("../src/models/form.model.js")).default;

const form = (extra = {}) => ({ name: "Approve firmware", type: "ansible", playbook: "p.yml", roles: ["public"], categories: [], fields: [], ...extra });

beforeEach(() => { warnings.length = 0; });

describe("hasApproval is deprecated, not removed", () => {
  test("on a form and on a step, one line each", () => {
    const f = { ...form(), type: "multistep", playbook: undefined, hasApproval: true,
      steps: [{ name: "Patch", type: "ansible", playbook: "p.yml", hasApproval: false }, { name: "Report", type: "ansible", playbook: "r.yml" }] };
    expect(deprecatedIn7_3(f)).toEqual([
      "Form 'Approve firmware' : hasApproval is deprecated since 7 and removed in 8 - it has no effect, an approval point is set with approval",
      "Step 'Patch' of form 'Approve firmware' : hasApproval is deprecated since 7 and removed in 8 - it has no effect, an approval point is set with approval",
    ]);
  });

  test("a form that uses it still validates, and the log says so", () => {
    expect(Form.validateForm(form({ hasApproval: true }))).toBeTruthy();
    expect(warnings).toEqual([
      "Form 'Approve firmware' : hasApproval is deprecated since 7 and removed in 8 - it has no effect, an approval point is set with approval",
    ]);
  });

  test("a clean form has nothing to report", () => {
    expect(deprecatedIn7_3(form())).toEqual([]);
    expect(deprecatedIn7_3(null)).toEqual([]);
    Form.validateForm(form());
    expect(warnings).toEqual([]);
  });
});
