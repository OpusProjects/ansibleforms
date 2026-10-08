'use strict';
import Settings from '../../models/settings.model.js';
import Form from '../../models/form.model.js';
import Lock from '../../models/lock.model.js';
import RestResult from '../../models/restResult.model.v2.js';
import Helpers from '../../lib/common.js';
import i18n from '../../lib/i18n.js';
import yaml from 'yaml';
import appConfig from '../../../config/app.config.js';
import { auditConfigChange, configHash as auditConfigHash } from '../../lib/configAudit.js';


// Config edits are exclusive with an active designer session : the designer
// snapshots the config at lock time and rewrites it on save, so any config
// mutation from here (save/import/export) would silently fight it. When the
// lock is held, send a 423 and return true so the caller stops.
const refuseWhileDesignerLocked = async function(req, res) {
  if (!(await Lock.isHeld())) {
    return false;
  }
  let holder = '';
  try {
    const status = await Lock.status(req?.user?.user || {});
    holder = status?.lock?.username ? ` (${status.lock.username})` : '';
  } catch(e) {
    // holder details unavailable (designer disabled for this user) : stay generic
  }
  res.status(423).json(RestResult.error(i18n.t(req, 'resources.configLockedByDesigner', { username: holder })));
  return true;
};

// Fingerprint of a config text, used for optimistic concurrency on the config
// editor : getConfig hands out the hash of what it served and saveConfig refuses
// when the active config no longer matches it.
// re-exported from configAudit so the concurrency check and the hash recorded in the
// audit trail can never drift apart : two separate sha256 helpers that MUST agree is
// a latent bug waiting for someone to "improve" one of them
const configHash = auditConfigHash;

const find = async function(req, res) {
    try {
      const settings = await Settings.find();
      // Mask mail password before returning to API
      if (settings && settings.mail_password) {
        settings.mail_password = '**********';
      }
      // Expose the env-derived config mode so the client (settings page + designer)
      // knows whether the active config lives in the database.
      if (settings) {
        settings.enableConfigInDatabase = appConfig.enableConfigInDatabase;
      }
      res.json(RestResult.single(settings));
    } catch(err) {
      res.status(500).json(RestResult.error(i18n.t(req, 'resources.failedFindSettings'), Helpers.getError(err)));
    }
};

const mailcheck = async function(req, res) {
  try {
    // If password is masked, fetch the real one from database for testing
    let settingsConfig = req.body;
    if (settingsConfig.mail_password === '**********') {
      const existingSettings = await Settings.find();
      settingsConfig.mail_password = existingSettings.mail_password;
    }
    // the settings page sends no subject or body : the test mail is in the admin's language
    const subject = req.body.subject || i18n.t(req, 'email.test.subject');
    const body = req.body.body || i18n.t(req, 'email.test.body');
    const messageid = await Settings.mailcheck(new Settings(settingsConfig), req.body.to, subject, body);
    res.json(RestResult.single({ message: i18n.t(req, 'resources.mailSent', { id: messageid }) }));
  } catch(err) {
    res.status(500).json(RestResult.error(i18n.t(req, 'resources.mailCheckFailed'), Helpers.getError(err)));
  }
};

// The only settings fields the declarative config seed writes (see lib/seed.js
// applySettings and the settingsSection in lib/seed-schema.js). Everything else on the
// settings row - forms_yaml, the logo, the theme, the language, config_source - is not
// seed material and must stay saveable on a seeded instance.
const SEED_OWNED_SETTINGS = ['mail_server', 'mail_port', 'mail_secure', 'mail_username',
                             'mail_password', 'mail_from', 'url'];

/**
 * Which seed-owned fields this request would actually CHANGE. Comparing values rather
 * than merely looking for the key means the mail page can still save a theme change,
 * and a form that round-trips every field it loaded is not refused for fields it left
 * untouched. Returns [] when nothing seed-owned is being altered.
 */
export function seedManagedSettingChanges(body, stored) {
  return SEED_OWNED_SETTINGS.filter((field) => {
    const wanted = body[field];
    if (wanted === undefined) return false;
    // the client sends the mask for 'password unchanged', which is never a change
    if (field === 'mail_password' && wanted === '**********') return false;
    // mail_secure arrives as a boolean and is stored as 1/0
    if (field === 'mail_secure') return (stored[field] ? 1 : 0) !== (wanted ? 1 : 0);
    return String(stored[field] ?? '') !== String(wanted ?? '');
  });
}

