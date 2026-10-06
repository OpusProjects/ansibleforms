// Without ENCRYPTION_SECRET, stored passwords are encrypted with a fallback key that is in
// the public source. The fallback has to stay (changing it would make every credential
// already stored with it unreadable), so the server says so at startup instead : index.js
// warns when appConfig.encryptionSecretIsDefault is set. This pins that flag.
import { test, expect, vi, beforeEach, afterAll } from "vitest";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_PORT ||= "3306";
process.env.DB_USER ||= "test";
process.env.DB_PASSWORD ||= "test";

const original = process.env.ENCRYPTION_SECRET;

async function loadConfig() {
  vi.resetModules();
  return (await import("../config/app.config.js")).default;
}

beforeEach(() => { delete process.env.ENCRYPTION_SECRET; });
afterAll(() => {
  if (original === undefined) delete process.env.ENCRYPTION_SECRET;
  else process.env.ENCRYPTION_SECRET = original;
});

test("without ENCRYPTION_SECRET the default key is flagged", async () => {
  const config = await loadConfig();
  expect(config.encryptionSecretIsDefault).toBe(true);
  expect(config.encryptionSecret).toHaveLength(32);
});

test("with ENCRYPTION_SECRET it is not", async () => {
  process.env.ENCRYPTION_SECRET = "a-secret-of-our-own-0123456789abcdef";
  const config = await loadConfig();
  expect(config.encryptionSecretIsDefault).toBe(false);
  expect(config.encryptionSecret).toBe("a-secret-of-our-own-0123456789ab");
});

test("the default key itself is unchanged, so stored credentials stay readable", async () => {
  const config = await loadConfig();
  expect(config.encryptionSecret).toBe("undefinedvOVH6sdmpNWjRRIqCc7rdxs");
});
