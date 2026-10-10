// LAUNCH_VALIDATION : a REST launch checked against the form's rules with the same
// engine as the browser and the MCP server (lib/launchValidation.js, Job.launch guardLaunch),
// and in `enforce` launched with the extravars the server builds.
import { describe, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

const { guardLaunch, launchValidationMode, filterRawFormDataOf } = await import("../src/models/job.model.js");
const Form = (await import("../src/models/form.model.js")).default;
const appConfig = (await import("./__mocks__/app.config.js")).default;
const logger = (await import("./__mocks__/logger.js")).default;
const { validateLaunch, verifyUploads, compareExtravars, describeLaunchErrors, describeRowErrors } = await import("../src/lib/launchValidation.js");
const { evalSandbox } = await import("../src/lib/formEngine/node/sandbox.js");

const user = { username: "bob", roles: ["public"], options: {} };
const formObj = {
  name: "Create host",
  fields: [
    { name: "host", type: "text", required: true, regex: { expression: "^prod-", description: "Must start with prod-" }, model: "vm.name" },
    { name: "size", type: "number", default: 10 },
    { name: "pw", type: "password", model: "secrets.pw" },
    { name: "pw2", type: "password", sameAs: "pw", output: false },
    { name: "upload", type: "file", maxSize: 1024, regex: { expression: "\\.txt$", description: "txt only" } },
    { name: "cred", type: "credential", expression: "'cred_' + '$(host)'" },
  ],
};
const formConfig = { constants: {}, forms: [formObj] };
const services = { evalSandbox, serverExpression: vi.fn(), query: vi.fn() };

let uploadDir, outside;
const upload = (name, bytes) => {
  const p = path.join(uploadDir, `abc${bytes}`);
  fs.writeFileSync(p, "x".repeat(bytes));
  return { fieldname: "file", originalname: name, mimetype: "text/plain", encoding: "7bit", path: p, size: 1 };
};
beforeAll(() => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "af-uploads-"));
  outside = path.join(os.tmpdir(), `af-outside-${process.pid}`);
  fs.writeFileSync(outside, "secret");
});
afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
});

// a wizard : two steps under one defaultModel, the second only for a large VM, the third optional
const wizardForm = {
  name: "Wizard VM",
  fields: [],
  wizard: [
    { subform: "basics", defaultModel: "vm" },
    { subform: "disk", defaultModel: "vm", when: "$(__parent__.basics.large) === true" },
    { name: "extra", subform: "extras", optional: true },
  ],
  subforms: [
    { name: "basics", type: "subform", fields: [
      { name: "name", type: "text", required: true, regex: { expression: "^prod-", description: "Must start with prod-" } },
      { name: "large", type: "checkbox", default: true },
      { name: "secret", type: "password" },
      { name: "cred", type: "credential", expression: "'cred_' + '$(name)'", output: false },
    ] },
    { name: "disk", type: "subform", fields: [
      { name: "size", type: "number", required: true, maxValue: 100 },
    ] },
    { name: "extras", type: "subform", fields: [
      { name: "note", type: "text", required: true },
    ] },
  ],
};
const wizardRaw = (drafts, skipped = { extra: true }) => ({ __wizard__: true, drafts, skipped });
const args = (rawFormData, extravars = {}, files = {}) => ({ form: formObj.name, formConfig, formObj, user, rawFormData, extravars, files });

let warned;
beforeEach(() => {
  warned = [];
  logger.warning = (m) => warned.push(m);
  appConfig.launchValidation = "log";
  appConfig.uploadPath = uploadDir;
});
afterEach(() => { delete appConfig.launchValidation; delete appConfig.uploadPath; });

