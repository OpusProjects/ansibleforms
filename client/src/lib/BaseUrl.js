// The runtime base path of the app, for subpath hosting behind a reverse proxy.
// The server rewrites the <base href="/"> tag in index.html to the configured
// BASE_URL (e.g. "/ansibleforms/"), we derive the base path from it at runtime.
// Result: "" for root hosting, or "/subpath" (leading slash, no trailing slash).
const BaseUrl = new URL(document.baseURI).pathname.replace(/\/+$/, '');

export default BaseUrl;
