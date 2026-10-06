import express from 'express';
import ansibleforms from './src/app.js';
import appConfig from './config/app.config.js';
import { injectBaseUrl } from './src/lib/baseurl.js';
import { staticCacheHeaders, injectAssetVersion } from './src/lib/staticCache.js';
import { resolve } from 'path';
import history from 'connect-history-api-fallback';
import httpsConfig from './config/https.config.js';
import { registerHttpsServer } from './src/lib/httpsContext.js';
import authConfig from './config/auth.config.js';
import logger from './src/lib/logger.js';
import { reloadConfigSeed } from './src/lib/seed.js';
import { getExpressionMode } from './src/lib/expressionMode.js';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// what the stylesheet and favicon links in index.html carry as ?v= : the version and the
// build's git sha (build-info.json, written by the docker build), so every release and every
// rebuild is a new address for them - package.json alone for a development server
function assetVersion() {
  let version = '';
  let sha = '';
  try {
    version = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8')).version || '';
  } catch { /* no package.json : no version */ }
  try {
    const buildInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, './build-info.json'), 'utf-8'));
    version = buildInfo.version || version;
    sha = buildInfo.gitSha || '';
  } catch { /* build-info.json is only there in a docker build */ }
  return [version, sha].filter(Boolean).join('-');
}
// load the ansibleforms app
async function start(){
  await ansibleforms.load(app);

  if (getExpressionMode() === 'legacy') {
    logger.warning('[SECURITY] EXPRESSION_SANITIZER=legacy : server expressions use the 6.2.1 rules, which let any authenticated user run code on the server. Rewrite the expressions the log reports and go back to strict.');
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

}

// SIGHUP re-applies the config seed : the unix idiom for "re-read your configuration", and
// the one way in that needs no credentials and no reachable port, which is what makes it
// worth having from inside a container (`kubectl exec ... -- kill -HUP 1`).
//
// Node's default action for SIGHUP is to TERMINATE, so installing this changes what closing
// the terminal does to a foreground process. That is the trade every daemon makes, and the
// alternative here is a signal that kills an instance which may be running playbooks.
process.on('SIGHUP', () => {
  // never awaited : a signal handler that blocks would hold the event loop while the seed
  // clones a repository, and reloadConfigSeed reports its own outcome to the log either way
  reloadConfigSeed({ force: true, trigger: 'SIGHUP' })
    .catch((err) => logger.error('SIGHUP config seed reload failed : ' + (err.message || err)));
});

start()
