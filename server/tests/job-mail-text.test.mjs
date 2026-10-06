// The text of the job mails, in every language : the sentence of an event mail
// (Job.eventMessage) and the subjects (Job.mailSubject, Job.mailWord).
//
// It used to be a translated sentence with an English " by <user>" pasted into a {by} slot,
// so a Japanese mail read "ジョブが起動されました by alice。". Each event now has a whole
// sentence without a user and one with {user}, placed where the language's word order needs
// it - checked here for every locale, and through the real function. The subjects ended in
// an English word ("- Launched", "- failed") in every language; they are translated too.
import { describe, test, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";
vi.mock("../src/models/db.model.js", () => ({ default: { do: async () => [] } }));

const Job = (await import("../src/models/job.model.js")).default;
const { setDefaultLocale } = await import("../src/lib/i18n.js");
const i18n = (await import("../src/lib/i18n.js")).default;

const EVENTS = ["launch", "relaunch", "delete", "approve", "reject"];
// the final statuses a status mail is sent for, read from the model rather than restated
const jobSrc = readFileSync(new URL("../src/models/job.model.js", import.meta.url), "utf8");
const STATUSES = new Function(`return ${/const TERMINAL_STATUS = (\[[^\]]*\]);/.exec(jobSrc)[1]};`)();

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

describe("the mail subjects in every locale", () => {
  test("the final statuses were read from the model", () => {
    expect(STATUSES).toEqual(expect.arrayContaining(["success", "failed", "aborted", "warning"]));
  });

  test.each(i18n.supportedLocales)("%s translates every event, status and default subject", async (lang) => {
    const { default: messages } = await import(`../src/locales/${lang}.js`);
    const { subject, test: testMail } = messages.email;
    for (const e of EVENTS) expect(subject.event[e], `${lang} event ${e}`).toBeTypeOf("string");
    for (const s of STATUSES) expect(subject.status[s], `${lang} status ${s}`).toBeTypeOf("string");
    expect(subject.approval, `${lang} approval`).toBeTypeOf("string");
    expect(testMail.subject, `${lang} test subject`).toBeTypeOf("string");
    expect(testMail.body, `${lang} test body`).toMatch(/^<p>.+<\/p>$/);
  });
});

describe("Job.mailSubject and Job.mailWord", () => {
  const job = { form: "Create host", job_type: "ansible" };

  test("end the subject with the translated event or status", () => {
    expect(Job.mailSubject(job, 7, Job.mailWord("event", "launch"))).toBe("AnsibleForms 'Create host' [ansible] (7) - Launched");
    expect(Job.mailWord("status", "failed")).toBe("Failed");
    setDefaultLocale("ja");
    expect(Job.mailWord("status", "failed")).toBe("失敗");
    expect(Job.mailWord("event", "approve")).toBe("承認");
  });

  test("keep a status with no translation as it is, not as a translation key", () => {
    expect(Job.mailWord("status", "running")).toBe("running");
  });

  test("no English subject word is left in the model", () => {
    expect(jobSrc).not.toMatch(/'(Launched|Relaunched|Deleted|Approved|Rejected)'/);
    expect(jobSrc).not.toContain('"AnsibleForms Approval Request"');
  });
});
