'use strict';
import Ldap from '../../models/ldap.model.js';
import RestResultv2 from '../../models/restResult.model.v2.js';
import logger from "../../lib/logger.js";
import i18n from '../../lib/i18n.js';

const find = async function(req, res) {
  try {
    const ldap = await Ldap.find();
    // Mask LDAP bind password before returning to API
    if (ldap && ldap.bind_user_pw) {
      ldap.bind_user_pw = '**********';
    }
    res.status(200).json(RestResultv2.single(ldap));
  } catch (err) {
    logger.error("Error finding LDAP: ", err);
    res.status(500).json(RestResultv2.error(i18n.t(req, 'resources.failedFindLdap'), err.toString()));
  }
};

// what decides where a check connects to, and how : the stored bind password is only ever
// sent there
const LDAP_TARGET_TEXT = ['server', 'port', 'cert', 'ca_bundle'];
const LDAP_TARGET_FLAGS = ['enable_tls', 'ignore_certs'];

/**
 * Whether a check is for the stored LDAP server : every connection field as stored. A port
 * sent as text or a number, and a flag as true or 1, count as the same value.
 *
 * Args:
 *   sent (object): the configuration of the check.
 *   stored (object): the stored configuration.
 *
 * Returns:
 *   boolean: true when the check connects where the stored configuration does.
 */
function sameLdapTarget(sent, stored) {
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const flag = (v) => v === true || Number(v) === 1;
  return LDAP_TARGET_TEXT.every((f) => text(sent?.[f]) === text(stored?.[f]))
    && LDAP_TARGET_FLAGS.every((f) => flag(sent?.[f]) === flag(stored?.[f]));
}

const check = async function(req, res) {
  if (req.body.constructor === Object && Object.keys(req.body).length === 0) {
    res.status(409).json(RestResultv2.error(i18n.t(req, 'errors.noDataSent')));
    return false;
  }
  try {
    // If password is masked, fetch the real one from database for testing - but only for the
    // stored server : a check against another one would hand it the bind password
    let ldapConfig = req.body;
    if (ldapConfig.bind_user_pw === '**********') {
      const existingLdap = await Ldap.find();
      if (!sameLdapTarget(ldapConfig, existingLdap)) {
        return res.status(400).json(RestResultv2.error(i18n.t(req, 'resources.ldapCheckFailed'), i18n.t(req, 'resources.storedPasswordOtherServer')));
      }
      ldapConfig.bind_user_pw = existingLdap.bind_user_pw;
    }
    const result = await Ldap.check(new Ldap(ldapConfig));
    res.status(200).json(RestResultv2.single(result));
  } catch (err) {
    logger.error("Error checking LDAP connection: ", err);
    res.status(500).json(RestResultv2.error(i18n.t(req, 'resources.ldapCheckFailed'), err.toString()));
  }
};

const update = async function(req, res) {
  if (req.body.constructor === Object && Object.keys(req.body).length === 0) {
    res.status(409).json(RestResultv2.error(i18n.t(req, 'errors.noDataSent')));
    return false;
  }
  try {
    const existingLdap = await Ldap.find();
    // an ldap configuration coming from the declarative config seed is read only here :
    // the seed re-applies on every start, so a save would be silently reverted
    if (existingLdap?.managed) {
      return res.status(403).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateLdap'), i18n.t(req, 'resources.seedManagedLdap')));
    }
    // If password is masked, preserve the existing password
    if (req.body.bind_user_pw === '**********') {
      req.body.bind_user_pw = existingLdap.bind_user_pw;
    }
    await Ldap.update(new Ldap(req.body));
    res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'resources.ldapUpdated') }));
  } catch (err) {
    logger.error("Error updating LDAP: ", err);
    res.status(500).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateLdap'), err.toString()));
  }
};

export default {
  find,
  check,
  update
};