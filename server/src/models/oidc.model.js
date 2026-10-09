
'use strict';
import logger from "../lib/logger.js";
import mysql from "./db.model.js";
import appConfig from "../../config/app.config.js";
import crypto from "../lib/crypto.js";


class OIDC {
  static async isEnabled() {
    // SSO switched off (ENABLE_SSO, Settings > SSO) : no provider, whatever is configured
    if (!appConfig.enableSso) return { enable: 0, groupfilter: '', issuer: '' };
    const res = await mysql.do("SELECT enable,groupfilter,issuer FROM AnsibleForms.`oauth2_providers` WHERE provider='oidc' AND enable;");
    if (res.length > 0) {
      return res[0];
    } else {
      return { enable: 0, groupfilter: '', issuer: '' };
    }
  }

  static async find() {
    const res = await mysql.do("SELECT client_id, client_secret, enable, groupfilter, issuer, redirect_uri FROM AnsibleForms.`oauth2_providers` WHERE provider='oidc' LIMIT 1;");
    if (res.length > 0) {
      let record = res[0];
      try {
        record.client_secret = record.client_secret ? crypto.decrypt(record.client_secret) : "";
      } catch (e) {
        logger.error("Couldn't decrypt OIDC client_secret, did the secretkey change?");
        record.client_secret = "";
      }
      return {
        client_id: record.client_id || "",
        client_secret: record.client_secret || "",
        enable: record.enable || 0,
        groupfilter: record.groupfilter || "",
        issuer: record.issuer || "",
        redirect_uri: record.redirect_uri || ""
      };
    } else {
      return {
        client_id: "",
        client_secret: "",
        enable: 0,
        groupfilter: "",
        issuer: "",
        redirect_uri: ""
      };
    }
  }
}

export default OIDC;
