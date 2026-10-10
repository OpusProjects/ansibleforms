/******************************************************************/
/*                                                                */
/*  What a playbook job needs that is secret, resolved by the     */
/*  app before it hands the job to an RTE (runners/rte.js) : the  */
/*  credential map, the ansible login (__ansibleCredentials__)    */
/*  and the vault password (__vaultCredentials__). The RTE gets   */
/*  them sealed (lib/sealedSecrets.js).                           */
/*                                                                */
/******************************************************************/
import logger from "./logger.js";
import Credential from "../models/credential.model.v2.js";

/**
 * Resolves a job's secrets from its extravars and credential map.
 *
 * Args:
 *   extravars (object): the job's extravars.
 *   creds (object): the job's credential map (jobs.credentials).
 *
 * Returns:
 *   Promise<object>: {
 *     credentials: the resolved credential map (extravars.__credentials__ wins),
 *     ansible: { user, password } | { error } | null,
 *     vault: { password } | { error } | null,
 *   } ; an error is the reason a credential could not be read, for the job's output.
 */
export async function resolveJobSecrets(extravars = {}, creds = {}) {
  // credentials passed through extravars have precedence over the others
  const credentials = await Credential.resolveCredentialMap(extravars.__credentials__ || creds || {});
  let ansible = null;
  if (extravars.__ansibleCredentials__) {
    try {
      const c = await Credential.resolveCredential(extravars.__ansibleCredentials__);
      ansible = { user: c.user, password: c.password };
    } catch (err) {
      logger.error("Failed to get ansible credentials : ", err);
      ansible = { error: err.message || String(err) };
    }
  }
  let vault = null;
  if (extravars.__vaultCredentials__) {
    try {
      const c = await Credential.resolveCredential(extravars.__vaultCredentials__);
      vault = { password: c.password };
    } catch (err) {
      logger.error("Failed to get vault credentials : ", err);
      vault = { error: err.message || String(err) };
    }
  }
  return { credentials, ansible, vault };
}

export default { resolveJobSecrets };
