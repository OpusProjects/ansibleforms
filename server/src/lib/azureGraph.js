'use strict';
import { stripTrailingSlashes } from './url.js';
import logger from './logger.js';

// Graph pages at 100 by default ; 50 pages is 5000 groups, more than any role mapping needs
const MAX_PAGES = 50;

/**
 * The display names of the groups the signed-in user is a (transitive) member of, from
 * Microsoft Graph, every page. Called by the server at the login step with the Azure access
 * token (#548 : the browser used to do this, and since 6.3.0 it no longer has that token).
 * A failure throws with Graph's status and message, so the log says why a login failed.
 */
export async function fetchAzureGroups(accessToken, graphUrl, { fetchImpl = fetch } = {}) {
  const names = [];
  let url = `${stripTrailingSlashes(graphUrl || 'https://graph.microsoft.com')}/v1.0/me/transitiveMemberOf?$select=displayName&$top=999`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) throw new Error(`Microsoft Graph returned ${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} : ${json?.error?.message || text.slice(0, 200)}`);
    for (const g of json?.value || []) if (g?.displayName) names.push(String(g.displayName));
    url = json?.['@odata.nextLink'] || null;
  }
  return names;
}

/** the groups that pass the provider's group filter (a regular expression) ; an invalid filter lets everything through, and says so */
export function filterGroups(names, groupfilter) {
  if (!groupfilter) return names;
  let regex;
  try { regex = new RegExp(groupfilter); } catch { logger.warning(`The group filter '${groupfilter}' is not a valid regular expression - no filter applied`); return names; }
  return names.filter((n) => regex.test(n));
}

export default { fetchAzureGroups, filterGroups };
