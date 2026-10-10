// A job ends once : of two writers racing for it (the RTE's own end, a sweep, the app failing
// it), only the first one writes the end, its last line and its mail (Job.transitionStatus).
import { describe, test, expect, vi, beforeEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

let row;
const outputs = [];
vi.mock("../src/models/db.model.js", () => ({
  default: {
    do: async (sql, params) => {
      if (/UPDATE AnsibleForms.`jobs` SET \? WHERE id=\? AND status IN \(\?\)/.test(sql)) {
        if (!params[2].includes(row.status)) return { affectedRows: 0 };
        Object.assign(row, params[0]);
        return { affectedRows: 1 };
      }
      if (/INSERT INTO AnsibleForms.`job_output`/.test(sql)) { outputs.push(params[0].output); return { insertId: 1 }; }
      if (/SELECT id FROM AnsibleForms.`jobs`/.test(sql)) return [{ id: 1 }];
      if (/SELECT abort_requested/.test(sql)) return [{ abort_requested: 0 }];
      return [];
    },
  },
}));

const Job = (await import("../src/models/job.model.js")).default;
let mails;
beforeEach(() => {
  row = { status: "running" };
  outputs.length = 0;
  mails = 0;
  Job.sendStatusNotification = async () => { mails++; };
});

describe("ending a job", () => {
  test("the first end wins : its status, its last line, one mail", async () => {
    await Job.endJobStatus(1, 9, "stdout", "success", "ok: [Playbook finished]");
    await Job.endJobStatus(1, 10, "stderr", "failed", "[ERROR]: the RTE lost job 1");
    expect(row.status).toBe("success");
    expect(outputs).toEqual(["ok: [Playbook finished]"]);
    expect(mails).toBe(1);
  });

  test("a job given up on (abandoned) that its runner finished after all ends with what happened", async () => {
    row.status = "abandoned";
    await Job.endJobStatus(1, 9, "stdout", "success", "ok: [Playbook finished]");
    expect(row.status).toBe("success");
  });

  test("an aborted or rejected job is not ended again", async () => {
    for (const status of ["aborted", "rejected", "success", "failed"]) {
      row.status = status;
      await Job.endJobStatus(1, 9, "stdout", "success", "late");
      expect(row.status).toBe(status);
    }
    expect(outputs).toEqual([]);
    expect(mails).toBe(0);
  });

  test("a status moves only from the ones named", async () => {
    expect(await Job.transitionStatus(1, ["approve"], { status: "rejected" })).toBe(false);
    row.status = "approve";
    expect(await Job.transitionStatus(1, ["approve"], { status: "rejected" })).toBe(true);
    expect(row.status).toBe("rejected");
  });
});
