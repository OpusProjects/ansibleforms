// One image, two roles :
//   AF_ROLE unset or 'app' : AnsibleForms itself (src/app-start.js)
//   AF_ROLE=rte            : a runtime environment that runs playbooks for an app (src/rte/server.js)
// Each role loads only its own modules, so an RTE never loads the web app and the app never
// loads the code that runs ansible-playbook.
//
// The environment (.env files) first, for both roles : the config modules read it at import.
import './src/load-env.js';

if (process.env.AF_ROLE === 'rte') {
  const { startRte } = await import('./src/rte/server.js');
  await startRte();
} else {
  const { startApp } = await import('./src/app-start.js');
  await startApp();
}
