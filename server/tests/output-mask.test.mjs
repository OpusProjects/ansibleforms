// The secrets of a running job never reach job_output : the runner that resolves them
// registers them (lib/outputMask.js, Job.registerOutputSecrets) and every output write of
// that job masks them.
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const queries = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, vars) => {
      queries.push({ sql, vars });
      if (/SELECT id FROM AnsibleForms.`jobs`/.test(sql)) return [{ id: 7 }];
      if (/INSERT INTO AnsibleForms.`job_output`/.test(sql)) return { insertId: 1 };
      return [{ abort_requested: 0 }];
    },
  },
}));
vi.mock("../src/models/form.model.js", () => ({
  default: {
    load: vi.fn(async (_roles, name) => ({ forms: [name === "Wizard" ? {
      name: "Wizard",
      fields: [],
      wizard: [{ subform: "login", defaultModel: "account" }],
      subforms: [{ name: "login", type: "subform", fields: [{ name: "user", type: "text" }, { name: "pass", type: "password" }] }],
    } : {
      name: "Secrets form",
      fields: [
        { name: "pw", type: "password", model: "secrets.pw" },
        { name: "host", type: "text" },
      ],
    }] })),
  },
}));

const { collectSecrets, registerJobSecrets, forgetJobSecrets, maskOutput, MASK } = await import("../src/lib/outputMask.js");
const Job = (await import("../src/models/job.model.js")).default;

const written = () => queries.filter((q) => /INSERT INTO AnsibleForms.`job_output`/.test(q.sql)).map((q) => q.vars[0].output);

beforeEach(() => {
  queries.length = 0;
  forgetJobSecrets(7);
});

describe("outputMask", () => {
  test("a credential map's secrets are found at any depth, its other values are not", () => {
    const found = collectSecrets({ db: { host: "db1", user: "app", password: "Pa55word" }, api: { token: "tok-123", client_key: "-----KEY-----" } });
    expect(found.sort()).toEqual(["-----KEY-----", "Pa55word", "tok-123"].sort());
  });

  test("every spelling of a secret is masked, the JSON-escaped one too, short values are not", () => {
    registerJobSecrets(7, ['p"ss\\word', "abc"]);
    expect(maskOutput(7, 'pw=p"ss\\word json="p\\"ss\\\\word" abc')).toBe(`pw=${MASK} json="${MASK}" abc`);
  });

  test("a job nobody registered is written as it is", () => {
    expect(maskOutput(8, "Pa55word")).toBe("Pa55word");
  });

  test("a secret that contains another is masked whole", () => {
    registerJobSecrets(7, ["secret", "secret-extended"]);
    expect(maskOutput(7, "secret-extended")).toBe(MASK);
  });
});

describe("a job's output", () => {
  test("is written with its credentials and password fields masked", async () => {
    await Job.registerOutputSecrets(7, {
      form: "Secrets form",
      extravars: { secrets: { pw: "FieldPw1" }, host: "web01" },
      credentials: { db: { user: "app", password: "CredPw22" } },
      extra: ["VaultPw333"],
    });
    await Job.createOutput({ output: "ok: FieldPw1 CredPw22 VaultPw333 web01 app", output_type: "stdout", job_id: 7, order: 1 });
    expect(written()).toEqual([`ok: ${MASK} ${MASK} ${MASK} web01 app`]);
  });

  test("the final stdout that replaces the tracked one is masked too", async () => {
    registerJobSecrets(7, ["CredPw22"]);
    await Job.replaceTrackedOutput(7, 1, "password CredPw22");
    expect(written()).toEqual([`password ${MASK}`]);
  });

  test("a wizard's password fields are found under their step's model", async () => {
    await Job.registerOutputSecrets(7, { form: "Wizard", extravars: { account: { user: "bob", pass: "WizPass9" } } });
    expect(maskOutput(7, "bob WizPass9")).toBe(`bob ${MASK}`);
  });

  test("once the job ended, its secrets are forgotten", async () => {
    registerJobSecrets(7, ["CredPw22"]);
    forgetJobSecrets(7);
    expect(maskOutput(7, "CredPw22")).toBe("CredPw22");
  });
});
