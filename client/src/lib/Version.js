// Whether the server runs a newer build than the client in this tab (issue #660).
//
// Every server response names its build in the X-App-Build header (server/src/lib/appBuild.js),
// and the client carries its own build in its bundle (__CLIENT_BUILD__, vite.config.mjs). They
// differ only when this tab was opened before an upgrade. A development build on either side
// ('dev', or no header at all) is never reported : it has no build to compare.
export function isNewerBuild(serverSha, clientSha) {
  if (!serverSha || !clientSha) return false;
  if (serverSha === 'dev' || clientSha === 'dev') return false;
  return serverSha !== clientSha;
}

// the sha of the client running in this tab ; 'dev' under test or without build-info.json
export function clientSha() {
  return typeof __CLIENT_BUILD__ !== 'undefined' ? __CLIENT_BUILD__.gitSha : 'dev';
}
