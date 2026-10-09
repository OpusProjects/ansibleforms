"use strict";
import MailServer from "../../models/mailServer.model.js";
import Settings from "../../models/settings.model.js";
import RestResult from "../../models/restResult.model.v2.js";
import Errors from "../../lib/errors.js";
import Helpers from "../../lib/common.js";
import i18n from "../../lib/i18n.js";

const find = async (req, res) => {
  try {
    if (req.query.name) return res.json(RestResult.single(await MailServer.findByName(req.query.name)));
    return res.json(RestResult.list(await MailServer.findAll()));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const create = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, "errors.requiredFields"));
    }
    const id = await MailServer.create(req.body);
    return res.status(201).json(RestResult.single({ message: i18n.t(req, "success.created", { resource: "Mail server" }), id }));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const findById = async (req, res) => {
  try {
    const server = await MailServer.findById(req.params.id);
    if (!server) throw new Errors.NotFoundError(`No mail server with id ${req.params.id}`);
    return res.json(RestResult.single(server));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const update = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, "errors.requiredFields"));
    }
    await MailServer.update(req.body, req.params.id);
    return res.json(RestResult.single({ message: i18n.t(req, "success.updated", { resource: "Mail server" }) }));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const deleteServer = async (req, res) => {
  try {
    await MailServer.delete(req.params.id);
    return res.json(RestResult.single({ message: i18n.t(req, "success.deleted", { resource: "Mail server" }) }));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

// Send test mail : the saved server, to the address given, in the admin's language
const test = async (req, res) => {
  try {
    if (!req.body?.to) throw new Errors.BadRequestError(i18n.t(req, "errors.requiredFields"));
    const server = await MailServer.findById(req.params.id);
    if (!server) throw new Errors.NotFoundError(`No mail server with id ${req.params.id}`);
    const config = await MailServer.toMailConfig(server);
    const subject = req.body.subject || i18n.t(req, "email.test.subject");
    const body = req.body.body || i18n.t(req, "email.test.body");
    const messageid = await Settings.maildo(config, req.body.to, subject, body);
    return res.json(RestResult.single({ message: i18n.t(req, "resources.mailSent", { id: messageid }) }));
  } catch (err) {
    if (err instanceof Errors.BadRequestError || err instanceof Errors.NotFoundError) return Errors.ReturnError(res, err);
    return res.status(500).json(RestResult.error(i18n.t(req, "resources.mailCheckFailed"), Helpers.getError(err)));
  }
};

export default { find, create, findById, update, delete: deleteServer, test };
