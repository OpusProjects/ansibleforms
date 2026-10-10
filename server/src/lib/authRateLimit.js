/******************************************************************/
/*                                                                */
/*  A ceiling on the authentication endpoints, per address : the  */
/*  login, the logout, the token refresh and the SSO callbacks.   */
/*  Generous - a person or a script never reaches it - it stops a */
/*  flood of requests at the door, before any password, token or  */
/*  database is touched. The account lockout (loginThrottle.js)   */
/*  is what stops a password from being guessed ; this is the     */
/*  per-process backstop. AUTH_RATE_LIMIT requests per minute, 0  */
/*  turns it off.                                                 */
/*                                                                */
/******************************************************************/
import { rateLimit } from "express-rate-limit";
import appConfig from "../../config/app.config.js";

/**
 * The limiter of the authentication routes.
 *
 * Returns:
 *   function: express middleware ; answers 429 above AUTH_RATE_LIMIT requests a minute from one
 *     address.
 */
export function authRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000,
    // read per request : the setting applies without a restart, 0 lets everything through
    limit: () => appConfig.authRateLimit || Number.MAX_SAFE_INTEGER,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, slow down" },
  });
}

export default { authRateLimit };
