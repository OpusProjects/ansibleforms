'use strict';
import appConfig from './../../config/app.config.js';
import logger from "../lib/logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fse from "fs-extra";
import moment from "moment";
import _ from "lodash";
import Errors from '../lib/errors.js';
import { execSync } from 'child_process';
import yaml from "yaml";
import Ajv from 'ajv';
import quote from 'shell-quote/quote.js';
import Repository from './repository.model.js';
import { resolveTargetDir, configRepoFromPath, claimAllOrRollback } from "../lib/forms-git.js";
import Helpers from "../lib/common.js";
import Settings from './settings.model.js';
import AJVErrorParser from './ajvErrorParser.model.js';


const ajv = new Ajv({allErrors: true, allowUnionTypes: true});

// Construct __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load JSON schemas synchronously
const baseSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "../../schema/base_schema.json"), "utf8"));
const formSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "../../schema/form_schema.json"), "utf8"));

// Generate formsSchema in-memory: base config wrapper + formSchema as array items.
// This validates the legacy bundled format (categories + roles + constants + forms[]).
// DEPRECATED — will be removed in v7 along with legacy forms.yaml support.
const formsSchema = (() => {
  const schema = JSON.parse(JSON.stringify(baseSchema)); // deep clone
  schema.required = [...schema.required, "forms"];
  // Use the per-form schema as-is. The per-type `oneOf` branches already
  // enforce `roles` where appropriate (ansible/awx/multistep) and forbid it
  // where it must not appear (subform). Forcing `roles` into the top-level
  // required list here would make subforms unsaveable.
  const formItems = JSON.parse(JSON.stringify(formSchema));
  schema.properties.forms = { type: "array", default: [], items: formItems };
  return schema;
})();
const jsonSchemaDraft6 = JSON.parse(fs.readFileSync(path.join(__dirname, "../../node_modules/ajv/lib/refs/json-schema-draft-06.json"), "utf8"));

const backupPath = appConfig.formsBackupPath

// New paths using config.yaml
const configFileName = path.basename(appConfig.configPath)
const formsPath = appConfig.formsFolderPath
const formsBackupPath = path.join(backupPath,'forms')
const configFileBackupPath = path.join(backupPath,configFileName)
// A snapshot is normally of the ACTIVE config, and a restore reinstates it into
// whatever source is active at that moment. The two writes that REPLACE one source
// with the other - Settings.exportConfig (database -> file) and
// Settings.importConfig (file -> database) - snapshot the source they are about to
// destroy, so such a snapshot belongs to a FIXED source and must be reinstated
// there, not into the active one : restoring an export's snapshot into the database
// would overwrite the live config with a stale disk copy, the exact opposite of
// undoing the export. The backup name therefore carries that source
// ('config.file.yaml.bak.<ts>', 'config.database.yaml.bak.<ts>'), which also keeps
// the two kinds apart in the backups list. They still end in 'yaml.bak.<ts>', so
// the backups list, the suffix parser and the retention cleanup keep working
// unchanged, and an 'active' snapshot keeps its plain historical name.
const configBackupPathForSource = function(source){
  if(source!=='file' && source!=='database') return configFileBackupPath
  const parsed = path.parse(configFileName)
  return path.join(backupPath,`${parsed.name}.${source}${parsed.ext}`)
}
// the snapshot sources that carry their name ; anything else is an 'active' snapshot
const fixedBackupSources = ['file','database']

// Legacy paths for backward compatibility
const legacyFormFilePath = path.dirname(appConfig.formsPath)
const legacyFormFileName = path.basename(appConfig.formsPath)
const legacyFormFileBackupPath = path.join(backupPath,legacyFormFileName)

const oldBackupDays = appConfig.oldBackupDays

const pathDelimiterRegex = new RegExp(`(?<!\\\\)${path.delimiter}`, 'g');

function getBackupSuffix(t){
  var backuppartre=/(\.bak\.[0-9]{17})$/g
  var backuppart=backuppartre.exec(t)[1]
  return backuppart
}
// Which source a stored snapshot was taken from, told by the artifact that exists
// for its timestamp : a 'file' / 'database' snapshot carries its source in the name,
// an older or plain one is an 'active' snapshot.
function backupConfigSource(backupName){
  const suffix = getBackupSuffix(backupName)
  for(const source of fixedBackupSources){
    if(fs.existsSync(configBackupPathForSource(source)+suffix)) return source
  }
  return 'active'
}
// Whether a config RESTORE must write into the database. The database only counts
// when it really holds a config : with an empty forms_yaml the config is served
// from disk/repository (see getBaseConfig), and writing to the database anyway
// would flip the effective source to the database as a side effect.
// Form.restore and Form.restoreBackup MUST share this one expression : the former
// refuses a restore that would only touch local folders while git serves the
// forms, and if the latter disagreed it would take its disk branch anyway and
// write into a repository working tree - leaving an uncommitted change that breaks
// the next scheduled pull, which is exactly what that guard exists to forbid.
async function resolveRestoreInDatabase(){
  const settings = await Settings.findFormsYaml()
  return Settings.resolveConfigInDatabase(settings) && !!(settings.forms_yaml && settings.forms_yaml.trim())
}
// Copy a config snapshot onto the file the config is read from : a repository copy
// wins over the local one, exactly like the designer save and
// Settings.saveActiveConfig resolve it. When that file lives in a repository
// working tree, claim its write-lock so this write can't race a concurrent
// scheduled pull/sync (issue #414).
async function restoreConfigFile(snapshot){
  const targetConfigPath = (await Repository.getConfigPath()) || appConfig.configPath
  logger.debug(`Copying config file '${snapshot}'->'${targetConfigPath}'`)
  const repoName = configRepoFromPath(targetConfigPath, appConfig.repoPath)
  const token = repoName ? await Repository.claimForWrite(repoName) : undefined
  try{
    fse.ensureDirSync(path.dirname(targetConfigPath))
    fse.copySync(snapshot,targetConfigPath)
  }finally{
    if(repoName && token !== undefined){
      await Repository.releaseWrite(repoName, token).catch(e => logger.error(`Failed to release write-lock on '${repoName}' : ${e.message}`))
    }
  }
}
ajv.addMetaSchema(jsonSchemaDraft6);
var Form=function(data){
  this.forms = data.forms;
};

/**
 * Compute ytt cli options for library data values based on provided env vars
 */
function getYttLibDataOpts() {
  var yttLibDataOpts = '';
  for (const [libName, value] of Object.entries(appConfig.yttLibData)) {
    yttLibDataOpts += ` --data-values-file @${quote([libName])}:data=${quote([value])}`;
  }
  return yttLibDataOpts;
}

/**
 * Compute extra ytt cli options based on provided env vars
 */
function getYttEnvDataOpts() {
  var yttEnvDataOpts = '';
  if (appConfig.yttVarsPrefix || false) {
    yttEnvDataOpts += ` --data-values-env ${quote([appConfig.yttVarsPrefix])}`;
  }
  if (appConfig.yttAllowSymlinkDestinations || false) {
    // path.delimiter separated list of paths (delimiter can be escaped with '\')
    for (const allowedPath of appConfig.yttAllowSymlinkDestinations.split(pathDelimiterRegex)) {
      yttEnvDataOpts += ` --allow-symlink-destination ${quote([allowedPath.replace(/\\(.)/g, '$1')])}`;
    }
  }
  if (appConfig.yttDangerousAllowAllSymlinkDestinations) {
    yttEnvDataOpts += " --dangerous-allow-all-symlink-destinations";
  }
  return yttEnvDataOpts;
}


function execYtt(file,libdir) {

  // database didn't deliver any forms, so let's load from file
  var libDataOpts = getYttLibDataOpts();
  var envDataOpts = getYttEnvDataOpts();  
  logger.info(`interpreting ${file} with ytt.`);
  logger.debug(`executing 'ytt -f ${quote([file])} -f ${quote([libdir])}${envDataOpts}${libDataOpts}'`);
  var data = execSync(
      `ytt -f ${quote([file])} -f ${quote([libdir])}${envDataOpts}${libDataOpts}`,
      {
        env: process.env,
        encoding: 'utf-8'
      } 
  );
  if (!data) {
    throw new Error(`ytt did not return any data for file ${file}`);
  }
  return data;
}

