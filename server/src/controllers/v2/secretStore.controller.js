"use strict";
import SecretStore, { SECRET_MASK as MASK } from "../../models/secretStore.model.js";
import RestResult from "../../models/restResult.model.v2.js";
import Errors from "../../lib/errors.js";
import i18n from "../../lib/i18n.js";
import { checkStore, listMounts } from "../../secrets/providers/index.js";

// token and client_key are stored encrypted and CrudModel decrypts them on read, so
// nothing leaves here without masking them - onto a copy, never the cached record.
function maskSecrets(store) {
  if (!store) return store;
  const copy = { ...store };
  if (copy.token) copy.token = MASK;
  if (copy.client_key) copy.client_key = MASK;
  return copy;
}

const find = async (req, res) => {
  try {
    if (req.query.name) {
      return res.json(RestResult.single(maskSecrets(await SecretStore.findByName(req.query.name))));
    }
    const list = await SecretStore.findAll();
    return res.json(RestResult.list((list || []).map(maskSecrets)));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const create = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, 'errors.requiredFields'));
    }
    const created = await SecretStore.create(req.body);
    return res.status(201).json(RestResult.single(i18n.t(req, 'resources.secretStoreAdded'), created));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const findById = async (req, res) => {
  try {
    const store = await SecretStore.findById(req.params.id);
    if (!store) throw new Errors.NotFoundError(i18n.t(req, 'resources.secretStoreNotFound'));
    return res.json(RestResult.single(maskSecrets(store)));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const update = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      throw new Errors.BadRequestError(i18n.t(req, 'errors.requiredFields'));
    }
    const updated = await SecretStore.update(req.body, req.params.id);
    if (!updated) throw new Errors.NotFoundError(i18n.t(req, 'resources.secretStoreNotFound'));
    return res.json(RestResult.single(updated));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

const deleteStore = async (req, res) => {
  try {
    const deleted = await SecretStore.delete(req.params.id);
    if (!deleted) throw new Errors.NotFoundError(i18n.t(req, 'resources.secretStoreNotFound'));
    return res.json(RestResult.single(deleted));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

// Read only : proves the store answers and accepts us, never returns a secret
const check = async (req, res) => {
  try {
    const store = await SecretStore.findById(req.params.id);
    if (!store) throw new Errors.NotFoundError(i18n.t(req, 'resources.secretStoreNotFound'));
    const details = await checkStore(store);
    return res.json(RestResult.single({ result: i18n.t(req, 'resources.secretStoreConnectionOk'), details }));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

// The KV mounts a Vault token can see. Quiet on failure : the page falls back to free text.
const mounts = async (req, res) => {
  try {
    const store = await SecretStore.findById(req.params.id);
    if (!store) throw new Errors.NotFoundError(i18n.t(req, 'resources.secretStoreNotFound'));
    return res.json(RestResult.list(await listMounts(store)));
  } catch (err) {
    Errors.ReturnError(res, err);
  }
};

export default { find, create, findById, update, delete: deleteStore, check, mounts };
