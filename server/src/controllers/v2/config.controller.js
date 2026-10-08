'use strict';
import Form from "../../models/form.model.js";
import Lock from "../../models/lock.model.js";
import Help from "../../models/help.model.js";
import Settings from "../../models/settings.model.js";
import path from "path";
import logger from "../../lib/logger.js";
import helpers from "../../lib/common.js";
import RestResult from "../../models/restResult.model.v2.js";
import os from "os";
import i18n from "../../lib/i18n.js";
import { auditConfigChange } from "../../lib/configAudit.js";
import EnvSettings from "../../lib/envSettings.js";
import Audit from "../../models/audit.model.js";
import { getStore, checkStore, listMounts, VAULT_STORE_NAME } from "../../secrets/providers/index.js";
import appConfig from "../../../config/app.config.js";

import { fileURLToPath } from 'url';
import { bump } from '../../lib/epochs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const findList = async function(req,res){
  try{
    var userRoles = req?.user?.user?.roles || []
    logger.info("Getting forms list for roles " + userRoles.join(","))
    var formConfig = await Form.load(userRoles)
    // filter forms based on user roles, only return the forms, only return the properties
    // icon, image, name, description, tileClass
    // remove roles and remove constants
    delete formConfig.roles
    delete formConfig.constants
    // this is sufficient for frontend to display the forms
    res.json(RestResult.single(formConfig))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormsList'), helpers.getError(err)))
  }
}
const findOne = async function(req,res){
  try{
    var userRoles = req?.user?.user?.roles || []
    var formName = req.query.name
    if(!formName){
      return res.status(400).json(RestResult.error(i18n.t(req, 'config.formNameNotProvided')))
    }
    logger.info("Getting form config for " + formName)
    var formConfig = await Form.load(userRoles,formName)
    delete formConfig.roles
    delete formConfig.categories
    res.json(RestResult.single(formConfig))

  }catch(err){
    // Form.load throws AccessDeniedError for a form the caller's roles do not grant. A
    // bare 500 told the user the server had broken, and auditMiddleware files only
    // 401/403 as 'denied' - so a refused form open was recorded as a failure. 403, never
    // 401: a 401 makes the client's global interceptor drop the session.
    if (err.name === 'AccessDeniedError') {
      return res.status(403).json(RestResult.error(helpers.getError(err)))
    }
    if (err.name === 'NotFoundError') {
      return res.status(404).json(RestResult.error(helpers.getError(err)))
    }
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormConfig'), helpers.getError(err)))
  }
}
const findAll = async function(req,res){
  try{
    var user = req?.user?.user || {}
    if(!user.roles.includes("admin") && !user.options?.showDesigner){
      return res.status(403).json(RestResult.error(i18n.t(req, 'config.onlyAdminsOrDesigners')))
    }
    var forms = await Form.load(undefined,undefined,true) // true means load all forms, not just the ones for the user
    res.json(RestResult.single(forms))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormsConfig'), helpers.getError(err)))
  }
}