/**
 * Get the config file path with fallback to legacy forms.yaml
 * Returns object with: { path, isLegacy, deprecationMessage }
 */
async function getConfigPath() {
  // Check for repository override first (already handles config.yaml → forms.yaml fallback)
  const repoConfigPath = await Repository.getConfigPath();
  if (repoConfigPath && fs.existsSync(repoConfigPath)) {
    const isLegacy = repoConfigPath.endsWith('forms.yaml');
    const deprecationMessage = isLegacy ? "Using forms.yaml is DEPRECATED. Please migrate to config.yaml (categories, roles, constants only). Forms should be in the forms/ folder." : null;
    if (isLegacy) {
      logger.warning(deprecationMessage);
    }
    logger.info(`Using config from repository: ${repoConfigPath}`);
    return { path: repoConfigPath, isLegacy, deprecationMessage };
  }
  
  // Check for config.yaml (new way)
  if (fs.existsSync(appConfig.configPath)) {
    logger.info(`Using config file: ${appConfig.configPath}`);
    return { path: appConfig.configPath, isLegacy: false, deprecationMessage: null };
  }
  
  // Fallback to forms.yaml (legacy)
  if (fs.existsSync(appConfig.formsPath)) {
    const deprecationMessage = "Using forms.yaml is DEPRECATED. Please migrate to config.yaml (categories, roles, constants only). Forms should be in the forms/ folder.";
    logger.warning(deprecationMessage);
    return { path: appConfig.formsPath, isLegacy: true, deprecationMessage };
  }
  
  // Neither exists, will need to create from template
  return { path: appConfig.configPath, isLegacy: false, deprecationMessage: null };
}

// forms repositories are read AND write (issue #414) : the designer saves a
// form file back into the repository working tree it was loaded from. This
// resolves the write targets : the forms folders (with their repository name)
// and the config file path, mirroring where they are read from. In repository
// mode a staging folder is added : a brand new form (not yet in any repository)
// is written there and stays visible until a 'Push to repo' assigns it to a
// chosen repository.
async function getSaveTargets() {
  const repoFolders = await Repository.getFormsFolders()
  const repoMode = repoFolders.length > 0
  for (const folder of repoFolders) {
    const repoDir = path.join(appConfig.repoPath, folder.name)
    if (!fs.existsSync(path.join(repoDir, ".git"))) {
      throw new Error(`The forms repository '${folder.name}' is not cloned yet ; clone it from the repositories settings first`)
    }
  }
  // config is written where it is read from : Repository.getConfigPath() (the same
  // resolution the READ path and Settings.saveActiveConfig use) wins over the local
  // file. It must be consulted regardless of repoMode : a use_for_config repository
  // holds the config even when it is not a forms repository, and writing to the
  // local config.yaml then silently discarded every category/role edit, because the
  // repository copy kept being served. A legacy forms.yaml in a repository is
  // migrated to config.yaml next to it (and the old file removed).
  var targetConfigPath = appConfig.configPath
  var legacyConfig = null
  const repoConfigPath = await Repository.getConfigPath()
  if (repoConfigPath) {
    if (repoConfigPath.endsWith("forms.yaml")) {
      targetConfigPath = path.join(path.dirname(repoConfigPath), "config.yaml")
      legacyConfig = repoConfigPath
    } else {
      targetConfigPath = repoConfigPath
    }
  } else if (repoMode && repoFolders.length === 1) {
    // no config in any repository yet : adopt the single forms repository root
    targetConfigPath = path.join(appConfig.repoPath, repoFolders[0].name, "config.yaml")
  }
  // staging is the default target for new files in repository mode ; it is
  // listed last so an existing repository file is always matched first
  const stagingDir = { name: null, path: appConfig.formsStagingPath, staging: true }
  const formsDirs = repoMode ? [...repoFolders, stagingDir] : [{ name: null, path: formsPath }]
  // the distinct git repositories this save writes into : the forms repos plus
  // the repo that holds config.yaml (it may be a separate use_for_config repo,
  // and then there are no forms repos at all - which is why this is not gated on
  // repoMode) ; used to lock them for the duration of the write (issue #414)
  const names = new Set(repoFolders.map(f => f.name).filter(Boolean))
  const configRepo = configRepoFromPath(targetConfigPath, appConfig.repoPath)
  if (configRepo) names.add(configRepo)
  const repoNames = [...names]
  return { configPath: targetConfigPath, formsDirs, repoMode, legacyConfig, repoNames }
}

// recursively list the yaml files of a forms folder, relative to it (skipping
// the .git folder) ; used to remove forms that were deleted in the designer
function listYamlFiles(dir, base = dir) {
  var result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result = result.concat(listYamlFiles(full, base))
    } else if (/\.(yaml|yml)$/i.test(entry.name)) {
      result.push(path.relative(base, full))
    }
  }
  return result
}

function copyConfigTemplate(to) {
  try{
    logger.warning("No config found in database or config.yaml... creating empty one from template")
    var configTemplatePath = path.join(__dirname,"../../templates/config.yaml.template")
    
    // Try new template first, fallback to legacy forms.yaml.template
    if (fs.existsSync(configTemplatePath)) {
      fs.copyFileSync(configTemplatePath, to)
    } else {
      logger.warning("config.yaml.template not found, using legacy forms.yaml.template")
      var formsTemplatePath = path.join(__dirname,"../../templates/forms.yaml.template")
      fs.copyFileSync(formsTemplatePath, to)
    }
    logger.warning("Config file copied from template")
  } catch (e) {
    logger.error(`Failed to copy config from template.`,e);
    throw new Error(Helpers.getError(e,"There is no config.yaml nor could one be created from template."), { cause: e })
  }
}

function copyFormsDirectoryTemplate(toDir) {
  // declared outside the try : the catch reports the path, and a const inside the
  // try block is not in scope there (a ReferenceError would then replace the real
  // copy error with a confusing one)
  const formsDirTemplatePath = path.join(__dirname, "../../templates/forms.template");
  try {
    logger.warning("No forms directory found... creating empty one from template");
    fse.copySync(formsDirTemplatePath, toDir, { overwrite: false, errorOnExist: false });
    logger.warning("Directory copied");
  } catch (e) {
    logger.error(`Failed to copy forms directory from template '${formsDirTemplatePath}'.`, e);
    throw new Error(Helpers.getError(e, "There is no forms directory nor could there be one created from template."), { cause: e });
  }
}

async function getBaseConfig() {
  var rawdata=''
  var deprecationMessage = null;

  const settings = await Settings.findFormsYaml()
  const useDatabase = Settings.resolveConfigInDatabase(settings)

  if(useDatabase){
    if(!settings.config_source && process.env.ENABLE_FORMS_YAML_IN_DATABASE !== undefined && process.env.ENABLE_CONFIG_IN_DATABASE === undefined){
      logger.warning("ENABLE_FORMS_YAML_IN_DATABASE is deprecated. Please use ENABLE_CONFIG_IN_DATABASE instead.")
    }

    if(settings.forms_yaml && settings.forms_yaml.trim()){
      logger.info(`Using config from database`)
      rawdata = settings.forms_yaml
    }else{
      logger.warning("No config found in the database, falling back to disk file")
    }
  }

  if(!rawdata){
    // Get the config path (with legacy fallback)
    const configInfo = await getConfigPath();
    const configPath = configInfo.path;
    deprecationMessage = configInfo.deprecationMessage;
    
    // Create config.yaml from template if it doesn't exist
    if (!fs.existsSync(configPath)) {
      copyConfigTemplate(configPath);
    }
    
    // Also ensure the forms directory exists
    if (!fs.existsSync(formsPath)) {
      copyFormsDirectoryTemplate(formsPath);
    }
    // at this point we have a config file and forms directory

    if (appConfig.useYtt) {
      // try to process ytt
      try{
        const yttLibDir=path.join(path.dirname(configPath),"/lib");
        rawdata = execYtt(configPath,yttLibDir);
      } catch (e) {
        logger.error(`Failed to load '${configPath}' with ytt.`,e);
        throw new Error(Helpers.getError(e,"Error processing the config file with ytt."), { cause: e })
      }
    } else {
      // try to read the file
      try{
        logger.info(`Using config from file: ${configPath}`)      
        rawdata = fs.readFileSync(configPath, 'utf8');
      } catch (e) {
        logger.error(`Failed to load '${configPath}'.`,e);
        throw new Error(Helpers.getError(e,"Error reading the config file."), { cause: e })
      }
    }
  }

  // now let's see if it's valid yaml
  try{
    const config = yaml.parse(rawdata)
    logger.debug("Base config loaded and is valid YAML")
    return { config, deprecationMessage };
  }catch(err){
    logger.error("Error",err)
    throw new Error(Helpers.getError(err,"Error parsing the base config, it's not valid yaml."), { cause: err })
  }  
}