const update = async function(req, res) {
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
    }else{
        try {
          const existingSettings = await Settings.find();
          // The seed owns the mail fields and the url. It does NOT own the theme, the
          // language or config_source, which travel through this same endpoint - so the
          // refusal has to be scoped to the FIELDS, not to the call. Refusing the whole
          // endpoint meant declaring `url` in a seed froze the theme picker, which
          // contradicts what the seed schema says it leaves alone.
          if (existingSettings?.managed) {
            const blocked = seedManagedSettingChanges(req.body, existingSettings);
            if (blocked.length) {
              return res.status(403).json(RestResult.error(i18n.t(req, 'resources.failedUpdateSettings'),
                `${i18n.t(req, 'resources.seedManagedSettings')} (${blocked.join(', ')})`));
            }
          }
          // If password is masked, preserve the existing password
          if (req.body.mail_password === '**********') {
            req.body.mail_password = existingSettings.mail_password;
          }
          const record = new Settings(req.body);
          // Guard against an effectively-empty record (no recognized fields),
          // which would produce invalid `UPDATE t set ?` SQL.
          if (Object.keys(record).length === 0) {
            return res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
          }
          await Settings.update(record);
          res.json(RestResult.single(null));
        } catch(err) {
          res.status(500).json(RestResult.error(i18n.t(req, 'resources.failedUpdateSettings'), Helpers.getError(err)));
        }
    }
};

const importConfig = async function(req, res) {
    try {
      // rewrites the DB config from config.yaml : same designer-lock guard as saveConfig
      if (await refuseWhileDesignerLocked(req, res)) return;
      const message = await Settings.importConfig();
      res.json(RestResult.single({ message }));
    } catch(err) {
      res.status(500).json(RestResult.error(i18n.t(req, 'resources.failedImportConfig'), Helpers.getError(err)));
    }
};

const exportConfig = async function(req, res) {
    try {
      // overwrites config.yaml on disk : same designer-lock guard as saveConfig
      if (await refuseWhileDesignerLocked(req, res)) return;
      const message = await Settings.exportConfig();
      res.json(RestResult.single({ message }));
    } catch(err) {
      // the model tags a refusal the admin can act on (wrong config source, nothing
      // to export) with a 4xx status ; anything untagged is a real server fault.
      res.status(err.statusCode || 500).json(RestResult.error(i18n.t(req, 'resources.failedExportConfig'), Helpers.getError(err)));
    }
};

const getConfig = async function(req, res) {
    try {
      const yaml = await Settings.getActiveConfig();
      // baseHash lets the client detect a concurrent change on save (see saveConfig)
      res.json(RestResult.single({ forms_yaml: yaml, baseHash: configHash(yaml) }));
    } catch(err) {
      res.status(500).json(RestResult.error(i18n.t(req, 'resources.failedFindSettings'), Helpers.getError(err)));
    }
};

const saveConfig = async function(req, res) {
    if (req.body.forms_yaml == null) {
      return res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
    }
    // Config editing is exclusive with an active designer session : refuse while held.
    if (await refuseWhileDesignerLocked(req, res)) return;
    // Validate before persisting: bad config breaks every Form.load
    let parsed;
    try {
      parsed = yaml.parse(req.body.forms_yaml);
    } catch(err) {
      return res.status(400).json(RestResult.error(i18n.t(req, 'resources.failedUpdateSettings'), Helpers.getError(err)));
    }
    try {
      Form.validateConfig({
        categories: parsed?.categories || [],
        roles: parsed?.roles || [],
        constants: parsed?.constants || {}
      });
    } catch(err) {
      return res.status(400).json(RestResult.error(i18n.t(req, 'resources.failedUpdateSettings'), Helpers.getError(err)));
    }
    try {
      // Optimistic concurrency : the client sends back the baseHash getConfig gave
      // it. When the active config changed in the meantime (another admin saving,
      // an import, a designer save) refuse instead of silently clobbering it.
      // baseHash is optional : callers that don't send one keep last-write-wins.
      // read the previous config before overwriting it : the audit delta needs both
      // sides, and this is the only point that has them
      const previous = await Settings.getActiveConfig().catch(() => '');
      if (req.body.baseHash) {
        if (configHash(previous) !== req.body.baseHash) {
          return res.status(409).json(RestResult.error(i18n.t(req, 'resources.configChangedElsewhere')));
        }
      }
      await Settings.saveActiveConfig(req.body.forms_yaml);
      // after the write succeeded, and never awaited : a slow audit must not delay
      // the response, and a failing one must not turn a good save into a 500
      auditConfigChange({
        user: req.user?.user,
        ip: req.ip,
        oldYaml: previous,
        newYaml: req.body.forms_yaml,
        // already parsed above for validateConfig : reusing it avoids a second parse of
        // the same document, which on a large config is measured in seconds
        parsedAfter: parsed || {},
        source: 'active',
      });
      res.json(RestResult.single(null));
    } catch(err) {
      res.status(500).json(RestResult.error(i18n.t(req, 'resources.failedUpdateSettings'), Helpers.getError(err)));
    }
};


export default {
    find,
    mailcheck,
    update,
    importConfig,
    exportConfig,
    getConfig,
    saveConfig
};