const backups = function(req,res){
  try{
    var backups = Form.backups()
    res.json(RestResult.single(backups))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetBackups'), helpers.getError(err)))
  }
}
// Writes the managed env file. Values already set in the real environment are refused
// rather than written : dotenv will not overwrite them, so the save would look like it
// worked and change nothing.
const saveEnv = async function(req,res){
  try{
    const updates = req.body || {}
    const names = Object.keys(updates)
    if(names.length === 0){
      return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), i18n.t(req, 'config.noEnvVarsGiven')))
    }
    // 403 and not 401 : App.vue's axios interceptor treats any 401 as a dead session
    // and signs the user out. Refused at the endpoint, not merely greyed out in the UI.
    if(!appConfig.allowEnvEdit){
      return res.status(403).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), EnvSettings.ENV_EDIT_DISABLED_REASON))
    }
    const help = await Help.get()
    const envSection = help.filter(x => x.name=='Environment Variables')[0]
    const docs = new Map((envSection?.items || []).map(x => [x.name, x]))
    const managed = await EnvSettings.readManaged()

    // validate everything BEFORE writing anything : a partial write of a bad set would
    // leave the file describing a state nobody asked for
    for(const name of names){
      if(!docs.has(name)){
        return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), `${name} is not a known environment variable`))
      }
      if(EnvSettings.REFUSED[name]){
        return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), EnvSettings.REFUSED[name]))
      }
      if(EnvSettings.isOverridden(name, managed)){
        return res.status(409).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), `${name} is set in the environment and cannot be changed from here`))
      }
      // the client sends nothing for an unchanged secret, but never trust that : storing
      // the mask would replace a working credential with the literal placeholder
      if(String(updates[name] ?? '').trim() === MASK){
        return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), `${name} was not changed`))
      }
      const problem = EnvSettings.validate(name, updates[name], docs.get(name))
      if(problem){
        return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), problem))
      }
    }

    // PERSIST FIRST, then apply. applyLive mutates the running process - the log level,
    // the paths, VAULT_TOKEN, the db pool size, the TLS context - and writeManaged can
    // still fail after that (a read-only persistent volume, ENOSPC). Applying first meant
    // the caller got a 500 saying the save had failed while every one of those changes was
    // already in force, and stayed in force until a restart, with nothing on disk to
    // explain it. A write that fails now changes nothing at all.
    for(const name of names){
      const value = updates[name] === null || updates[name] === undefined ? '' : String(updates[name])
      if(value === ''){ managed.delete(name) } else { managed.set(name, value) }
    }
    await EnvSettings.writeManaged(managed)
    // the other nodes read the file again and apply what changed (init/cluster.js)
    bump('env')

    const restart = []
    for(const name of names){
      const value = updates[name] === null || updates[name] === undefined ? '' : String(updates[name])
      // hand the documented default over : clearing a field means "back to the default", and
      // applyLive cannot know what that is
      if(!EnvSettings.applyLive(name, value, docs.get(name)?.default)) restart.push(name)
    }

    // the NAMES only : these values include credentials
    Audit.log({
      user: req.user?.user,
      ip: req.ip,
      action: 'settings.env.update',
      outcome: 'success',
      targetType: 'env',
      target: names.slice(0, 5).join(','),
      detail: { changed: names, restartRequired: restart },
    })
    logger.notice(`Environment settings updated : ${names.join(', ')}`)
    return res.json(RestResult.single({ message: i18n.t(req, 'config.envVarsSaved'), changed: names, restartRequired: restart }))
  }catch(err){
    logger.error(helpers.getError(err))
    return res.status(500).json(RestResult.error(i18n.t(req, 'config.failedSaveEnvVars'), helpers.getError(err)))
  }
}

// Names whose VALUE must never be sent to the client. A bare 'TOKEN' would be too broad -
// ACCESS_TOKEN_EXPIRATION and ACCESS_TOKEN_ISSUER are not secrets and are worth seeing -
// so this matches a trailing _TOKEN instead, which is what VAULT_TOKEN and any future
// <service>_TOKEN look like. HTTPS_KEY is deliberately NOT matched: it is a path to a key
// file, not the key itself, and the path is useful to see.
const SECRET_ENV_NAME = /PASSWORD|SECRET|_TOKEN$/;
const MASK = "*** NOT REVEALED ***";

// Deprecated since 7 (removed in 8) : the Vault page these served is replaced by the
// secret stores page (/api/v2/secretstore/:id/check and /mounts). They now answer for the
// store named `vault`, which is what the old page configured.
//
// Connection test. Read only : token/lookup-self proves the address, token and namespace
// without touching a secret.
let vaultEndpointsWarned = false;
function warnVaultEndpoints(){
  if (vaultEndpointsWarned) return;
  vaultEndpointsWarned = true;
  logger.warning("/api/v2/config/vault/* is deprecated since 7 and removed in 8 - use /api/v2/secretstore/{id}/check and /mounts");
}

