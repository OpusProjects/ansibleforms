// The build of the running server, and the X-App-Build header that tells the client about it
// (issue #660).
//
// The client carries its own build in its bundle (__CLIENT_BUILD__, vite.config.mjs). A tab left
// open across an upgrade keeps running the old bundle, and every response it gets from the new
// server carries the new build in X-App-Build : the client compares the two and offers a reload.
import fs from "fs";
import path from "path";

// the docker build writes build-info.json next to package.json (scripts/generate-build-info.sh) ;
// a development server has none and reports package.json's version alone
export function readBuildInfo(dir) {
  let version = "";
  let gitSha = "";
  try {
    version = JSON.parse(fs.readFileSync(path.resolve(dir, "package.json"), "utf-8")).version || "";
  } catch {
    // no package.json : no version
  }
  try {
    const info = JSON.parse(fs.readFileSync(path.resolve(dir, "build-info.json"), "utf-8"));
    version = info.version || version;
    gitSha = info.gitSha || "";
  } catch {
    // build-info.json is only there in a docker build
  }
  return { version, gitSha };
}

// express middleware : every response names the server's build. Nothing is set without a build
// sha (a development server), so a development client never sees a mismatch.
export function appBuildHeader(gitSha) {
  return (req, res, next) => {
    if (gitSha) res.setHeader("X-App-Build", gitSha);
    next();
  };
}
