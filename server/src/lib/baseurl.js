// helpers to host the application under a url subpath (issue #106)
// the subpath comes from the BASE_URL environment variable, e.g. "/ansibleforms"
import { stripLeadingSlashes, stripTrailingSlashes } from "./url.js";

// normalize a base url to "" (root hosting) or "/subpath" (leading slash, no trailing slash)
export function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  var result = baseUrl.trim();
  // strip surrounding slashes and collapse to a clean path
  result = stripLeadingSlashes(stripTrailingSlashes(result));
  if (!result) return "";
  return "/" + result;
}

// rewrite the base tag in the built index.html to the configured base url,
// so all relative asset/api references resolve under the subpath at runtime
export function injectBaseUrl(html, baseUrl) {
  if (!html) return html;
  const href = `${baseUrl}/`;
  if (/<base\s+href="[^"]*"\s*\/?>/.test(html)) {
    return html.replace(/<base\s+href="[^"]*"\s*\/?>/, `<base href="${href}" />`);
  }
  // no base tag in the build (older build), insert one right after <head>
  return html.replace(/<head>/, `<head>\n  <base href="${href}" />`);
}
