// The sentence of a job event mail (Job.eventMessage), in every language.
//
// It used to be a translated sentence with an English " by <user>" pasted into a {by} slot,
// so a Japanese mail read "ジョブが起動されました by alice。". Each event now has a whole
// sentence without a user and one with {user}, placed where the language's word order needs
// it - checked here for every locale, and through the real function.
import { describe, test, expect, vi, afterEach } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

const Job = (await import("../src/models/job.model.js")).default;
const { setDefaultLocale } = await import("../src/lib/i18n.js");
const i18n = (await import("../src/lib/i18n.js")).default;

const EVENTS = ["launch", "relaunch", "delete", "approve", "reject"];

afterEach(() => setDefaultLocale("en"));

describe("the job event sentences in every locale", () => {
  test.each(i18n.supportedLocales)("%s has a sentence with and without the user", async (lang) => {
    const { default: messages } = await import(`../src/locales/${lang}.js`);
    const ev = messages.email.jobevent;
    for (const e of EVENTS) {
      expect(ev[e], `${lang} ${e}`).toBeTypeOf("string");
      expect(ev[e], `${lang} ${e}`).not.toMatch(/\{\w+\}/);
      expect(ev[`${e}By`], `${lang} ${e}By`).toBeTypeOf("string");
      expect(ev[`${e}By`].match(/\{user\}/g), `${lang} ${e}By`).toHaveLength(1);
      expect(ev[`${e}By`], `${lang} ${e}By`).not.toMatch(/\{(?!user\})\w+\}/);
    }
  });
});

describe("Job.eventMessage", () => {
  test("names the user in a whole sentence", () => {
    expect(Job.eventMessage("launch", { username: "alice" })).toBe("Job has been launched by alice.");
  });

  test("leaves the user out when no one is known", () => {
    expect(Job.eventMessage("delete", null)).toBe("Job has been deleted.");
    expect(Job.eventMessage("delete", {})).toBe("Job has been deleted.");
  });

  test("follows the server's language and its word order", () => {
    setDefaultLocale("ja");
    expect(Job.eventMessage("approve", { username: "alice" })).toBe("alice がジョブを承認しました。実行を続行します。");
    setDefaultLocale("ca");
    expect(Job.eventMessage("launch", { username: "alice" })).toBe("alice ha llançat la tasca.");
  });

  test("escapes the name, since the sentence goes into an html mail", () => {
    expect(Job.eventMessage("reject", { username: "<b>eve</b>" })).toBe("Job has been rejected by &lt;b&gt;eve&lt;/b&gt;.");
  });
});
