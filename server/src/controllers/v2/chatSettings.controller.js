'use strict';
import ChatSettings from '../../models/chatSettings.model.js';
import RestResultv2 from '../../models/restResult.model.v2.js';
import logger from "../../lib/logger.js";
import i18n from '../../lib/i18n.js';
import { checkProvider } from '../../chat/providers/index.js';

const MASK = '**********';

const find = async function (req, res) {
  try {
    const row = await ChatSettings.find();
    // the api key never leaves the server
    if (row.api_key) row.api_key = MASK;
    res.status(200).json(RestResultv2.single(row));
  } catch (err) {
    logger.error("Error finding chat settings: ", err);
    res.status(500).json(RestResultv2.error(i18n.t(req, 'resources.failedFindChatSettings'), err.toString()));
  }
};

const update = async function (req, res) {
  if (!req.body || (req.body.constructor === Object && Object.keys(req.body).length === 0)) {
    return res.status(409).json(RestResultv2.error(i18n.t(req, 'errors.noDataSent')));
  }
  try {
    const existing = await ChatSettings.find();
    // from the declarative config seed : read only here, the seed re-applies it
    if (existing?.managed) {
      return res.status(403).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateChatSettings'), i18n.t(req, 'resources.seedManagedChatSettings')));
    }
    const body = { ...req.body };
    if (body.api_key === MASK) body.api_key = existing.api_key;
    try {
      await ChatSettings.assertCredentialUsable(body.credential);
    } catch (err) {
      return res.status(400).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateChatSettings'), err.message));
    }
    let record;
    try {
      record = new ChatSettings(body);
    } catch (err) {
      // a setting that cannot be sent as it is (extra headers) : say which, do not store it
      return res.status(400).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateChatSettings'), err.message));
    }
    await ChatSettings.update(record);
    res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'resources.chatSettingsUpdated') }));
  } catch (err) {
    logger.error("Error updating chat settings: ", err);
    res.status(500).json(RestResultv2.error(i18n.t(req, 'resources.failedUpdateChatSettings'), err.toString()));
  }
};

const check = async function (req, res) {
  try {
    const existing = await ChatSettings.find();
    let body = { ...existing, ...(req.body || {}) };
    if (!body.api_key || body.api_key === MASK) body.api_key = existing.api_key;
    // the key of the credential it names (the one on the page, saved or not)
    body = await ChatSettings.withCredential(body);
    const result = await checkProvider(body);
    res.status(200).json(RestResultv2.single(result));
  } catch (err) {
    // the provider's status and message, never the key
    logger.warning(`Chat provider check failed : ${err.message}`);
    res.status(502).json(RestResultv2.error(i18n.t(req, 'resources.chatCheckFailed'), err.message));
  }
};

export default { find, update, check };