const vaultCheck = async function(req,res){
  warnVaultEndpoints()
  try{
    const info = await checkStore(await getStore(VAULT_STORE_NAME))
    Audit.log({ user: req.user?.user, ip: req.ip, action: 'vault.check', outcome: 'success', targetType: 'vault', target: info.addr })
    return res.json(RestResult.single(info))
  }catch(err){
    const message = helpers.getError(err)
    // the address is what was tested, and it is known even when the test failed - the
    // success branch records it, so leaving it off here made the failures the only vault
    // rows with no target. VAULT_ADDR is an address, not a credential (that is VAULT_TOKEN)
    Audit.log({ user: req.user?.user, ip: req.ip, action: 'vault.check', outcome: 'failure', targetType: 'vault', target: 'vault', detail: { reason: message } })
    return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedVaultCheck'), message))
  }
}

// The KV mounts the configured token can see. Read only, and deliberately quiet: the page
// falls back to a text field when this fails, so a 403 or an unreachable Vault is not an
// error worth shouting about.
const vaultMounts = async function(req,res){
  warnVaultEndpoints()
  try{
    return res.json(RestResult.list(await listMounts(await getStore(VAULT_STORE_NAME))))
  }catch(err){
    logger.debug(`Could not list vault mounts : ${helpers.getError(err)}`)
    return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedVaultMounts'), helpers.getError(err)))
  }
}

