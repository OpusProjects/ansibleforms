'use strict';
import express from 'express';
import logger from './logger.js';

// Which client address the application records: TRUST_PROXY -> express 'trust proxy'.
//
// Every audit row, and the chat approval log, takes its address from req.ip. Without
// 'trust proxy' express answers req.ip with the address of the TCP peer, so behind a reverse
// proxy (nginx, traefik, a kubernetes ingress, a load balancer) every row named the proxy and
// the trail could not say who did anything.
//
// The X-Forwarded-For header that carries the real client address is just a request header,
// though: any client can send one. Trusting it unconditionally would let anybody write the
// address of their choice into the audit trail. So this is OFF by default, and an operator
// says which hops are proxies of theirs - express then walks X-Forwarded-For from the right,
// skipping only those, and the first address that is not a trusted proxy is the client.
//
// The value is read from process.env at call time rather than captured into appConfig, so the
// settings page can re-apply it to the running app without a restart (see envSettings.js).

// the express app registered at startup ; the settings page re-applies the value onto it
let registeredApp = null;

/**
 * Turns the TRUST_PROXY text into the value express expects for 'trust proxy'.
 *
 * - empty, `0`, `false`, `off`, `no` : false - the TCP peer is the client (the default)
 * - a whole number n                 : trust the n proxies closest to the application
 * - `true`                           : trust every hop - the left-most X-Forwarded-For wins
 * - anything else                    : a comma-separated list of proxy addresses, CIDR
 *                                      ranges or the express presets loopback, linklocal
 *                                      and uniquelocal
 *
 * Only the shape is decided here ; whether the addresses in a list are valid is up to
 * express, see compileTrustProxy.
 *
 * @param {string|undefined|null} raw the TRUST_PROXY value
 * @returns {boolean|number|string[]} the 'trust proxy' value
 */
export function parseTrustProxy(raw) {
  const v = String(raw ?? '').trim();
  if (v === '' || /^(0|false|off|no)$/i.test(v)) return false;
  if (/^true$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parses TRUST_PROXY and lets express compile it, so an invalid address is caught here.
 *
 * express (proxy-addr underneath) compiles the list the moment it is set and throws on an
 * address it cannot parse. A scratch app is used, so a bad value never reaches the real one.
 *
 * @param {string|undefined|null} raw the TRUST_PROXY value
 * @returns {boolean|number|string[]} the 'trust proxy' value
 * @throws {TypeError} when the value names an address or range express cannot parse
 */
export function compileTrustProxy(raw) {
  const value = parseTrustProxy(raw);
  express().set('trust proxy', value);
  return value;
}

/**
 * Applies TRUST_PROXY to the express app.
 *
 * app.js calls this once at startup with the app ; the settings page calls it without one
 * to re-apply a changed value to the app registered then. An invalid value never takes the
 * application down: it is logged and the safe default (trust nothing) is applied instead -
 * failing open here would mean trusting a header any client can forge.
 *
 * @param {import('express').Express} [app] the app to configure ; omitted, the registered one
 * @returns {boolean} true when the configured value is in force, false when it was not applied
 */
export function applyTrustProxy(app) {
  if (app) registeredApp = app;
  if (!registeredApp) return false;
  const raw = process.env.TRUST_PROXY;
  let value;
  try {
    value = compileTrustProxy(raw);
  } catch (e) {
    logger.error(`TRUST_PROXY '${raw}' is invalid (${e.message}) ; client addresses are taken from the connection instead`);
    registeredApp.set('trust proxy', false);
    return false;
  }
  registeredApp.set('trust proxy', value);
  if (value === true) {
    logger.warning('[SECURITY] TRUST_PROXY=true trusts X-Forwarded-For from every client. Unless the application is reachable ONLY through the reverse proxy, anybody can choose the address the audit trail records. Prefer the number of proxies or their addresses.');
  } else if (value !== false) {
    logger.notice(`Client addresses are read from X-Forwarded-For through trusted proxies : ${Array.isArray(value) ? value.join(', ') : `${value} hop(s)`}`);
  }
  return true;
}

export default { parseTrustProxy, compileTrustProxy, applyTrustProxy };
