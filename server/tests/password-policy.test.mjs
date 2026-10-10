// What a local password must be when a person sets one (lib/passwordPolicy.js).
import { describe, test, expect, beforeEach } from "vitest";

const appConfig = (await import("./__mocks__/app.config.js")).default;
const { passwordProblem } = await import("../src/lib/passwordPolicy.js");

beforeEach(() => { appConfig.passwordMinLength = 12; });

describe("the password policy", () => {
  test("long enough, not the username, not the default : fine", () => {
    expect(passwordProblem("correct horse battery", "bob")).toBe(null);
  });

  test("too short, with the minimum in the reason", () => {
    expect(passwordProblem("Sh0rt!", "bob")).toEqual({ key: "passwordTooShort", params: { min: 12 } });
  });

  test("the username, in any case", () => {
    expect(passwordProblem("Administrator-1", "administrator-1")).toEqual({ key: "passwordIsUsername" });
  });

  test("the public default", () => {
    expect(passwordProblem("AnsibleForms!123", "admin")).toEqual({ key: "defaultPasswordRefused" });
  });

  test("0 checks no length", () => {
    appConfig.passwordMinLength = 0;
    expect(passwordProblem("abc", "bob")).toBe(null);
  });
});