const env = async function(req,res){
  try{
    // get help
    var help = await Help.get()
    // only get the environment variables
    var envSection = help.filter(x => x.name=='Environment Variables')[0]
    if(!envSection){
      logger.error("Could not find 'Environment Variables' section in help.yaml")
      return res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetEnvVars'), i18n.t(req, 'config.envVarsNotFound')))
    }
    help = envSection.items
    const managed = await EnvSettings.readManaged()
    // cleanup a bit (hide passwords and secrets and set default values)
    var env = help.map(x => {
      var item={}
      item.name = x.name
      if(process.env[x.name]){
        item.set=true
        item.value=process.env[x.name]
      }else{
        item.set=false
        item.value=x.default
        if(item.name=='HOME_PATH'){
          item.value=os.homedir()
        }        
        if(item.value && item.value.toString().includes('PERSISTENT')){
          item.value=item.value?.replace("%PERSISTENT_FOLDER%",path.resolve(__dirname + "/../../persistent"))
        }        
      }
      item.secret = SECRET_ENV_NAME.test(x.name)
      if(item.secret){
        item.value = item.set ? MASK : null
      }
      // The documentation from help.yaml, which the settings page renders under each
      // variable. It is public by nature - help.yaml ships in the repo and is published
      // on the docs site - so only the VALUE is ever redacted, never the description.
      item.short = x.short || null
      // an optional one-line hint, written for the settings page : the full description
      // is often a paragraph shared by several variables, which reads as boilerplate
      item.hint = x.hint || null
      // editing metadata : 'refused' (never editable, with the reason), 'live' (takes
      // effect on save) or 'restart' (saved, but needs a restart). `overridden` means the
      // real environment holds this value, so writing the managed file cannot change it.
      item.editable = EnvSettings.classify(x.name)
      item.refusedReason = EnvSettings.REFUSED[x.name] || null
      item.overridden = item.editable !== 'refused' && EnvSettings.isOverridden(x.name, managed)
      // With ALLOW_ENV_EDIT=0 the store itself is not ours to write, so nothing on the
      // page is editable. Reported per variable, with a reason, rather than by hiding the
      // fields : an operator still needs to read the values in force. Applied AFTER
      // `overridden` is computed - doing it before made every row look merely refused and
      // lost the more specific "this value comes from the real environment" signal.
      if(!appConfig.allowEnvEdit){
        item.editable = 'refused'
        item.refusedReason = item.refusedReason
          || (item.overridden ? null : EnvSettings.ENV_EDIT_DISABLED_REASON)
      }
      // a restart applies a new path but does not move what is already at the old one
      item.relocates = EnvSettings.RELOCATES.has(x.name)
      item.description = x.description || null
      item.type = x.type || null
      item.allowed = x.allowed || null
      // the documented default, kept separate from item.value : for an unset variable
      // the two are the same, but for one that IS set the default is still worth showing
      item.default = x.default ?? null
      return item
    });
    res.json(RestResult.single(env))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetEnvVars'), helpers.getError(err)))
  }
}
const restore = async function(req,res){
  var lock
  var user=req.user.user
  // whether THIS request took the lock. A restore replaces the whole config, so it
  // must not run next to a designer session ; but when the caller is not already in
  // the designer the lock is ours only for the duration of the write and has to be
  // handed back - a stranded lock makes every later config write answer 423.
  var lockAcquired=false
  try{
    lock = await Lock.status(user)
    if(lock.free){
      try{
        await Lock.set(user)
        lockAcquired=true
      }catch(err){
        // fail silent : a disabled designer must not block a restore
      }
    }
  }catch(err){
    logger.error("Failed to get lock : ",err)
    return res.status(500).json(RestResult.error(i18n.t(req, 'config.failedRestoreForms'), helpers.getError(err,"Failed to get lock : ")))
  }
  if(lock.match || lock.free){
    try{
      var backupName=req.params.backupName
      var backupBeforeRestore=(req.query.backupBeforeRestore=="true")?true:false
      if(!backupName){
        return res.status(400).json(RestResult.error(i18n.t(req, 'config.failedRestoreNoName')))
      }
      var restore = await Form.restore(backupName,backupBeforeRestore)
      if(restore) {
        res.json(RestResult.single(null));
      }else{
        res.status(500).json(RestResult.error(i18n.t(req, 'config.failedRestoreBackup', { name: req.params.backupName })))
      }
    }catch(err){
      res.status(500).json(RestResult.error(i18n.t(req, 'config.failedRestoreForms'), helpers.getError(err)))
    }finally{
      // release ONLY when we took it : lock.match means the designer already held
      // it before this call and expects to keep it
      if(lockAcquired){
        try{
          await Lock.delete(user, { onlyMine: true })
        }catch(err){
          logger.error(`Failed to release the designer lock after the restore : ${helpers.getError(err)}`)
        }
      }
    }
  }else{
    res.status(423).json(RestResult.error(i18n.t(req, 'config.designerLocked'), i18n.t(req, 'config.designerLockedBy', { username: lock.lock.username })))
  }
}
const save = async function(req,res){
  var lock
  var user=req.user.user
  // Checked BEFORE the lock is taken. It used to sit after it, so an empty body
  // returned 400 having already claimed the lock and left it claimed.
  if(req.body.constructor === Object && Object.keys(req.body).length === 0){
      return res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
  }
  // whether THIS request took the lock. The designer already holds it (lock.match)
  // and expects to keep it ; any other caller - the config editor, an import - only
  // borrows it for the write and must hand it back, or every later config write
  // answers 423 and needs a manual unlock. Same rule as restore() above.
  var lockAcquired=false
  try{
    lock = await Lock.status(user)
    if(lock.free){
      try{
        await Lock.set(user)
        lockAcquired=true
      }catch(err){
        // fail silent : a disabled designer must not block a save
      }
    }
  }catch(err){
    logger.error("Failed to get lock : ",err)
    return res.status(500).json(RestResult.error(i18n.t(req, 'config.failedSaveForms'), helpers.getError(err,"Failed to get lock")))
  }
  if(lock.match || lock.free){
    const newConfig = new Form(req.body);
    try{
      // the designer writes the whole document, so the previous one has to be read
      // before the save to get a role delta out of it
      var previousConfig = await Settings.getActiveConfig().catch(() => '')
      var forms = await Form.save(newConfig)
      if(forms) {
        // read back what was actually written rather than re-serializing req.body :
        // the stored document is what the recorded hash has to describe
        var savedConfig = await Settings.getActiveConfig().catch(() => '')
        auditConfigChange({
          user,
          ip: req.ip,
          oldYaml: previousConfig,
          newYaml: savedConfig,
          source: 'designer',
        })
        res.json(RestResult.single(null));
      }else{
        res.status(500).json(RestResult.error(i18n.t(req, 'config.failedSaveForms')))
      }
    }catch(err){
      res.status(500).json(RestResult.error(i18n.t(req, 'config.failedSaveForms'), helpers.getError(err)))
    }finally{
      // release ONLY when we took it, exactly as restore() does
      if(lockAcquired){
        try{
          await Lock.delete(user, { onlyMine: true })
        }catch(err){
          logger.error(`Failed to release the designer lock after the save : ${helpers.getError(err)}`)
        }
      }
    }
  }else{
    res.status(423).json(RestResult.error(i18n.t(req, 'config.designerLocked'), i18n.t(req, 'config.designerLockedBy', { username: lock.lock.username })))
  }

}
const validate = function(req,res){
  const newConfig = new Form(req.body);
  //handles null error
  if(req.body.constructor === Object && Object.keys(req.body).length === 0){
      return res.status(400).json(RestResult.error(i18n.t(req, 'errors.requiredFields')));
  }
  try{
    // convert to object
    var formsConfig = Form.parse(newConfig)
    // validate against json schema
    formsConfig = Form.validate(formsConfig)
    if(formsConfig) {
      res.json(RestResult.single(null));
    }else{
      res.status(500).json(RestResult.error(i18n.t(req, 'config.failedValidateForms')))
    }
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedValidateForms'), helpers.getError(err)))
  }
}

