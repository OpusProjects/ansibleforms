"use strict";
import Runner, { SECRET_MASK } from "../../models/runner.model.js";
import RestResult from "../../models/restResult.model.v2.js";
import Errors from "../../lib/errors.js";
import i18n from "../../lib/i18n.js";
import { RUNNER_TYPES, getRunner } from "../../runners/index.js";

// the token and password are stored encrypted and decrypted on read, so they never leave
// here unmasked
function maskSecrets(runner) {
  if (!runner) return runner;
  const copy = { ...runner };
  if (copy.token) copy.token = SECRET_MASK;
  if (copy.password) copy.password = SECRET_MASK;
  return copy;
}

const find = async (req, res) => {
  try {
    if (req.query.name) {
      return res.json(RestResult.single(maskSecrets(await Runner.findByName(req.query.name))));
    }
    const list = await Runner.withState(await Runner.findAll());
    return res.json(RestResult.list(list.map(maskSecrets)));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

// the types a runner can have, with what each can run
const types = async (req, res) => {
  try {
    return res.json(RestResult.list(RUNNER_TYPES.map((type) => ({ type, ...getRunner(type).capabilities }))));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const create = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, "errors.requiredFields"));
    }
    const created = await Runner.create(req.body);
    return res.status(201).json(RestResult.single(i18n.t(req, "resources.runnerAdded"), created));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const findById = async (req, res) => {
  try {
    const runner = await Runner.findById(req.params.id);
    if (!runner) throw new Errors.NotFoundError(i18n.t(req, "resources.runnerNotFound"));
    return res.json(RestResult.single(maskSecrets(runner)));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const update = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, "errors.requiredFields"));
    }
    const updated = await Runner.update(req.body, req.params.id);
    if (!updated) throw new Errors.NotFoundError(i18n.t(req, "resources.runnerNotFound"));
    return res.json(RestResult.single(updated));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const deleteRunner = async (req, res) => {
  try {
    const deleted = await Runner.delete(req.params.id);
    if (!deleted) throw new Errors.NotFoundError(i18n.t(req, "resources.runnerNotFound"));
    return res.json(RestResult.single(deleted));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

// read only : the runner's health, never a job
const check = async (req, res) => {
  try {
    const runner = await Runner.findById(req.params.id);
    if (!runner) throw new Errors.NotFoundError(i18n.t(req, "resources.runnerNotFound"));
    const details = await Runner.check(runner);
    return res.json(RestResult.single({ result: i18n.t(req, "resources.runnerConnectionOk"), details }));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

export default { find, types, create, findById, update, delete: deleteRunner, check };