async function loadVarsFiles(varsFiles) {
  if (!varsFiles || !Array.isArray(varsFiles) || varsFiles.length === 0) {
    return {};
  }

  let mergedVars = {};
  // Every failure below used to be logged and dropped, so this returned {} or a partial
  // merge and the caller's catch could never fire: the form loaded 200 with vars: {},
  // $vars.* resolved to nothing, defaults and enums came back empty, and the job ran with
  // the wrong extravars - with nothing on screen saying a file was missing. Collected and
  // handed back so the caller can put them in the errors the client renders.
  const problems = [];
  
  // Get vars files path from repository or default local path
  const varsFilesPath = await Repository.getVarsFilesPath();

  for (const varsFile of varsFiles) {
    // Support both absolute and relative paths
    // Relative paths are resolved against vars files path (from repository or local)
    const absPath = path.isAbsolute(varsFile) 
      ? path.resolve(varsFile)
      : path.resolve(varsFilesPath, varsFile);
    
    const ext = path.extname(absPath).toLowerCase();
    // Validate file extension
    if (ext !== '.yml' && ext !== '.yaml') {
      logger.warning(`Skipping varsFile '${varsFile}': must end with .yml or .yaml`);
      problems.push(`'${varsFile}' was skipped: a varsFile must end with .yml or .yaml`);
      continue;
    }

    try {
      logger.debug(`Loading varsFile: ${varsFile} (resolved to ${absPath})`);

      const rawData = fs.readFileSync(absPath, 'utf8');
      const data = yaml.parse(rawData);

      // Validate that the file contains a dict/object
      if (typeof data !== 'object' || Array.isArray(data)) {
        logger.warning(`Skipping varsFile '${varsFile}': content must be a dictionary, not ${Array.isArray(data) ? 'a list' : typeof data}`);
        problems.push(`'${varsFile}' was skipped: its content must be a dictionary, not ${Array.isArray(data) ? 'a list' : typeof data}`);
        continue;
      }

      // Deep merge with existing vars
      mergedVars = _.merge(mergedVars, data);
      logger.debug(`Successfully loaded and merged varsFile: ${varsFile}`);
    } catch (err) {
      logger.error(`Failed to load varsFile '${varsFile}': ${err.message}`);
      // Continue with the other files, but REMEMBER this one - see `problems` above
      problems.push(`'${varsFile}' could not be loaded: ${err.message}`);
    }
  }

  return { vars: mergedVars, problems };
}

function getFormInfo(form,formName='',loadFullConfig=false) {
  // if we are loading full config, return the full form object
  if(loadFullConfig){
     return Form.validateForm(form); // validate the form and return
  }
  if(!formName){
    // list, only mimimal info
    return {
      icon: form.icon || undefined,
      iconSize: form.iconSize || "3x",
      iconColor: form.iconColor || undefined,
      overlayIcon: form.overlayIcon || undefined,
      overlayIconCircle: form.overlayIconCircle ?? true,
      overlayIconTransform: form.overlayIconTransform || undefined,
      overlayIconColor: form.overlayIconColor || undefined,
      overlayIconText: form.overlayIconText || undefined,
      overlayIconTextPosition: form.overlayIconTextPosition || undefined,
      overlayIconTextColor: form.overlayIconTextColor || undefined,
      image: form.image || '',
      name: form.name,
      categories: form.categories || [],
      description: form.description || '',
      tileClass: form.tileClass || '',
      order: form.order ?? Number.MAX_SAFE_INTEGER,
      // the chat assistant's allowlist and its button : read from this list (MCP list_forms,
      // the chat catalog), so they must survive the trimming to tile info
      enableForChat: form.enableForChat === true,
    };
  }
  else if(form.name == formName) {
    // validate the form and return
    return Form.validateForm(form);
  }
  // no match
  return null;
}


function getFormsFromFile(formsPath,filename){
  var rawData;
  const formPath = path.join(formsPath, filename);
  if (appConfig.useYtt) {
    try{
      // process with ytt
      const yttLibDir=path.join(path.dirname(formsPath),"/lib");
      rawData = execYtt(formPath, yttLibDir);
    } catch (e) {
      throw new Error(`Failed to load '${formPath}' and process with ytt.`,{ cause: e });

    }
  } else {
    try{
      // read the file
      rawData =fs.readFileSync(formPath,'utf8');
    } catch (e) {
      throw new Error(`Failed to load '${formPath}'.`,{ cause: e });
    }
  }

  logger.info(`merging file ${filename}`)
  try{
    const data = yaml.parse(rawData);
    var forms = [].concat(data || [])
    for(let form of forms){
      form.source = filename; // add source to the form
    }
    return forms;
  } catch (e) {
    throw new Error(`Failed to parse '${formPath}' as yaml.`,e);
  }  
}

function checkFormRole(form, userRoles) {
  if(!userRoles) {
    return true
  }
  if(userRoles.includes("admin")){
    return true
  }
  if(form.roles){
    for(var role of form.roles){
      if(userRoles.includes(role)){
        return true
      }
    }
  }
  return false
}