const formNames = async function(req,res){
  try{
    var formConfig = await Form.load(undefined,undefined,true)
    // loadFullConfig=true keeps subforms in the list, but they can't be launched
    // standalone, so exclude them from the schedules form dropdown
    const names = [...new Set((formConfig.forms || [])
      .filter(f => f.type !== 'subform')
      .map(f => f.name)
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
    res.json(RestResult.list(names.map(n => ({ name: n }))))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormsList'), helpers.getError(err)))
  }
}

// designer-accessible config mode: whether the active config lives in the
// database. Uses the shared Settings.resolveConfigInDatabase helper (the same
// config_source/env resolution used across the models) so designers (who may
// not have settings access) can learn the mode without hitting the settings
// endpoint.
const configMode = async function(req,res){
  try{
    const settings = await Settings.findFormsYaml()
    const configInDatabase = Settings.resolveConfigInDatabase(settings)
    res.json(RestResult.single({ configInDatabase }))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormsConfig'), helpers.getError(err)))
  }
}

// Designer-accessible: is the STORED config a ytt template?
//
// The designer must know, because a save writes the ytt EXPANSION and would destroy the
// template. It could only ask GET /api/v2/settings/config, which needs settings access -
// so a designer without it got a 403, the client assumed "not templated" and the save went
// through. Same reasoning as configMode above.
//
// Only the boolean is returned, never the config text, so this grants a designer nothing
// they could not already get from the designer's own load.
const configTemplated = async function(req,res){
  try{
    const raw = await Settings.getActiveConfig()
    // the same test the settings pages and useFormsConfig use
    res.json(RestResult.single({ templated: /^\s*#@/m.test(raw || '') }))
  }catch(err){
    res.status(500).json(RestResult.error(i18n.t(req, 'config.failedGetFormsConfig'), helpers.getError(err)))
  }
}

export default {
  findList,
  findOne,
  findAll,
  backups,
  env,
  saveEnv,
  vaultCheck,
  vaultMounts,
  restore,
  save,
  validate,
  formNames,
  configMode,
  configTemplated
};
