// How the browser may cache the files the server serves from views/ (the built client).
//
// Only the bundles under assets/ carry a content hash in their name (index-BwH3d7XD.js) : a
// new build gives them a new name, so they can be cached for good. Every other file keeps its
// name from release to release - css/themes.css, img/*, favicon.svg - and used to be cached
// for a year as well, so a browser kept a stale copy long after an upgrade and never asked
// again (issue #660). Those are now 'no-cache' : the browser revalidates them on every use,
// which costs a 304 (Last-Modified still validates them, the etag stays off) and never a
// stale file.
import path from "path";

const ONE_YEAR = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

// the setHeaders option of express.static for the given public folder. send() leaves a
// Cache-Control header that setHeaders already set alone, so no maxAge is passed.
export function staticCacheHeaders(publicPath) {
  return (res, filePath) => {
    const hashed = path.relative(publicPath, filePath).startsWith(`assets${path.sep}`);
    res.setHeader("Cache-Control", hashed ? ONE_YEAR : REVALIDATE);
  };
}

// index.html links the stylesheet and the favicon by a fixed name. Browsers that cached them
// for a year before 'no-cache' (before 7.0.0) would not ask for them again : a version in the
// query string is a new address for them, so every release is fetched fresh.
export function injectAssetVersion(html, version) {
  if (!html || !version) return html;
  const v = encodeURIComponent(version);
  return html
    .replace(/href="(css\/themes\.css)(\?v=[^"]*)?"/, `href="$1?v=${v}"`)
    .replace(/href="(favicon\.svg)(\?v=[^"]*)?"/, `href="$1?v=${v}"`);
}
