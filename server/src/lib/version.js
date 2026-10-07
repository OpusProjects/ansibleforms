// This build's version : a release build bakes it into build-info.json, a local build
// leaves that empty and package.json answers.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const appVersion = (() => {
  for (const file of ["../../build-info.json", "../../package.json"]) {
    try {
      const v = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), "utf8")).version;
      if (v) return v;
    } catch { /* next */ }
  }
  return "unknown";
})();

export const majorMinor = (v) => String(v || "").split(".").slice(0, 2).join(".");
