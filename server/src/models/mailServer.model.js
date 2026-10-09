// The SMTP servers the app sends mail with (approval requests, job notifications) : several
// can be kept, one is active. Each names the smtp credential it logs in with, or none for a
// relay that takes mail without a login.
import CrudModel from './crud.model.js';
import Credential from './credential.model.v2.js';
import Errors from '../lib/errors.js';
import mysql from './db.model.js';
import logger from '../lib/logger.js';

class MailServer extends CrudModel {
  static modelName = 'mailserver';

  /**
   * Checks the credential a server is given : it exists and is an smtp one. An empty
   * credential means none (a relay without a login).
   *
   * Args:
   *   data (object): the fields being saved.
   *
   * Raises:
   *   BadRequestError: the credential does not exist, or is not an smtp one.
   */
  static async assertCredentialUsable(data) {
    if (data.credential === undefined) return;
    if (data.credential === '' || data.credential === null) {
      data.credential = null;
      return;
    }
    const cred = await CrudModel.findByName('credential', data.credential);
    if (!cred) throw new Errors.BadRequestError(`No credential named '${data.credential}'`);
    if (cred.credential_type !== 'smtp') {
      throw new Errors.BadRequestError(`A mail server needs an smtp credential : '${data.credential}' is not one`);
    }
  }

  /**
   * Makes a server the only active one : the others stop being it.
   *
   * Args:
   *   id (number): the server now active.
   */
  static async clearOtherActive(id) {
    await mysql.do('UPDATE AnsibleForms.`mail_servers` SET is_active = 0 WHERE id <> ?', [id]);
    this.changed(this.modelName);
  }

  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    await this.assertCredentialUsable(data);
    // the first server is the active one : mail needs one, nobody should have to tick it
    if (!data.is_active && !(await this.findActive())) data.is_active = 1;
    const id = await super.create(this.modelName, data, opts);
    if (data.is_active && id) await this.clearOtherActive(id);
    return id;
  }

  static async update(data, id, opts = {}) {
    await this.assertCredentialUsable(data);
    const res = await super.update(this.modelName, data, id, opts);
    if (data.is_active) await this.clearOtherActive(id);
    return res;
  }

  static async delete(id, opts = {}) {
    return super.delete(this.modelName, id, opts);
  }

  static async findAll() {
    return super.findAll(this.modelName);
  }

  static async findById(id) {
    return super.findById(this.modelName, id);
  }

  static async findByName(name) {
    return super.findByName(this.modelName, name);
  }

  /** the active server, or null */
  static async findActive() {
    const all = await this.findAll();
    return (all || []).find((s) => s.is_active) || null;
  }

  /**
   * A server as the mail sender takes it (Settings.maildo) : its address, and the user and
   * password of its credential (read from a secret store when the credential names one).
   *
   * Args:
   *   server (object): the mail server.
   *
   * Returns:
   *   Promise<object>: mail_server, mail_port, mail_secure, mail_username, mail_password and
   *     mail_from.
   *
   * Raises:
   *   Error: the credential it names does not exist.
   */
  static async toMailConfig(server) {
    const config = {
      mail_server: server.server,
      mail_port: server.port,
      mail_secure: server.secure ? 1 : 0,
      mail_username: '',
      mail_password: '',
      mail_from: server.from_address,
    };
    if (server.credential) {
      const exact = '^' + String(server.credential).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
      const cred = await Credential.resolveCredential(exact);
      if (!cred || !cred.user) {
        logger.error(`Mail server '${server.name}' uses the credential '${server.credential}', which is not found`);
        throw new Error(`Mail server '${server.name}' uses the credential '${server.credential}', which is not found`);
      }
      config.mail_username = cred.user;
      config.mail_password = cred.password;
    }
    return config;
  }
}

export default MailServer;
