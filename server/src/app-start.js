// The app : the web interface, the API and everything around it. Started by index.js with
// AF_ROLE unset (the app and the worker in one process, as AnsibleForms always ran) or
// AF_ROLE=app (the web app only, next to a worker - several may run behind a load balancer).
// A worker or an RTE never loads this module.
import express from 'express';
import ansibleforms from './app.js';
import appConfig from '../config/app.config.js';
import { injectBaseUrl } from './lib/baseurl.js';
import { staticCacheHeaders, injectAssetVersion } from './lib/staticCache.js';
import { readBuildInfo, appBuildHeader } from './lib/appBuild.js';
import { resolve } from 'path';
import history from 'connect-history-api-fallback';
import httpsConfig from '../config/https.config.js';
import { registerHttpsServer } from './lib/httpsContext.js';
import authConfig from '../config/auth.config.js';
import logger from './lib/logger.js';
import { reloadConfigSeed } from './lib/seed.js';
import { getExpressionMode } from './lib/expressionMode.js';
import { ROLE, runsWorker, nodeId } from './lib/role.js';
import { holdsWorkerLock, tryWorkerLock, keepWorkerLock, workerLockMiss, releaseWorkerLock } from './lib/workerLock.js';
import { onShutdown } from './lib/shutdown.js';
import cronService from './services/cron.service.js';
import { bump } from './lib/epochs.js';
import { waitForDatabase } from './init/index.js';
import { runWorker, stopLostWorker } from './init/worker.js';
import { startCluster } from './init/cluster.js';
import Job from './models/job.model.js';
import Schema, { SCHEMA_MANIFEST } from './models/schema.model.js';
import mysql from './models/db.model.js';
import { missingFromManifest } from './lib/schemaCompleteness.js';
import { die } from './lib/die.js';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
// the server folder : the built client lives in ./views next to index.js
const __dirname = path.resolve(path.dirname(__filename), '..');

const app = express();

// the running build (build-info.json from the docker build, package.json otherwise) : the
// stylesheet and favicon links in index.html carry version and sha as ?v=, so every release and
// every rebuild is a new address for them, and every response names the sha in X-App-Build
const build = readBuildInfo(__dirname);
const assetVersion = () => [build.version, build.gitSha].filter(Boolean).join('-');
/**
 * Waits until the worker has created the schema and patched it to this version : serving this version's code
 * over a schema the worker could not patch yet fails on missing tables, while the old check -
 * "not empty" - said all was well. Says what is missing every minute. With ALLOW_SCHEMA_CREATION=0
 * an empty database is nobody's to create automatically, so the app starts and offers the
 * schema page instead.
 */
