// One image, four roles (AF_ROLE) :
//   unset (or 'all') : AnsibleForms itself, the web app and the worker in one process
//   app              : the web app and the API only, next to a worker (src/app-start.js)
//   worker           : the background work only - schema, seed, schedules, backups, syncs
//                      and cleanups (src/worker/server.js)
//   rte              : a runtime environment that runs playbooks for an app (src/rte/server.js)
// Each role loads only its own modules, so an RTE never loads the web app and the app never
// loads the code that runs ansible-playbook.
//
// The environment (.env files) first, for every role : the config modules read it at import.
import './src/load-env.js';
import { currentRole, ROLES } from './src/lib/role.js';

import { installShutdown } from './src/lib/shutdown.js';

const role = currentRole();
if (!ROLES.includes(role)) {
  console.error(`AF_ROLE='${process.env.AF_ROLE}' is not one of ${ROLES.join(', ')} : refusing to start`);
  process.exit(1);
}
// SIGTERM / SIGINT : each role registers what it closes (src/lib/shutdown.js)
installShutdown();
if (role === 'rte') {
  const { startRte } = await import('./src/rte/server.js');
  await startRte();
} else if (role === 'worker') {
  const { startWorker } = await import('./src/worker/server.js');
  await startWorker();
} else {
  const { startApp } = await import('./src/app-start.js');
  await startApp();
}
