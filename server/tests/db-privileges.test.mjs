// The database user's rights beyond the AnsibleForms schema : a warning on the Status page and
// in the log (lib/dbPrivileges.js).
import { describe, test, expect, vi } from "vitest";

vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));
const { serverWidePrivileges } = await import("../src/lib/dbPrivileges.js");

describe("server-wide privileges", () => {
  test("root has them", () => {
    expect(serverWidePrivileges([
      "GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION",
      "GRANT PROXY ON ''@'%' TO 'root'@'%' WITH GRANT OPTION",
    ])).toEqual(["ALL PRIVILEGES"]);
  });

  test("a user limited to the AnsibleForms schema has none : USAGE is only the right to connect", () => {
    expect(serverWidePrivileges([
      "GRANT USAGE ON *.* TO `ansibleforms`@`%` IDENTIFIED BY PASSWORD '*ABC'",
      "GRANT ALL PRIVILEGES ON `AnsibleForms`.* TO `ansibleforms`@`%`",
    ])).toEqual([]);
  });

  test("single global rights are named", () => {
    expect(serverWidePrivileges(["GRANT SELECT, PROCESS, SUPER ON *.* TO 'x'@'%'"])).toEqual(["SELECT", "PROCESS", "SUPER"]);
  });
});