describe("validateLaunch", () => {
  const run = (rawFormData, extravars = {}, files = {}) =>
    validateLaunch({ formConfig, formObj, user, services, rawFormData, extravars, files, uploadPath: uploadDir });

  test("the raw field values are checked, passwords read back from the modelled extravars", async () => {
    const r = await run({ host: "prod-1" }, { secrets: { pw: "a" }, pw2: "b" });
    expect(r.ok).toBe(false);
    expect(r.errors.validationErrors).toEqual({ pw2: [{ type: "sameAs", description: "Must match the field 'pw'" }] });
  });

  test("a valid launch comes with the extravars and credentials the server built", async () => {
    const r = await run({ host: "prod-1", pw2: "a" }, { secrets: { pw: "a" }, __verbose__: true });
    expect(r.ok).toBe(true);
    expect(r.payload.extravars).toEqual({ vm: { name: "prod-1" }, size: 10, secrets: { pw: "a" }, cred: "cred_prod-1", __verbose__: true });
    expect(r.payload.credentials).toEqual({ cred: "cred_prod-1" });
  });

  test("a wizard form without its step drafts is refused", async () => {
    const r = await validateLaunch({ formConfig, formObj: { ...formObj, wizard: [{ subform: "s1" }] }, user, services, rawFormData: { host: "x" }, extravars: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/step drafts/);
  });

  test("the log line names fields and rule types, never values", () => {
    const line = describeLaunchErrors({ missing: ["a"], invalid: ["host", "cluster"], waiting: [],
      validationErrors: { host: [{ type: "regex", description: "contains s3cr3t" }] },
      uploads: [{ field: "upload", reason: "the uploaded file does not exist" }] });
    expect(line).toBe("missing : a ; failing rules : host (regex) ; invalid : cluster ; uploads : upload (the uploaded file does not exist)");
    expect(line).not.toContain("s3cr3t");
  });
});

describe("list row errors", () => {
  test("name the row and the rule, nested rows included, never a value", () => {
    const line = describeRowErrors({
      disks: [{ index: 1, invalid: ["name"], validationErrors: { name: [{ type: "regex", description: "s3cr3t" }] } }],
      vms: [{ index: 0, invalid: ["disks"], rowErrors: { disks: [{ index: 2, missing: ["size"] }] } }],
    });
    expect(line).toEqual(["disks[1].name (regex)", "vms[0].disks[2].size (missing)"]);
    expect(describeLaunchErrors({ invalid: ["disks"], rowErrors: { disks: [{ index: 0, missing: ["x"] }] } }))
      .toBe("failing rows : disks[0].x (missing)");
  });
});

describe("uploads", () => {
  test("a file is checked on the upload : name and the size on disk, not the size claimed", async () => {
    const r = await validateLaunch({ formConfig, formObj, user, services, uploadPath: uploadDir,
      rawFormData: { host: "prod-1", upload: {} }, extravars: {}, files: { upload: upload("a.exe", 2048) } });
    expect(r.ok).toBe(false);
    expect(r.errors.validationErrors.upload.map((e) => e.type)).toEqual(["maxSize", "regex"]);
  });

  test("the extravars hold the verified upload", async () => {
    const u = upload("notes.txt", 100);
    const r = await validateLaunch({ formConfig, formObj, user, services, uploadPath: uploadDir,
      rawFormData: { host: "prod-1" }, extravars: {}, files: { upload: { ...u, size: 1, destination: "/elsewhere" } } });
    expect(r.ok).toBe(true);
    expect(r.payload.extravars.upload).toMatchObject({ originalname: "notes.txt", path: u.path, size: 100, destination: uploadDir });
  });

  test("an upload outside the upload folder, or one that does not exist, is refused", () => {
    const res = verifyUploads(formObj, { upload: { originalname: "x.txt", path: outside } }, uploadDir);
    expect(res.errors).toEqual([{ field: "upload", reason: "the upload is not in the upload folder" }]);
    const traversal = verifyUploads(formObj, { upload: { originalname: "x.txt", path: path.join(uploadDir, "..", path.basename(outside)) } }, uploadDir);
    expect(traversal.errors[0].reason).toBe("the upload is not in the upload folder");
    const gone = verifyUploads(formObj, { upload: { originalname: "x.txt", path: path.join(uploadDir, "nope") } }, uploadDir);
    expect(gone.errors[0].reason).toBe("the uploaded file does not exist");
  });
});

describe("compareExtravars", () => {
  test("names the top-level keys that differ, leaving reserved keys out", () => {
    expect(compareExtravars({ a: 1, b: { c: 2 }, x: 1, __verbose__: true, __playbook__: "p" }, { a: 1, b: { c: 3 }, y: 1 }))
      .toEqual(["b", "x", "y"]);
  });
});

describe("per-form launchValidation", () => {
  test("the stricter of the form and LAUNCH_VALIDATION wins", () => {
    appConfig.launchValidation = "off";
    expect(launchValidationMode({})).toBe("off");
    expect(launchValidationMode({ launchValidation: "enforce" })).toBe("enforce");
    expect(launchValidationMode({ launchValidation: "log" })).toBe("log");
    appConfig.launchValidation = "enforce";
    // a form can never loosen what the instance enforces
    expect(launchValidationMode({ launchValidation: "off" })).toBe("enforce");
    appConfig.launchValidation = "log";
    expect(launchValidationMode({ launchValidation: "enforce" })).toBe("enforce");
    expect(launchValidationMode({ launchValidation: "bogus" })).toBe("log");
  });

  test("a form with launchValidation: enforce is enforced while the instance is off", async () => {
    appConfig.launchValidation = "off";
    const strict = { ...formObj, launchValidation: "enforce" };
    const err = await guardLaunch({ ...args({ host: "test-1" }), formObj: strict }).catch((e) => e);
    expect(err.name).toBe("ValidationError");
    const built = await guardLaunch({ ...args({ host: "prod-1" }, { vm: { name: "forged" } }), formObj: strict });
    expect(built.extravars.vm).toEqual({ name: "prod-1" });
    // the same form without the property : no check at all
    await expect(guardLaunch(args({ host: "test-1" }))).resolves.toBeUndefined();
  });

  test("the form schema takes it on a form and a wizard form, refuses it on a subform", () => {
    const base = { name: "F", type: "ansible", playbook: "p.yml", roles: ["public"], categories: [], fields: [{ name: "a", type: "text" }] };
    expect(() => Form.validateForm({ ...base, launchValidation: "enforce" })).not.toThrow();
    expect(() => Form.validateForm({ ...base, launchValidation: "strict" })).toThrow();
    const wizard = { ...base, fields: undefined, wizard: [{ subform: "s1" }] };
    expect(() => Form.validateForm(wizard)).not.toThrow();
    expect(() => Form.validateForm({ ...wizard, launchValidation: "enforce" })).not.toThrow();
    expect(() => Form.validateForm({ name: "S", type: "subform", fields: [{ name: "a", type: "text" }], launchValidation: "log" })).toThrow();
  });
});

describe("wizard forms", () => {
  const run = (rawFormData, extravars = {}) =>
    validateLaunch({ formConfig, formObj: wizardForm, user, services, rawFormData, extravars, files: {}, uploadPath: uploadDir });

  test("every shown step is checked and merged under its defaultModel", async () => {
    const r = await run(wizardRaw({ basics: { name: "prod-web", large: true }, disk: { size: 50 } }), { vm: { secret: "s" } });
    expect(r.ok).toBe(true);
    expect(r.payload.extravars).toEqual({ vm: { name: "prod-web", large: true, secret: "s", size: 50 } });
    expect(r.payload.credentials).toEqual({ cred: "cred_prod-web" });
  });

  test("a step whose `when` is false is left out, and not checked", async () => {
    const r = await run(wizardRaw({ basics: { name: "prod-web", large: false }, disk: { size: 500 } }));
    expect(r.ok).toBe(true);
    expect(r.payload.extravars).toEqual({ vm: { name: "prod-web", large: false } });
  });

  test("an optional step is left out only when skipped", async () => {
    const r = await run(wizardRaw({ basics: { name: "prod-web", large: false } }, {}));
    expect(r.ok).toBe(false);
    expect(r.errors.missing).toEqual(["extra.note"]);
    // a step that is not optional cannot be skipped
    const forced = await run(wizardRaw({ basics: { name: "prod-web" } }, { extra: true, disk: true }));
    expect(forced.ok).toBe(false);
    expect(forced.errors.missing).toEqual(["disk.size"]);
  });

  test("the errors name the step and the field", async () => {
    const r = await run(wizardRaw({ basics: { name: "test-web" }, disk: { size: 500 } }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors.validationErrors).sort()).toEqual(["basics.name", "disk.size"]);
    expect(describeLaunchErrors(r.errors)).toMatch(/basics\.name \(regex\)/);
  });

  test("a credential is computed on the server, whatever the draft says", async () => {
    const r = await run(wizardRaw({ basics: { name: "prod-web", large: false, cred: "prod-root" } }));
    expect(r.ok).toBe(true);
    expect(r.payload.credentials).toEqual({ cred: "cred_prod-web" });
  });

  test("the log mode compares the client's merged output with the server's", async () => {
    appConfig.launchValidation = "log";
    await guardLaunch({ ...args(wizardRaw({ basics: { name: "prod-web", large: false } }), { vm: { name: "other", large: false } }), formObj: wizardForm });
    expect(warned.join("\n")).toMatch(/differ.*vm/);
  });
});

describe("the raw form data a wizard job keeps", () => {
  test("its step drafts, each filtered by its subform : no passwords, no unknown keys", () => {
    const kept = filterRawFormDataOf(wizardForm, wizardRaw({
      basics: { name: "prod-web", large: true, secret: "s3cr3t", injected: 1 },
      disk: { size: 50 },
      ghost: { x: 1 },
    }));
    expect(kept).toEqual({ __wizard__: true, drafts: { basics: { name: "prod-web", large: true }, disk: { size: 50 } }, skipped: { extra: true } });
  });

  test("a wizard launch without drafts keeps nothing", () => {
    expect(filterRawFormDataOf(wizardForm, { name: "prod-web" })).toEqual({});
  });

  test("a form keeps its fields' values, as before", () => {
    expect(filterRawFormDataOf(formObj, { host: "prod-1", pw: "x", other: 1 })).toEqual({ host: "prod-1" });
  });
});

describe("guardLaunch", () => {
  test("off : nothing is checked, nothing is logged", async () => {
    appConfig.launchValidation = "off";
    await expect(guardLaunch(args({ host: "test-1" }))).resolves.toBeUndefined();
    await expect(guardLaunch(args({}, { host: "anything" }))).resolves.toBeUndefined();
    expect(warned).toEqual([]);
  });

  test("log : an invalid launch is logged and goes ahead", async () => {
    await expect(guardLaunch(args({ host: "test-1" }))).resolves.toBeUndefined();
    expect(warned.join("\n")).toMatch(/would refuse form 'Create host' for bob .* failing rules : host \(regex\)/);
  });

  test("log : a verified upload is not reported as differing, however the browser wrote its path", async () => {
    const u = upload("notes.txt", 100);
    const browserCopy = { ...u, destination: "./persistent/uploads/", path: path.relative(process.cwd(), u.path), size: 100 };
    await guardLaunch(args({ host: "prod-1" }, { vm: { name: "prod-1" }, size: 10, secrets: {}, cred: "cred_prod-1", upload: browserCopy }, { upload: browserCopy }));
    expect(warned).toEqual([]);
  });

  test("log : forged extravars are named, the client's are still used", async () => {
    const forged = { vm: { name: "rm -rf" }, size: 10, secrets: {}, extra: "x" };
    await expect(guardLaunch(args({ host: "prod-1" }, forged))).resolves.toBeUndefined();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/extravars differ from the ones the server builds for cred, extra, vm/);
    expect(warned[0]).not.toContain("rm -rf");
  });

  test("enforce : an invalid launch is refused with the failing fields", async () => {
    appConfig.launchValidation = "enforce";
    const err = await guardLaunch(args({ host: "test-1" })).catch((e) => e);
    expect(err.name).toBe("ValidationError");
    expect(err.status).toBe(422);
    expect(err.details.validationErrors).toEqual({ host: [{ type: "regex", description: "Must start with prod-" }] });
  });

  test("enforce : valid rawFormData next to forged extravars runs the server's extravars", async () => {
    appConfig.launchValidation = "enforce";
    const built = await guardLaunch(args({ host: "prod-1" }, { vm: { name: "rm -rf" }, size: 999, cred: "stolen", __verbose__: true }));
    expect(built.extravars).toEqual({ vm: { name: "prod-1" }, size: 10, secrets: {}, cred: "cred_prod-1", __verbose__: true });
    expect(built.credentials).toEqual({ cred: "cred_prod-1" });
  });

  test("enforce : a file value in rawFormData without a verified upload never reaches the extravars", async () => {
    appConfig.launchValidation = "enforce";
    const built = await guardLaunch(args({ host: "prod-1", upload: { path: "/etc/shadow", originalname: "x.txt" } }, { upload: { path: "/etc/shadow" } }));
    expect(built.extravars.upload).toBeUndefined();
    expect(JSON.stringify(built)).not.toContain("/etc/shadow");
    // and a required file without an upload is missing
    const required = { ...formObj, fields: formObj.fields.map((f) => (f.name === "upload" ? { ...f, required: true } : f)) };
    const err = await guardLaunch({ ...args({ host: "prod-1", upload: {} }), formObj: required }).catch((e) => e);
    expect(err.details.missing).toEqual(["upload"]);
  });

  test("enforce : a plain list row the list's source does not produce is validated", async () => {
    appConfig.launchValidation = "enforce";
    const listForm = {
      name: "L", fields: [{ name: "users", type: "list", subform: "u", default: [{ name: "alice" }] }],
      subforms: [{ name: "u", type: "subform", fields: [{ name: "name", type: "text", regex: { expression: "^[a-z]+$", description: "lower case only" } }] }],
    };
    const call = (rows) => guardLaunch({ form: "L", formConfig: { forms: [listForm] }, formObj: listForm, user, rawFormData: { users: rows }, extravars: {} });
    // the untouched default row passes ; a forged one is checked
    await expect(call([{ name: "alice" }])).resolves.toMatchObject({ extravars: { users: [{ name: "alice" }] } });
    const err = await call([{ name: "alice" }, { name: "Robert'); DROP" }]).catch((e) => e);
    expect(err.details.rowErrors.users[0]).toMatchObject({ index: 1, invalid: ["name"] });
  });

  test("enforce : a forged upload path is refused", async () => {
    appConfig.launchValidation = "enforce";
    const err = await guardLaunch(args({ host: "prod-1" }, {}, { upload: { originalname: "x.txt", path: outside } })).catch((e) => e);
    expect(err.name).toBe("ValidationError");
    expect(err.details.uploads).toEqual([{ field: "upload", reason: "the upload is not in the upload folder" }]);
  });

  test("enforce : a wizard form runs the extravars the server built from its steps", async () => {
    appConfig.launchValidation = "enforce";
    const built = await guardLaunch({ ...args(wizardRaw({ basics: { name: "prod-web" }, disk: { size: 50 } }), { forged: true }), formObj: wizardForm });
    expect(built.extravars).toEqual({ vm: { name: "prod-web", large: true, size: 50 } });
  });

  test("enforce : a wizard step that breaks its rules is refused", async () => {
    appConfig.launchValidation = "enforce";
    const err = await guardLaunch({ ...args(wizardRaw({ basics: { name: "test-web" }, disk: { size: 50 } })), formObj: wizardForm }).catch((e) => e);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toMatch(/basics\.name \(regex\)/);
  });

  test("enforce : leaving rawFormData out is not a way around the check", async () => {
    appConfig.launchValidation = "enforce";
    const err = await guardLaunch(args({}, { host: "anything" })).catch((e) => e);
    expect(err.name).toBe("ValidationError");
    expect(err.message).toMatch(/no rawFormData was sent/);
  });
});