// load the forms config
Form.load = async function(userRoles,formName='',loadFullConfig=false,baseOnly=false) {
  logger.debug(`Loading forms with userRoles=${userRoles}, formName=${formName}, loadFullConfig=${loadFullConfig}, baseOnly=${baseOnly}`)
  var existingFormNames=[]
  var errors = []
  var warnings = []
  
  // Get the forms folders with their repository name - can be multiple from
  // repositories or a single default path. In repository mode the staging
  // folder is added (new forms not yet pushed) with no repository.
  const repoFolders = await Repository.getFormsFolders()
  const stagingPath = appConfig.formsStagingPath
  // when several forms repos exist, tag each form with the repo it came from so
  // a save writes it back there even if another repo has a same-named file
  const tagRepository = repoFolders.length > 1
  const formsdirs = repoFolders.length > 0
    ? [...repoFolders, ...(fs.existsSync(stagingPath) ? [{ name: null, path: stagingPath }] : [])]
    : [{ name: null, path: appConfig.formsFolderPath }]

  logger.debug(`Loading forms from ${formsdirs.length} folder(s): ${formsdirs.map(d => d.path).join(", ")}`)

  function warn(message) {
    logger.warning(message);
    warnings.push(message);
  }
  function error(message) {
    logger.error(message);
    errors.push(message);
  }
  // let's load the base config
  const { config: unvalidatedBase, deprecationMessage } = await getBaseConfig();
  
  // Add deprecation warning if using legacy forms.yaml
  if (deprecationMessage) {
    warn(deprecationMessage);
  }
  
  // a content-free config (an empty file, or one holding only comments) parses to
  // null, and a config that is not a yaml mapping parses to a scalar or an array :
  // reading categories/roles off that would throw a bare TypeError, so report it
  // as the config error it is
  if(!unvalidatedBase || typeof unvalidatedBase !== "object" || Array.isArray(unvalidatedBase)){
    const message = "The base config has no content. It must be a yaml mapping holding at least 'categories' and 'roles'."
    error(message)
    throw new Error(message)
  }

  // let's grab the base config and validate it, without it the app won't work
  var baseConfig = {
    categories: unvalidatedBase.categories || [],
    roles: unvalidatedBase.roles || [],
    constants: unvalidatedBase.constants || {}
  }
  // validate base config
  baseConfig = Form.validateConfig(baseConfig); // throws if not valid with the error messages
  logger.debug("Base config validated against schema")

  // just interested in the base config, no forms needed
  if(baseOnly){
    // if we only want the base config, return it now
    logger.debug("Returning base config only, no forms requested")
    return baseConfig;
  }

  baseConfig.forms = []; // initialize forms array  


  // The base config's `forms:` block is NOT schema validated - validateConfig above only
  // covers categories/roles/constants - so whatever the yaml parsed to arrives here as
  // is. Two shapes crashed the whole loader:
  //
  //   forms:            a trailing empty list item parses to null, and `delete null.source`
  //     - name: a       throws "Cannot convert undefined or null to object"
  //     -
  //
  //   forms: {a: 1}     not an array, so `.length` is undefined, the deprecation warning is
  //                     skipped, and `for...of` throws "is not iterable"
  //
  // Neither is inside a try, so the rejection escaped Form.load and every forms endpoint
  // answered 500 with a raw TypeError - measured: GET /config/formlist and the designer's
  // GET /config both 500 on a single stray list item. A malformed config must be REPORTED,
  // not fatal: the errors array is rendered to the user and the rest of the config loads.
  var unvalidatedForms = unvalidatedBase.forms || []; // get the forms from the base config, will be deprecated in the future
  if (!Array.isArray(unvalidatedForms)) {
    error(`The 'forms' section of the base config must be a list, found ${unvalidatedForms === null ? 'null' : typeof unvalidatedForms}. It is ignored.`)
    unvalidatedForms = []
  }
  // an entry that is not an object cannot be a form ; name it rather than dying on it
  const malformedBaseForms = unvalidatedForms.filter(f => !f || typeof f !== 'object')
  if (malformedBaseForms.length > 0) {
    error(`The 'forms' section of the base config has ${malformedBaseForms.length} entry/entries that are not forms (empty list items?). They are ignored.`)
    unvalidatedForms = unvalidatedForms.filter(f => f && typeof f === 'object')
  }
  if (unvalidatedForms.length > 0){
    warn("Found forms in base config file. This is DEPRECATED. Please move forms to the forms/ folder.")
  }
  // set source to base (no source)
  for(let f of unvalidatedForms){
    delete f.source // remove source from the base forms, it is not needed
  };
  
  // read extra form files from all forms directories
  // Loop through each forms directory (with its repository name)
  for(const formsdir of formsdirs){
    const formsdirpath = formsdir.path
    var files = [];
    try {
      // walk directory recursively and collect relative paths for .yml/.yaml files
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // listYamlFiles (the delete pass) skips .git ; this walk did not, so a forms
          // repository served from its root re-stated the whole object store on every
          // request for the form list
          if (entry.name === ".git") continue;
          const fullPath = path.join(dir, entry.name);
          // A SYMLINK is neither isDirectory() nor isFile() - readdirSync does not follow
          // them. That made this walk and listYamlFiles disagree, and the disagreement
          // destroyed data: a symlinked form yaml (a normal way to share one form between
          // an app and a git checkout) was invisible here - never listed, never in the
          // designer, and not even reported as a warning - while listYamlFiles matches on
          // the EXTENSION and so still saw it. On the next designer save it was therefore
          // an unknown file whose form names were not among the saved ones, and it was
          // removed. Resolve the link so both walks see the same set.
          let isDir = entry.isDirectory();
          let isFile = entry.isFile();
          if (entry.isSymbolicLink()) {
            try {
              const st = fs.statSync(fullPath); // follows the link
              isDir = st.isDirectory();
              isFile = st.isFile();
            } catch (e) {
              // a broken symlink : name it rather than dropping it silently
              warn(`Skipping '${fullPath}' : it is a symbolic link that does not resolve (${e.code || e.message})`);
              continue;
            }
          }
          if (isDir) {
            walk(fullPath);
          } else if (isFile) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.yml' || ext === '.yaml') {
              // store path relative to formsdirpath so getFormsFromFile(formsdirpath, relPath) works
              const rel = path.relative(formsdirpath, fullPath);
              files.push(rel);
            }
          }
        }
      };
      if (fs.existsSync(formsdirpath)) {
        walk(formsdirpath);
      } else {
        warn(`Failed to load forms directory '${formsdirpath}'.`);
        continue; // skip this directory
      }
    } catch (e) {
      warn(`Failed to load forms directory '${formsdirpath}'.`, e);
      continue; // skip this directory
    }

    if (files && files.length) {
      logger.debug(`Found ${files.length} form file(s) in '${formsdirpath}'`)
      // sort for deterministic order
      files.sort();
      // read files
      for (const item of files) {
        // read the file and add to the forms array
        logger.debug(`Loading forms from file ${item} in ${formsdirpath}`);
        try{
          const fileForms = getFormsFromFile(formsdirpath,item) // get the forms from the file, including subpaths
          // tag with the originating repository so a save writes it back there
          // (disambiguates same-named files across repos) ; only when needed
          if (tagRepository && formsdir.name) {
            for (const ff of fileForms) ff.repository = formsdir.name
          }
          unvalidatedForms = unvalidatedForms.concat(fileForms);
        }
        catch (e) {
          error(e.message);
        }
      };
    }
  }
  
  // Process all collected forms
  for (const f of unvalidatedForms) {
      var form = null; // initialize form
      if(!f?.name){
        error(`Form found with no name.`)
        continue // skip this form, but keep loading the rest
      }
      if(formName && f.name != formName){
        logger.debug(`Skipping form ${f.name}, not requested.`)
        continue // skip this form if it is not the one we are looking for
      }
      // subform type forms are not standalone forms; they are only consumed
      // by "list" / "yaml" fields through the dedicated subform endpoint.
      // Hide them from the runtime form list (tiles) and from regular form
      // lookups, but keep them visible to the designer (loadFullConfig=true)
      // so they can be edited natively alongside their parent forms.
      if(!formName && !loadFullConfig && f.type === "subform"){
        logger.debug(`Skipping subform ${f.name} from form list.`)
        continue
      }
      if(existingFormNames.includes(f.name)){
        warn(`skipping duplicate form ${f.name}`)
        continue
      }
      // The name is claimed BEFORE the role check, so a name resolves to exactly one
      // definition - the first in walk order - on every path.
      //
      // It used to be claimed after, which made the two ways through this loop disagree.
      // With two files defining `Deploy`, the first restricted to `ops` and the second to
      // `public`, a public user got: the LIST path skipped copy 1 without registering the
      // name, so copy 2 passed the duplicate check and the tile appeared; the SINGLE-form
      // path hit copy 1 first and threw AccessDenied, so copy 2 was never reached. The
      // form was listed and then failed to open. Claiming the name first makes both paths
      // answer "denied", and the designer edits the same copy the loader resolves.
      existingFormNames.push(f.name) // collect all form names
      if(!checkFormRole(f,userRoles)){
        logger.debug(`User has no access to form ${f.name}.`)
        if(formName) { // if we are looking for a specific form, and no access, throw an error
          throw new Errors.AccessDeniedError(`Access denied to form ${f.name}.`); 
        } 
        continue // skip this form if user has no access to it
      }
      
      logger.debug(`adding form ${f.name}`)
      try{
        form = getFormInfo(f,formName,loadFullConfig); // retreive only the necessary form info
      } catch (e) {
        // convert e to proper string
        error(`Failed to validate form '${f.name}'.\r\n${e.message}`);
      }  
      if(form){
        // Load varsFiles if this is a single form request and varsFiles is defined
        if(formName && form.varsFiles){
          logger.debug(`Loading varsFiles for form ${f.name}`);
          try {
            const loaded = await loadVarsFiles(form.varsFiles);
            form.vars = loaded.vars;
            // A varsFile that could not be read is not a detail: the form still renders,
            // but $vars.* is empty and the job runs with the wrong extravars. Say so.
            for (const p of loaded.problems) {
              error(`Form '${f.name}': ${p}`);
            }
          } catch (e) {
            error(`Failed to load varsFiles for form '${f.name}'.\r\n${e.message}`);
          }
        }
        // When loading a single form, inline every subform referenced by a
        // "list" field (recursively) so the client has a self-contained
        // definition and no extra API calls are required. Authorization is
        // implicit: we already validated the caller has access to this form,
        // and subforms can only be reached through that form's field tree.
        if(formName){
          form.subforms = collectSubformsForForm(form, unvalidatedForms, errors)
        }
        baseConfig.forms.push(form);   // merge the form into the base forms
        // if we are loading full config, we can return the form right away
        if(formName){
          baseConfig.errors = errors; // add errors to the base config
          baseConfig.warnings = warnings; // add warnings to the base config
          return baseConfig // exit early if we found the form we are looking for
        }                
      }
    }

  baseConfig.errors = errors; // add errors to the base config
  baseConfig.warnings = warnings; // add warnings to the base config
  return baseConfig; // return the base config with the forms
};