async function waitForTheWorkersSchema() {
  for (let attempt = 0; ; attempt++) {
    let reason = null;
    try {
      if (await Schema.isEmpty()) {
        if (!appConfig.allowSchemaCreation) return;
        reason = 'the database holds no AnsibleForms tables yet';
      } else {
        const m = await missingFromManifest(SCHEMA_MANIFEST, mysql);
        const missing = [...m.missingTables, ...m.missingColumns];
        if (missing.length) reason = `the schema lacks ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`;
      }
    } catch (e) {
      reason = `the schema cannot be checked (${e.message || e})`;
    }
    if (!reason) return;
    if (attempt % 12 === 0) logger.notice(`Waiting for the worker to create or patch the schema : ${reason}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// load the ansibleforms app
export async function startApp(){
  // before the routes : every response, the api's included, names the server's build, so a tab
  // left open across an upgrade learns it runs an older one (src/lib/appBuild.js, issue #660)
  app.use(appBuildHeader(build.gitSha));

  // Several app nodes must sign and accept the same tokens : a secret generated per process
  // makes every node refuse what another one signed - a login that works one request in two
  if (ROLE === 'app' && authConfig.secretIsGenerated) {
    await die('AF_ROLE=app needs ACCESS_TOKEN_SECRET, the same on every app node : refusing to start');
  }

  await waitForDatabase();
  // closed last on a stop (lib/shutdown.js runs the closers last-registered first)
  onShutdown('database', () => mysql.end());
  // before the worker's start : a change another node makes while this one bootstraps (a slow
  // seed, a clone) must reach it, and the first read of the change notices is the baseline
  await startCluster();
  let worker = false;
  if (runsWorker) {
    // AF_ROLE unset : this process is the worker too - unless another one already is, then it
    // serves the web app only and takes over the background work when that one stops
    worker = await tryWorkerLock();
    if (worker) {
      await runWorker();
    } else if (workerLockMiss() === 'unreachable') {
      logger.warning('Could not ask the database for the worker lock : this process serves the web app and keeps trying');
    } else {
      logger.warning('Another process holds the worker lock : this one serves the web app and takes over the background work when that process stops');
    }
    keepWorkerLock({ onAcquired: runWorker, onLost: stopLostWorker });
    // released at once on a stop, so a waiting worker takes over without waiting for the
    // database to notice a dead socket
    onShutdown('worker lock', () => releaseWorkerLock());
    onShutdown('scheduler', () => cronService.stopAll());
  }
  if (!worker) {
    // not the worker (an app node, or a second AF_ROLE unset process) : the schema is the
    // worker's to create and to patch
    await waitForTheWorkersSchema();
    // the jobs this node followed before it restarted (the worker's start does this too)
    Job.abandonOwn(nodeId)
      .then((changed) => { if (changed) logger.warning(`Abandoned ${changed} jobs this node followed before it restarted`); })
      .catch((err) => logger.error('Failed to abandon jobs : ' + (err.message || err)));
  }
  await ansibleforms.load(app);

  if (getExpressionMode() === 'legacy') {
    logger.warning('[SECURITY] EXPRESSION_SANITIZER=legacy : server expressions use the 6.2.1 rules, which let any authenticated user run code on the server. Rewrite the expressions the log reports and go back to strict.');
  }

  if (appConfig.encryptionSecretIsDefault) {
    logger.warning('[SECURITY] ENCRYPTION_SECRET is not set. Stored passwords are encrypted with the default key, which is public in the source code. Set ENCRYPTION_SECRET before you store credentials : changing it later makes the existing ones unreadable.');
  }

  if (authConfig.secretIsGenerated) {
    logger.warning('[SECURITY] JWT signing secret was auto-generated. All tokens will be invalidated on restart. Set the ACCESS_TOKEN_SECRET environment variable for persistent token signing.');
  }

  // set the start directory to load our vue app (frontend/gui)
  const publicPath = resolve(__dirname, './views');
  // only the content-hashed bundles under assets/ are cached for good, every other file is
  // revalidated (src/lib/staticCache.js, issue #660) ; Last-Modified validates, the etag stays off
  const staticConf = { etag: false, setHeaders: staticCacheHeaders(publicPath) };

  // load the built index.html once and rewrite its base tag to the configured
  // base url, so the app can be hosted under a subpath (issue #106)
  var indexHtml = null;
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    indexHtml = injectAssetVersion(
      injectBaseUrl(fs.readFileSync(indexPath, 'utf-8'), appConfig.baseUrl),
      assetVersion()
    );
  } else {
    logger.warning(`No index.html found in ${publicPath}, did you build the client?`);
  }
  const serveIndex = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    if (indexHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(indexHtml);
    } else {
      res.sendFile(indexPath);
    }
  };

  // allow browser history
  app.use(`/`, history()); // this order is important, it must be before the static files middleware

  // serve the (rewritten) index.html with no-cache
  app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('index.html'))) {
      return serveIndex(req, res);
    }
    next();
  });
  app.use("/", express.static(publicPath, staticConf));

  // Catchall for unmatched routes (after static and API)
  app.get(/(.*)/, serveIndex);

  // when a base url is set, mount the whole app under the subpath
  var rootApp = app;
  if (appConfig.baseUrl) {
    rootApp = express();
    // redirect the root and the subpath without trailing slash, for convenience
    // note : the exact path check matters, express also matches the trailing slash variant
    rootApp.get('/', (req, res) => res.redirect(`${appConfig.baseUrl}/`));
    rootApp.get(appConfig.baseUrl, (req, res, next) => {
      if (req.path !== appConfig.baseUrl) return next();
      res.redirect(`${appConfig.baseUrl}/${req.originalUrl.slice(req.path.length)}`);
    });
    rootApp.use(appConfig.baseUrl, app);
  }

  // choose whether to start https or http server
  let httpServer;
  logger.notice(`Serving static files from ${publicPath}`);
  logger.notice(`Exposing app under ${appConfig.baseUrl || '/'}`);
  if (httpsConfig.https) {
    logger.notice("Running https !");
    const credentials = { key: httpsConfig.httpsKey, cert: httpsConfig.httpsCert };
    httpServer = https.createServer(credentials, rootApp);
    // lets the settings page reload the certificate without a restart
    registerHttpsServer(httpServer);
  } else {
    logger.notice("Running http !");
    httpServer = http.createServer(rootApp);
  }

  // start the webserver and listen on the port we choose
  httpServer.listen(appConfig.port,  () => logger.notice(`App running on port ${appConfig.port}!`));
  // first on a stop : no new requests, and the idle keep-alive connections go
  onShutdown('web server', () => new Promise((resolve) => {
    httpServer.close(() => resolve());
    httpServer.closeIdleConnections?.();
  }));


  // SIGHUP re-applies the config seed : the unix idiom for "re-read your configuration", and
  // the one way in that needs no credentials and no reachable port, which is what makes it
  // worth having from inside a container (`kubectl exec ... -- kill -HUP 1`).
  //
  // Node's default action for SIGHUP is to TERMINATE, so installing this changes what closing
  // the terminal does to a foreground process. That is the trade every daemon makes, and the
  // alternative here is a signal that kills an instance which may be running playbooks.
  process.on('SIGHUP', () => {
    // an app node next to a worker : the worker applies the seed, told through the database
    if (!holdsWorkerLock()) {
      logger.notice('SIGHUP : asking the worker to re-apply the config seed');
      bump('seed');
      return;
    }
    // never awaited : a signal handler that blocks would hold the event loop while the seed
    // clones a repository, and reloadConfigSeed reports its own outcome to the log either way
    reloadConfigSeed({ force: true, trigger: 'SIGHUP' })
      .catch((err) => logger.error('SIGHUP config seed reload failed : ' + (err.message || err)));
  });
}
