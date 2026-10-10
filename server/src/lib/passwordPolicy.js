/******************************************************************/
/*                                                                */
/*  What a local password must be when a person sets one through  */
/*  the API (a new user, an admin setting it, a user changing     */
/*  their own) : PASSWORD_MIN_LENGTH characters at least (12, 0   */
/*  turns the length off), not the username, not the public      */
/*  default. Length beats composition rules : a long passphrase   */
/*  is strong and easy to remember, "Passw0rd!" is neither.       */
/*                                                                */
/******************************************************************/
import appConfig, { DEFAULT_ADMIN_PASSWORD } from "../../config/app.config.js";

/**
 * Why a password is refused, if it is.
 *
 * Args:
 *   password (string): the new password.
 *   username (string): the account's username.
 *
 * Returns:
 *   {key: string, params?: object}|null: the reason, as a locale key under resources and its
 *     parameters ; null when the password is fine.
 */
export function passwordProblem(password, username = "") {
  const pw = String(password ?? "");
  const min = appConfig.passwordMinLength;
  if (min && pw.length < min) return { key: "passwordTooShort", params: { min } };
  if (username && pw.toLowerCase() === String(username).toLowerCase()) return { key: "passwordIsUsername" };
  if (pw === DEFAULT_ADMIN_PASSWORD) return { key: "defaultPasswordRefused" };
  return null;
}

export default { passwordProblem };