// Walk a field tree and collect every subform name referenced by a "list"
// field. Recurses into subform definitions as well so we pick up nested
// lists. `visited` guards against cycles (A -> B -> A).
function collectSubformNames(fields, unvalidated, collected, visited){
  if(!Array.isArray(fields)) return
  for(const field of fields){
    if((field?.type === "list" || field?.type === "yaml") && field?.subform){
      const name = field.subform
      if(!visited.has(name)){
        visited.add(name)
        collected.add(name)
        const sub = unvalidated.find(f => f.name === name && f.type === "subform")
        if(sub){
          collectSubformNames(sub.fields, unvalidated, collected, visited)
        }
      }
    }
    // multistep forms nest fields under step objects
    if(Array.isArray(field?.fields)){
      collectSubformNames(field.fields, unvalidated, collected, visited)
    }
  }
}

// Given a validated parent form, return the array of validated subform
// definitions referenced by its list fields (recursively). Missing subforms
// produce an error entry but do not throw, so the form itself can still be
// rendered (the client will show a placeholder).
function collectSubformsForForm(parentForm, unvalidated, errors){
  const names = new Set()
  const visited = new Set()
  collectSubformNames(parentForm.fields, unvalidated, names, visited)
  // wizard steps reference subforms by name too
  if(Array.isArray(parentForm.wizard)){
    for(const step of parentForm.wizard){
      if(step?.subform && !visited.has(step.subform)){
        visited.add(step.subform)
        names.add(step.subform)
        const sub = unvalidated.find(f => f.name === step.subform && f.type === "subform")
        if(sub){
          collectSubformNames(sub.fields, unvalidated, names, visited)
        }
      }
    }
  }
  const result = []
  for(const name of names){
    const raw = unvalidated.find(f => f.name === name && f.type === "subform")
    if(!raw){
      errors.push(`Subform '${name}' referenced by form '${parentForm.name}' was not found.`)
      continue
    }
    try{
      result.push(Form.validateForm(raw))
    } catch (e) {
      errors.push(`Failed to validate subform '${name}'.\r\n${e.message}`)
    }
  }
  return result
}

// load the forms config
Form.backups = function() {
  logger.info(`Loading backups`)
  var files
  var backups=[]
  try{
    files = fs.readdirSync(backupPath)
    if(files){
      // filter only backups
      files=files.filter((item)=>item.match(/y[a]{0,1}ml\.bak\.[0-9]{17}$/g))
      // parse the backup data
      backups=files.map(file => {
        var item=file.substring(file.length-17)
        // snapshots taken before the timestamp fix were written with 'kk' (1-24), so
        // a backup made at midnight carries hour '24' on its own date. Moment refuses
        // to parse that ('Invalid date' in the list, and a broken sort), so read it
        // back as hour 00 of the same day - which is the moment it was really taken
        var hour=item.slice(8,10)==='24' ? '00' : item.slice(8,10)
        var dt=moment(item.slice(0,8)+"T"+hour+item.slice(10,14)+","+item.slice(14))
        return {'file':file,'date':dt.format("YYYY-MM-DD HH:mm:ss")}
      }).sort((a, b) => a.date < b.date && 1 || -1);
    }
  }catch(e){
    logger.warning("Failed to load backups. "+e)
  }
  return backups
};
/**
 * Reject duplicate role names.
 *
 * ajv has no "unique by property", and this is a privilege escalation rather than a typo:
 * getRolesAndOptions applies EVERY matching entry, so a second `- name: admin` grants
 * admin to that entry's groups too - while the roles editor, the designer and the audit
 * delta all key roles by name and only ever show one of them.
 *
 * Shared by validateConfig AND validate. It used to live inline in validateConfig only,
 * under a comment claiming every write path was covered - but Form.save (the DESIGNER
 * path, and POST /api/v2/config/check) goes through Form.validate, which had no such
 * check. So the designer happily saved a config that the next Form.load then refused,
 * 500ing every config endpoint and - until the user.model fix - hanging every login.
 */
function assertNoDuplicateRoles(obj){
  const seen = new Set()
  const duplicates = new Set()
  for(const role of (Array.isArray(obj?.roles) ? obj.roles : [])){
    const name = typeof role?.name === 'string' ? role.name.trim() : null
    if(name === null) continue
    if(seen.has(name)) duplicates.add(name)
    seen.add(name)
  }
  if(duplicates.size > 0){
    const message = `Duplicate role name(s) : ${[...duplicates].join(", ")}. Each role must appear once.`
    logger.error(message)
    throw new Error(message)
  }
}

