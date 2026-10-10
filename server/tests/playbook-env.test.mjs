// A playbook runs without AnsibleForms' own environment : lookup('env', 'ENCRYPTION_SECRET')
// handed any form author the keys to every stored credential.
import { describe, test, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";
import { APP_ENV, playbookEnv } from "../src/lib/playbookEnv.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.(m?js)$/.test(e.name) ? [p] : [];
  });
}

describe("the playbook environment", () => {
  test("the app's secrets are left out, everything else is passed", () => {
    const env = playbookEnv({
      ENCRYPTION_SECRET: "k", DB_PASSWORD: "p", ACCESS_TOKEN_SECRET: "s", RTE_TOKEN: "t", VAULT_TOKEN: "v",
      MYSQL_PWD: "m", PATH: "/usr/bin", HOME: "/root", ANSIBLE_CONFIG: "/etc/ansible.cfg", AWS_ACCESS_KEY_ID: "aws", HTTPS_PROXY: "http://proxy",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/root", ANSIBLE_CONFIG: "/etc/ansible.cfg", AWS_ACCESS_KEY_ID: "aws", HTTPS_PROXY: "http://proxy" });
  });

  test("every variable the server code reads is left out", () => {
    const read = new Set();
    for (const file of [...sources(path.join(root, "src")), ...sources(path.join(root, "config")), path.join(root, "index.js")]) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g)) read.add(m[1] || m[2]);
    }
    expect([...read].filter((n) => !APP_ENV.has(n) && !n.startsWith("MYSQL_"))).toEqual([]);
  });

  test("every documented environment variable is left out", () => {
    const help = yaml.parse(fs.readFileSync(path.join(root, "help.yaml"), "utf8"));
    const names = [];
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (typeof o.name === "string" && /^[A-Z][A-Z0-9_]+$/.test(o.name) && ("type" in o || "short" in o)) names.push(o.name);
        Object.values(o).forEach(walk);
      }
    };
    walk(help[0]);
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((n) => !APP_ENV.has(n))).toEqual([]);
  });
});