Form.validateConfig = function(obj){
  if(obj){
    logger.debug("validating base against schema")
    const validate = ajv.compile(baseSchema)
    const valid = validate(obj)

    if (!valid){
      var ajvMessages = AJVErrorParser.parseErrors(validate.errors)
      ajvMessages=ajvMessages.map(x => {
        try{
          var tmp=`${x}`
          var category
          var role
          category = Helpers.friendlyAJVError(tmp,"categories","Category",obj.categories)
          if(category.changed){
            return category.value
          }
          role = Helpers.friendlyAJVError(tmp,"roles","Role",obj.roles)
          if(role.changed){
            return role.value
          }        
        }catch(e){
          logger.error(e)
          return x
        }     
        return tmp
      })
      logger.error(ajvMessages)
      throw new Error(`${ajvMessages.join("\r\n")}`)
    }else{
      // JSON Schema cannot express "unique by property", so duplicate role names get
      // past ajv - and they are a privilege escalation, not a cosmetic problem :
      // getRolesAndOptions iterates EVERY entry (user.model.js), so a second
      // `- name: admin` with different groups grants admin to those groups, while the
      // roles editor and the audit delta both key roles by name and only ever see one
      // of the two. Reject it here so every write path is covered (designer, config
      // editor, import, and a hand-edited file).
      assertNoDuplicateRoles(obj)
      logger.debug("Valid base")
      return obj
    }

  }
}
Form.validateForm = function(obj){
  if(obj){

    logger.debug("validating form against schema")
    const validate = ajv.compile(formSchema)
    const valid = validate(obj)
    if (!valid){
      var ajvMessages = AJVErrorParser.parseErrors(validate.errors)
      ajvMessages=ajvMessages.map(x => {
        try{
          var tmp=`${x}`
          var field
          var tableField
          field = Helpers.friendlyAJVError(tmp,"fields","Field",obj.fields)
          if(field.changed){
            tmp = field.value
            if(obj.fields[field.index].tableFields){
              tableField = Helpers.friendlyAJVError(tmp,"tableFields","TableField",obj.fields[field.index].tableFields)
              if(tableField.changed){
                return tableField.value
              }    
            }
          }
        }catch(e){
          logger.error(e)
          return x
        }     
        return tmp
      })
      logger.error(ajvMessages)
      throw new Error(`${ajvMessages.join("\r\n")}`)
    }else{
      logger.debug("Validated")
      return obj
    }
  }
}
Form.validate = function(forms){
  if(forms){
    logger.debug("validating forms.yaml against schema")
    // the designer saves through here ; see assertNoDuplicateRoles
    assertNoDuplicateRoles(forms)
    const validate = ajv.compile(formsSchema)
    const valid = validate(forms)
    if (!valid){
      var ajvMessages = AJVErrorParser.parseErrors(validate.errors)
      ajvMessages=ajvMessages.map(x => {
        try{
          var tmp=`${x}`
          var form
          var field
          var tableField
          var category
          var role
          category = Helpers.friendlyAJVError(tmp,"categories","Category",forms.categories)
          if(category.changed){
            return category.value
          }
          role = Helpers.friendlyAJVError(tmp,"roles","Role",forms.roles)
          if(role.changed){
            return role.value
          }        
          form = Helpers.friendlyAJVError(tmp,"forms","Form",forms.forms)
          if(form.changed){
            tmp = form.value
            field = Helpers.friendlyAJVError(tmp,"fields","Field",forms.forms[form.index].fields)
            if(field.changed){
              tmp = field.value
              if(forms.forms[form.index].fields[field.index].tableFields){
                tableField = Helpers.friendlyAJVError(tmp,"tableFields","TableField",forms.forms[form.index].fields[field.index].tableFields)
                if(tableField.changed){
                  return tableField.value
                }    
              }
            }
          }   
        }catch(e){
          logger.error(e)
          return x
        }     

        return tmp

      })
      logger.error(ajvMessages)
      throw new Error(`${ajvMessages.join("\r\n")}`)
    }else{
      logger.debug("Valid forms.yaml")
      return forms
    }
  }
}
Form.parse = function(data){
  var formsConfig
  try{
    logger.info("Parsing yaml data")
    formsConfig = yaml.parse(data.forms,{prettyErrors:true})
  }catch(err){
    logger.error("Error : ", err)
    throw new Error(Helpers.getError(err,"Failed to parse yaml"), { cause: err })
  }
  return formsConfig
}
Form.removeOld=function(days=60){
  // 0 KEEPS EVERYTHING, like every other retention setting in this product.
  //
  // `old > days` with days=0 deleted every restore point more than a day old - so the one
  // value an operator would reach for to mean "never prune" was the most destructive one
  // available, and it applies to the snapshots taken before each config-replacing write,
  // which are the only way back from a bad import.
  //
  // The Status page already asserted the opposite in as many words: it prints
  // 'restore points never' for 0 with the note "0 deletes nothing, for every one of
  // these". That page's whole premise is that it never claims a fact it has not
  // established, so the code is what was wrong here, not the note.
  //
  // A non-numeric value already behaved this way by accident (`old > NaN` is false);
  // it is explicit now rather than incidental.
  const keep = parseInt(days, 10)
  if(!(keep >= 1)){
    logger.debug("Config restore point retention is disabled (OLD_BACKUP_DAYS), keeping all snapshots")
    return
  }
  days = keep
  var items = fs.readdirSync(backupPath)
  if(items && items.length){
    // filter only backup yamls
    items=items.filter((item)=>item.match(/\.bak\.[0-9]{17}$/g))
    // read files
    items.forEach((item) => {
      var dt=item.substring(item.length-17) // get time part
      var iso=moment(dt.slice(0,8)) // get date part
      var old=moment().diff(moment(iso),"days") // how old ?
      if(old>days){ // date is older than x days ?
        logger.debug("Removing old backup item")
        fse.removeSync(path.join(backupPath,item)) // remove backup
      }else{
        //logger.debug(`Keeping ${file} [${old} days]`)
      }
    });
  }
}
// configOnly : snapshot only the base config (repo mode keeps forms in git, so
// the forms directories are never snapshotted ; only the DB/disk config is).
// source : 'active' snapshots the config that is really being served (database,
// repository or local file) ; 'file' snapshots the on-disk config file and
// 'database' the database copy, even when that is not the active source - see
// below. A 'file' / 'database' snapshot is named after its source
// (configBackupPathForSource) so the restore reinstates it there.
Form.backup = async function(configOnly=false,source='active'){
  logger.info(configOnly ? "Making backup of config" : "Making backup of config and forms")
  const sourceFormsPath = formsPath
  // 'HH' (00-23), not 'kk' (1-24) : with 'kk' a backup taken at midnight was named
  // hour '24', which moment can no longer reparse (see Form.backups)
  var timestamp=moment().format("YYYYMMDDHHmmssSSS")
  var backupformsdir=formsBackupPath +".bak."+timestamp
  var backupconfigfile=configBackupPathForSource(source) +".bak."+timestamp
  var backuplegacyformsfile=legacyFormFileBackupPath +".bak."+timestamp
  var backupfile=path.parse(backupconfigfile).base
  Form.removeOld(oldBackupDays)

  // Back up the ACTIVE base config, whatever serves it : the database (when
  // config_source or the env default says so and forms_yaml is not empty), a
  // repository working tree, or the local config.yaml - Settings.getActiveConfig
  // resolves exactly that, the same way the designer save does. Snapshotting
  // appConfig.configPath instead would write nothing at all in repository mode
  // (that file is then stale or absent), while still reporting a backup name.
  var activeConfig
  const sourceLabel = source==='file' ? 'config file' : (source==='database' ? 'database config' : 'active config')
  if(source==='file'){
    // source 'file' : snapshot the on-disk config file itself, for a write that
    // REPLACES that file with the database copy (Settings.exportConfig). There the
    // active config is the database, so an 'active' snapshot would only preserve
    // what is being written and the disk contents would be lost. The path is
    // resolved exactly like the one that write targets, and Form.restoreBackup
    // reinstates the snapshot onto that same file.
    const diskConfigPath = (await Repository.getConfigPath()) || appConfig.configPath
    logger.debug(`Backing up the config file '${diskConfigPath}'`)
    activeConfig = fs.existsSync(diskConfigPath) ? fs.readFileSync(diskConfigPath,'utf8') : ''
  }else if(source==='database'){
    // source 'database' : snapshot the database copy itself, for a write that
    // REPLACES it with the config file (Settings.importConfig). In file mode the
    // ACTIVE config IS that file, so an 'active' snapshot would preserve the very
    // content being imported and lose the database copy unrecoverably.
    logger.debug("Backing up the database config")
    const dbSettings = await Settings.findFormsYaml()
    activeConfig = dbSettings.forms_yaml || ''
  }else{
    activeConfig = await Settings.getActiveConfig()
  }
  var configBackedUp = false
  // an empty (or whitespace-only) source is not a restore point : a fresh install
  // with no config yet must not leave a bogus empty snapshot behind
  if(activeConfig && activeConfig.trim()){
    logger.debug(`Snapshotting the ${sourceLabel} -> '${backupconfigfile}'`)
    fse.ensureDirSync(path.dirname(backupconfigfile))
    fs.writeFileSync(backupconfigfile, activeConfig)
    configBackedUp = true
  }else{
    logger.warning(`There is no ${sourceLabel} to back up`)
  }

  // in config-only mode (repo mode + DB config) the forms live in git : only the
  // base config is snapshotted, the forms directory/legacy file are left to git
  if(!configOnly){
    // Back up forms.yaml (legacy - for backward compatibility)
    if(fs.existsSync(appConfig.formsPath)){
      logger.debug(`Copying legacy forms file '${appConfig.formsPath}'->'${backuplegacyformsfile}'`)
      fse.copySync(appConfig.formsPath,backuplegacyformsfile)
    }

    // Back up forms directory
    if(fs.existsSync(sourceFormsPath)){
      logger.debug(`Copying forms directory '${sourceFormsPath}'->'${backupformsdir}'`)
      fse.removeSync(backupformsdir) // just in case, remove it (unlikely hit)
      fse.ensureDirSync(backupformsdir) // make backupdir
      fse.copySync(sourceFormsPath,backupformsdir) // make backup
    }
  }
  // the returned name IS the config backup file name : it is what the backup list
  // shows and what Form.restore uses as its rollback point. Never report one for a
  // file that was not written, or a failed restore would silently not be undone.
  if(!configBackedUp){
    logger.warning("No config snapshot was written, so no backup is reported")
    // the forms artifacts above were already written under a timestamp nobody is
    // ever handed : Form.restore sees no rollback point and never calls Form.remove
    // for it, so they would linger for the whole retention period and the legacy
    // 'forms.yaml.bak.<ts>' would even show up in Form.backups as a phantom entry.
    // Named exactly like Form.remove names them, so nothing can be left behind
    for(const orphan of [backuplegacyformsfile,backupformsdir]){
      if(fs.existsSync(orphan)){
        logger.debug(`Removing orphaned forms backup '${orphan}'`)
        fse.removeSync(orphan)
      }
    }
    return null
  }
  return backupfile
}
// remove unique backupname with forms folder
Form.remove = function(backupName){
  logger.debug(`Removing old backup '${backupName}'`)
  var backupformsdir=formsBackupPath+getBackupSuffix(backupName)
  var backuplegacyformsfile=legacyFormFileBackupPath+getBackupSuffix(backupName)

  // Remove the config.yaml backup, whichever source it was taken from (a timestamp
  // only ever carries one of them, see configBackupPathForSource ; all are tried so
  // no orphan can be left behind)
  for(const source of ['active',...fixedBackupSources]){
    const backupconfigfile=configBackupPathForSource(source)+getBackupSuffix(backupName)
    if(fs.existsSync(backupconfigfile)){
      logger.debug(`Removing config file '${backupconfigfile}'`)
      fse.removeSync(backupconfigfile)
    }
  }

  // Remove legacy forms.yaml backup
  if(fs.existsSync(backuplegacyformsfile)){
    logger.debug(`Removing legacy forms file '${backuplegacyformsfile}'`)
    fse.removeSync(backuplegacyformsfile)
  }
  
  // Remove forms directory backup
  if(fs.existsSync(backupformsdir)){
    logger.debug(`Removing forms directory '${backupformsdir}'`)
    fse.removeSync(backupformsdir)
  }
}
Form.restoreBackup = async function(backupName,configOnly=false){
  const targetFormsPath = formsPath
  const suffix = getBackupSuffix(backupName)
  var backupformsdir=formsBackupPath+suffix
  var backuplegacyformsfile=legacyFormFileBackupPath+suffix
  // a snapshot taken from a FIXED source lives under its own name and goes back to
  // that source ; only a plain 'active' snapshot follows whatever is serving the
  // config at restore time
  const configSource = backupConfigSource(backupName)
  var backupconfigfile=configBackupPathForSource(configSource)+suffix

  // Restore config.yaml
  if(fs.existsSync(backupconfigfile)){
    const toDatabase = configSource==='database' || (configSource==='active' && await resolveRestoreInDatabase())
    if(toDatabase){
      // the base config lives in the database : reinstate the snapshot into the
      // settings row (writing only to disk would leave the DB config untouched). A
      // 'database' snapshot (Settings.importConfig) goes here even when a file is
      // what currently serves the config.
      logger.debug(`Restoring database config from '${backupconfigfile}'`)
      await Settings.update({ forms_yaml: fs.readFileSync(backupconfigfile,'utf8') })
    }else{
      // a 'file' snapshot (Settings.exportConfig) goes back onto the config file,
      // which is what undoing that export means - reinstating it into the database
      // would replace the live config with a stale disk copy instead
      await restoreConfigFile(backupconfigfile)
    }
  }

  // in config-only mode (repo mode + DB config) the served forms come from git :
  // only the base config is reinstated, no forms directory/legacy file is touched
  if(!configOnly){
    // Restore legacy forms.yaml (if it exists in backup)
    if(fs.existsSync(backuplegacyformsfile)){
      logger.debug(`Copying legacy forms file '${backuplegacyformsfile}'->'${appConfig.formsPath}'`)
      fse.copySync(backuplegacyformsfile,appConfig.formsPath)
    }

    // Restore forms directory
    if(fs.existsSync(backupformsdir)){
      logger.debug(`Copying forms directory '${backupformsdir}'->'${targetFormsPath}'`)
      fse.removeSync(targetFormsPath) // just in case, remove it (unlikely hit)
      fse.ensureDirSync(targetFormsPath) // make backupdir
      fse.copySync(backupformsdir,targetFormsPath) // make backup
    }
  }
}
Form.save = async function(data){
  var formsConfig = Form.parse(data)
  formsConfig = Form.validate(formsConfig)
  const { configPath: targetConfigPath, formsDirs, repoMode, legacyConfig, repoNames } = await getSaveTargets()
  logger.info(`Saving forms to ${formsDirs.map(d => d.path).join(", ")}`)
  var groups={}  // key "<repository>\0<source>" -> { repository, source, forms:[] }

  // filter source-forms out of forms and group them by their physical file :
  // (repository, source). The repository field (set on load when several forms
  // repos exist) keeps a form in its own repo even when another repo holds a
  // file of the same name ; it is internal and stripped before writing.
  formsConfig.forms = formsConfig.forms.filter(item => {
    var src = item.source
    if(src){
      const repo = item.repository ?? null
      const key = (repo ?? '') + '\0' + src
      if(!groups[key]) groups[key] = { repository: repo, source: src, forms: [] }
      groups[key].forms.push(item)
      return false
    }else{
      return true
    }
  })

  // a form 'source' is client-controlled ; reject any that would escape its
  // forms folder (path traversal / absolute path) before it is used as a path
  for (const g of Object.values(groups)) {
    const probe = path.resolve(formsPath, g.source)
    if (g.source.includes("\0") || path.isAbsolute(g.source) || !probe.startsWith(path.resolve(formsPath) + path.sep)) {
      throw new Error(`Invalid form source '${g.source}' : must be a path inside the forms folder`)
    }
  }

  // resolve the target folder per group (own repo, then existing holder, then staging)
  for (const g of Object.values(groups)) {
    g.dir = resolveTargetDir(g.repository, g.source, formsDirs, (d, src) => fs.existsSync(path.join(d.path, src)))
  }

  // repository and source are internal placement fields : never write them to a form file or config
  // source is re-stamped from the filename on load ; repository pins a form to its repo
  for (const g of Object.values(groups)) for (const f of g.forms) { delete f.repository; delete f.source; }
  formsConfig.forms.forEach(f => { delete f.repository; delete f.source; })

  // determine write target before locking to avoid querying settings inside the lock
  const configSettings = await Settings.findFormsYaml()
  const useDatabase = Settings.resolveConfigInDatabase(configSettings)

  // lock the working trees for the duration of the write so a concurrent
  // pull/sync/clone/reset can't run git on the same files (issue #414). All-or-
  // nothing : a failed claim rolls back the ones already taken and throws a
  // 'busy, try again' error before anything is written.
  const held = await claimAllOrRollback(repoNames,
    name => Repository.claimForWrite(name),
    (name, token) => Repository.releaseWrite(name, token))

  // declared once for both branches below : two `var backupfile` in the same
  // function scope is the same variable, so only the branch that runs assigns it
  let backupfile
  try {
    if (!repoMode) {
      // local mode : snapshot before overwriting (in repo mode the git history is the backup)
      backupfile=await Form.backup()
      logger.debug(backupfile ? `Succesfull backup to ${backupfile}` : "No backup was made, there is no config yet")
    } else if (useDatabase) {
      // repo mode, but the base config lives in the database : git covers the
      // forms, yet the DB config has no git history, so snapshot it (config only)
      // before overwriting so a bad config save can still be rolled back
      backupfile=await Form.backup(true)
      logger.debug(backupfile ? `Succesfull config backup to ${backupfile}` : "No config backup was made, there is no config yet")
    }

    // every form name the save is writing, across ALL folders - a file is only a deletion
    // candidate when none of the names it defines survive anywhere
    const savedFormNames = new Set(
      Object.values(groups).flatMap(g => (g.forms || []).map(f => f?.name)).filter(Boolean)
    )
    for (const dirEntry of formsDirs) {
      const dirGroups = Object.values(groups).filter(g => g.dir === dirEntry)
      const dirFiles = dirGroups.map(g => g.source)
      // write the surviving form files FIRST, then delete the leftovers : a crash
      // mid-write then leaves the old files intact (no hole) rather than a folder
      // that was emptied before the replacements were written.
      for (const g of dirGroups) {
        const target = path.join(dirEntry.path, g.source)
        const forms = g.forms
        logger.debug(`saving ${forms.length==1 ? `single form '${forms[0].name}'` : `forms ${forms.map(x => x.name)}`} to '${target}'`)
        // ensure parent directory exists for nested paths
        fse.ensureDirSync(path.dirname(target));
        fs.writeFileSync(target, yaml.stringify(forms.length==1 ? forms[0] : forms));
      }
      // a dedicated forms folder is fully managed : the yaml files of deleted
      // forms are removed ; a repository ROOT serving forms can hold unrelated
      // yaml files, there nothing is ever deleted. The staging folder is always
      // fully managed.
      // dirEntry.dedicated, NOT the basename : a repository named 'forms' has a ROOT path
      // ending in /forms, which the old test could not tell from a dedicated subfolder.
      const managed = !repoMode || dirEntry.staging || dirEntry.dedicated === true
      if (managed && fs.existsSync(dirEntry.path)) {
        for (const existing of listYamlFiles(dirEntry.path)) {
          if (!dirFiles.includes(existing)) {
            // "absent from the payload" is NOT the same as "the user deleted it".
            // Form.load silently drops a file it cannot parse, a form failing validation,
            // and a form whose name duplicates one already loaded - and the designer never
            // sees any of them, so they were never in the payload to begin with. Deleting
            // on absence alone therefore removed working files nobody touched: two forms
            // repositories both defining a form called 'Deploy' lost the second one's file
            // on the next save, and in repo mode Form.save takes no snapshot first.
            //
            // So only delete a file we can read AND whose form names have all genuinely
            // gone from the config. Anything unreadable, or still naming a form that
            // survived, is left alone and reported.
            const fullPath = path.join(dirEntry.path, existing)
            let definedNames = null
            try {
              const parsed = yaml.parse(fs.readFileSync(fullPath, "utf8"))
              const list = Array.isArray(parsed) ? parsed : [parsed]
              definedNames = list.map(f => f?.name).filter(Boolean)
            } catch (e) {
              definedNames = null   // unparseable
            }
            if (definedNames === null) {
              logger.warning(`Not removing '${existing}' from '${dirEntry.path}' : it could not be parsed, so it was never loaded and cannot have been deleted here`)
              continue
            }
            const stillDefined = definedNames.filter(n => savedFormNames.has(n))
            if (stillDefined.length > 0) {
              logger.warning(`Not removing '${existing}' from '${dirEntry.path}' : it defines ${stillDefined.join(", ")}, which the configuration still has - most likely a duplicate form name that the loader skipped`)
              continue
            }
            logger.debug(`Removing deleted form file '${existing}' from '${dirEntry.path}'`)
            fse.removeSync(fullPath)
          }
        }
      }
    }

    const configYaml = yaml.stringify(formsConfig)

    if (useDatabase) {
      logger.debug("Writing base config to database")
      await Settings.update({ forms_yaml: configYaml })
    } else {
      logger.debug(`Writing base file '${targetConfigPath}'`)
      fse.ensureDirSync(path.dirname(targetConfigPath));
      fs.writeFileSync(targetConfigPath, configYaml);
      if (legacyConfig && legacyConfig !== targetConfigPath && fs.existsSync(legacyConfig)) {
        logger.debug(`Removing migrated legacy config '${legacyConfig}'`)
        fse.removeSync(legacyConfig)
      }
    }
  }
  catch(err) {
    // handle error
    logger.error("Failed to save forms : ",err)
    throw new Error(Helpers.getError(err,"Failed to save forms"), { cause: err })
  }
  finally {
    // release the working-tree locks, restoring each repo's prior status (the
    // save is not a git op, so its status must reflect the last pull/sync)
    for (const h of held) {
      await Repository.releaseWrite(h.name, h.token).catch(e => logger.error(`Failed to release write-lock on '${h.name}' : ${e.message}`))
    }
  }

  return true
}
Form.restore = async function(backupName,backupBeforeRestore){
  logger.info(`Restoring backup '${backupName}'`)
  var tmpbackup
  const { repoMode } = await getSaveTargets()
  // the SAME expression Form.restoreBackup routes on : with a different one this
  // guard could pass while the restore below still took the disk branch and wrote
  // config.yaml into a repository working tree (issue : config_source='database'
  // with a forms_yaml that is still empty, e.g. right after switching source)
  const useDatabase = await resolveRestoreInDatabase()
  if (repoMode && !useDatabase) {
    // forms live in git repositories and no config is in the database : the
    // snapshots only cover the local folders, restoring them would not affect
    // the served forms
    throw new Error("Forms are managed in git repositories ; restore a previous state from the git history instead")
  }
  // in repo mode only the DB base config is restorable ; the forms stay in git
  const configOnly = repoMode
  try {
    // first backup current (config only in repo mode : no repo working tree is touched)
    // ; a null means nothing was snapshotted, so there is no rollback point either.
    // Snapshot the same source the restore is about to write : undoing a failed
    // restore of a 'file' / 'database' snapshot must reinstate that source, not
    // whatever happens to be the active one.
    tmpbackup=await Form.backup(configOnly,backupConfigSource(backupName))
    if(!tmpbackup){
      logger.warning("Could not snapshot the current config before restoring ; this restore can not be undone")
    }
    await Form.restoreBackup(backupName,configOnly)
    if(!backupBeforeRestore && tmpbackup)
      Form.remove(tmpbackup)
    return true
  }catch(e){
    logger.error(`Failed to restore '${backupName}'.` + e)
    if(tmpbackup){
      try{
        await Form.restoreBackup(tmpbackup,configOnly)
      }catch(err){
        logger.error(`Failed to undo failed restore '${tmpbackup}' !!`)
      }
    }
    return false
  }
}
// Form.loadByName = async function(form,user,forApproval=false){
//   var forms = await Form.load()
//   var formObj = forms?.forms.filter(x => x.name==form)
//   if(formObj.length>0){
//     if(forApproval){
//       return formObj[0]
//     }
//     logger.debug(`Form ${form} is found, checking access...`)
//     var access = formObj[0].roles.filter(role => user?.roles?.includes(role))
//     if(access.length>0 || user?.roles?.includes("admin")){
//       return formObj[0]
//       //logger.debug(`Form ${form}, access allowed...`)
//     }else {
//       logger.warning(`Form ${form}, no access...`)
//       return null
//     }
//   }else{
//     return null
//   }

// }
// create the backup path and 
// since version 4.0.3 the backups go under folder => move backups there (should be only once)
Form.initBackupFolder=function(){
  logger.info("Moving older form backups to new backup folder")
  try{
    fs.mkdirSync(backupPath, { recursive: true })
    // move old forms.bak.files
    var files = fs.readdirSync(legacyFormFilePath)
    if(files){
      // filter only backup-files and folders
      files=files.filter((item)=>item.match(/\.bak\.[0-9]*$/))
      // read files
      for(const item of files){
        try{
          const from = path.join(legacyFormFilePath,item)
          const to = path.join(backupPath,item)
          logger.debug(`moving ${from} -> ${to}`)
          fse.moveSync(from,to)
        }catch(e){
          logger.error(`failed to move item '${item}'.\n`,e)
        }
      };
    }
  }catch(e){
    logger.error("Failed to init backup folder\n",e)
  }  
  Form.removeOld(oldBackupDays)
}
export default  Form;