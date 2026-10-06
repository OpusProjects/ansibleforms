'use strict';
import logger from "../lib/logger.js";
import mysql from "./db.model.js";
import helpers from "../lib/common.js";
import Repo from "./repo.model.js";
import path from "path";
import fs from "fs";
import fse from "fs-extra";
import appConfig from "../../config/app.config.js";
import CrudModel from './crud.model.js';
import { bump } from '../lib/epochs.js';
import { friendlyPullError, configRepoFromPath } from "../lib/forms-git.js";

class Repository extends CrudModel {
  static modelName = 'repositories';

  // Every state write below (status, output, head) uses its own SQL rather than
  // CrudModel.update, so nothing evicts the record CrudModel.findByName serves from
  // the shared cache -- crud.config.js enables allowCache on this model, and the
  // cache holds an entry for an hour.
  //
  // Left uncached-aware, GET /api/v2/repository/<name> keeps answering with the head
  // from BEFORE a pull while GET /api/v2/repository, which never reads the cache,
  // answers correctly. Anything polling the single record to learn whether a commit
  // landed -- a CI job asking "is the instance on my commit yet?" -- therefore waits
  // on a value that cannot change until the entry expires.
  //
  // delete() already had to evict by hand for the same reason; this keeps every other
  // path honest, so a new raw write cannot reintroduce it.
  static evictCache({ name, id } = {}) {
    // the other processes drop their whole repositories cache (lib/epochs.js)
    bump(this.modelName);
    const cache = CrudModel.getCache(this.modelName);
    if (!cache) return;
    if (name === undefined && id === undefined) return cache.flushAll();
    if (name !== undefined) cache.del(`name:${name}`);
    if (id !== undefined) cache.del(`id:${id}`);
  }

  // Run a state write and evict what it invalidated. Pass the key the statement is
  // scoped to; omit it when the statement can touch rows this caller cannot name,
  // and the whole model cache is dropped instead.
  static async writeState(sql, params = [], key) {
    const res = await mysql.do(sql, params);
    Repository.evictCache(key);
    return res;
  }

  // Override create to trigger clone after creation
  // opts carries { fromSeed:true } for the declarative config seed only
  static async create(data, opts = {}) {
    logger.info(`Creating repository ${data.name}`);
    const insertId = await super.create(this.modelName, data, opts);
    // Don't await - clone happens in background (it can take minutes and the API has to
    // answer the create now). But the rejection must not escape: clone() throws before it
    // writes any status when the claim fails, so the row was left with no status and no
    // output at all, the process-level handler in app.js only logged it, and the
    // repositories page showed a repository stuck blank with the reason nowhere the user
    // could reach. Record it where they are already looking.
    Repository.clone(data.name).catch(async (e) => {
      logger.error(`Background clone of '${data.name}' failed : ${helpers.getError(e)}`)
      try {
        await Repository.writeState("update AnsibleForms.`repositories` set output = ?, status = 'failed' where name = ?", [helpers.getError(e), data.name], { name: data.name })
      } catch (e2) {
        logger.error(`...and the failure could not be recorded on the repository either : ${helpers.getError(e2)}`)
      }
    });
    return insertId;
  }

  // Override update to handle password properly
  static async update(data, name, opts = {}) {
    logger.info(`Updating repository ${name}`);
    // Get current record to find id
    const repo = await this.findByName(name);
    if (!repo) throw new Error(`No repository found with name ${name}`);

    // Remove empty fields
    helpers.removeEmptyFields(data);

    // `name` is an editable field (the repositories page renders it so), and the working
    // tree lives at repoPath/<name>. Renaming the row alone left the tree behind under
    // the old directory, so the renamed repository had no clone at all: every pull
    // answered "not cloned yet" while the old directory sat there orphaned. Move it with
    // the record, under the same claim every other tree-touching operation takes, so the
    // move cannot race a pull or a sync (issue #414).
    const newName = data.name && data.name !== name ? data.name : null;
    if (newName) {
      // BEFORE the claim and before the tree is touched, exactly as delete() does it.
      // It used to be reached inside super.update, i.e. AFTER Repo.rename had already
      // moved the directory - so renaming a seed-managed repository moved its working
      // tree and then answered 403, leaving the row pointing at a name that no longer
      // exists on disk. The repository then read as 'not cloned', every pull failed, and
      // seed.ensureRepositoryClones cloned it again, orphaning the moved tree for good.
      if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, repo.id);
      const claim = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
      if (!claim.affectedRows) {
        throw new Error(`Repository '${name}' not found or already running, try again later`)
      }
      let moved = false;
      try {
        // Repo.rename validates both names and refuses an occupied destination before it
        // moves anything, so its own failures leave the disk untouched.
        moved = Repo.rename(name, newName);
        const res = await super.update(this.modelName, data, repo.id, opts);
        // release the claim under the NEW name - the row carries it now
        await Repository.writeState("update AnsibleForms.`repositories` set status = ? where name = ?", [repo.status ?? null, newName])
        return res;
      } catch (e) {
        // Put the tree back. The row keeps the old name from here on, so a tree left at
        // the new one is the same orphaned-clone bug this block exists to prevent - only
        // reached through the failure path instead. Best effort: if the move back also
        // fails there is nothing left to try, so say exactly what is where.
        if (moved) {
          try {
            Repo.rename(newName, name);
          } catch (e2) {
            logger.error(`Repository '${name}' could not be renamed and its working tree could not be moved back : it is now at '${newName}' while the record still says '${name}'. Move it back by hand. (${helpers.getError(e2)})`)
          }
        }
        await Repository.writeState("update AnsibleForms.`repositories` set status = ? where id = ?", [repo.status ?? null, repo.id])
        throw e;
      }
    }

    return super.update(this.modelName, data, repo.id, opts);
  }

  // Override delete to cleanup disk
  static async delete(name, opts = {}) {
    logger.info(`Deleting repository ${name}`);
    const repo = await this.findByName(name);
    if (!repo) throw new Error(`No repository found with name ${name}`);

    // This deletes with its own SQL rather than through CrudModel.delete, so the
    // managed guard has to be asked for explicitly - otherwise a seeded repository
    // would be refused an edit but still be deletable, which is worse than either.
    if (!opts.fromSeed) await CrudModel.assertNotManaged(this.modelName, repo.id);

    // Claim the repo BEFORE deleting the tree, exactly as reset() does and for the same
    // reason: this rm -rf's the working tree, which must not race a pull or a sync
    // running git on it (issue #414). Without the claim a scheduled pull could be
    // checking out into the directory as it is being removed, recreating files after the
    // rmSync - and since the row is then gone, persistent/repositories/<name> is left
    // orphaned with a stale .git/config. Creating a repository with the same name
    // afterwards hits Repo.clone's "already exists, pulling instead" path, so the new
    // repository silently pulls from the OLD remote and reports success.
    // Claimed after assertNotManaged, so a refused delete never touches the status.
    const claim = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
    if (!claim.affectedRows) {
      throw new Error(`Repository '${name}' not found or already running, try again later`)
    }
    try {
      // awaited : it was fire-and-forget, so a validateRepoName throw became an unhandled
      // rejection while the record was removed anyway
      await Repo.delete(name);
    } catch (e) {
      // release the claim, or a failed rm wedges the repo at 'running' for ever
      await Repository.writeState("update AnsibleForms.`repositories` set output = ?, status = 'failed' where name = ?", [e.message, name], { name })
      throw e
    }
    // Deletes with its own SQL, so it must evict what CrudModel.delete would have:
    // findByName above populated `name:<name>` in the shared cache, and without the
    // eviction GET /api/v2/repository/<name> kept answering 200 with a deleted
    // repository.
    return await Repository.writeState("DELETE FROM AnsibleForms.`repositories` WHERE name = ?", [name], { name, id: repo?.id });
  }

  static async findById(id) {
    const repo = await super.findById(this.modelName, id);
    // Mask password for API
    if (repo && repo.password) repo.password = '**********';
    return repo;
  }

  static async findAll() {
    const repos = await super.findAll(this.modelName);
    // Mask passwords before returning to API
    repos.forEach(r => {
      if (r.password) r.password = '**********';
    });
    return repos;
  }

  static async findByName(name) {
    logger.debug(`Finding repository ${name}`);
    const repo = await super.findByName(this.modelName, name);
    if (!repo) throw new Error("No repository found with name " + name);
    // Don't mask password here - internal use needs real password
    return repo;
  }

  // Override reset to use CRUD pattern
  static async reset(name) {
    logger.info(`Resetting repository ${name}`);
    // claim the repo BEFORE deleting the tree : a reset rm's the working tree,
    // which must not race a pull/sync running git on it (issue #414)
    const claim = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
    if (!claim.affectedRows) {
      throw new Error(`Repository '${name}' not found or already running, try again later`)
    }
    try {
      await Repo.delete(name); // delete the repo on disk
      await Repository.clone(name, true); // recreate it ; clone writes the final status
    } catch (e) {
      // release the claim so a delete failure doesn't wedge the repo at 'running'
      await Repository.writeState("update AnsibleForms.`repositories` set output = ?, status = 'failed' where name = ?", [e.message, name], { name })
      throw e
    }
  }

  // Helper methods (not CRUD operations)

  static getPrivateUri(repo) {
  if(repo.uri){
    if(repo.user && repo.password){
      var httpRegex = new RegExp("^http[s]{0,1}://[^@]+$", "g");

      var match = httpRegex.exec(repo.uri);
      if(match){
        var privateUri = repo.uri.replace(/(http[s]{0,1}):\/\/(.*)/gm,`$1://${repo.user}:${repo.password}@$2`)
        return privateUri
      }else{
        logger.debug("Not an http uri")
        return repo.uri
      }
  
    } else {
      return repo.uri
    }

  } else {
    logger.warning("No uri defined")
    return ""
  }
}

  // mask credentials in git output before it is stored / returned : the embedded
  // password can appear as plain text (git stderr) or escaped (the command
  // banner), so mask the URL pattern AND the raw password value
  static maskSecrets(output, repo) {
    let o = Repo.maskGitToken(String(output ?? ""))
    // also mask the raw password value (it can appear escaped in the command
    // banner) ; only for non-trivial passwords, so a short one can't over-mask
    if (repo && repo.password && String(repo.password).length >= 8) {
      o = o.split(repo.password).join("*******")
    }
    return o
  }

  static async hasFormsRepository() {
    try {
      var repositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_forms")
      return (repositories.length > 0)
    } catch (e) {
      logger.error("Failed to check repositories : ", e)
      return false
    }
  }

  static async getConfigPath() {
  // No catch that answers "" - same reasoning as getFormsFolders above. "" means "use the
  // local config file", so a database blip made every config write land in
  // persistent/config.yaml while the repository copy kept being served, discarding the
  // edit silently. Let it throw; the caller reports the real cause.
  {
    // First check for repositories with use_for_config enabled (new way since 6.1.0)
    var configRepositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_config")
    
    if(configRepositories.length > 0){
      // Found config repository/repositories
      if(configRepositories.length > 1){
        const repoNames = configRepositories.map(r => r.name).join(", ")
        logger.warning(`Multiple repositories are marked as 'use_for_config': ${repoNames}. Only one should be enabled. Using first one: ${configRepositories[0].name}`)
      }
      
      const repoPath = path.join(appConfig.repoPath, configRepositories[0].name)
      
      const configPath = path.join(repoPath, "config.yaml")
      if(fs.existsSync(configPath)){
        logger.debug(`Found config.yaml in use_for_config repository: ${configRepositories[0].name}`)
        return configPath
      }

      // Config repo exists but no config file found
      logger.warning(`Repository '${configRepositories[0].name}' is marked as use_for_config but has no config.yaml`)
      return ""
    }
    
    // Fall back to old behavior: check use_for_forms repositories (backwards compatibility)
    var repositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_forms")
  }
  
  if(repositories.length === 0){
    return ""
  }
  
  var foundConfigs = []
  
  // Loop through all form repositories to find config files
  for(const repo of repositories){
    var repoPath = path.join(appConfig.repoPath, repo.name)
    
    const configPath = path.join(repoPath, "config.yaml")
    if(fs.existsSync(configPath)){
      foundConfigs.push({ repo: repo.name, path: configPath })
    }
  }
  
  if(foundConfigs.length === 0){
    return ""
  }
  
  if(foundConfigs.length > 1){
    const configList = foundConfigs.map(c => `${c.repo}/${path.basename(c.path)}`).join(", ")
    logger.warning(`Multiple config files found in repositories: ${configList}. Using first one: ${foundConfigs[0].repo}/${path.basename(foundConfigs[0].path)}`)
  }
  
    return foundConfigs[0].path
  }

  // Return the forms folder of every forms repository, with the repository
  // name : [{name, path}]. The 'forms' subfolder is used when it exists,
  // otherwise the repository root.
  static async getFormsFolders() {
    // Deliberately NOT wrapped in a catch that returns [].
    //
    // [] is not "there are no forms repositories", it is "I could not find out" - and
    // every caller treats it as the fact. getSaveTargets computes `repoMode` from the
    // length, so a transient database error during a designer save skipped the
    // "repository is not cloned yet" guard, took no git write-lock, and wrote every form
    // into the local persistent/forms folder instead of the repository working tree. The
    // save reported success; once the database recovered the repository copies were
    // served again and the user's work was simply gone. Form.load has the same problem in
    // reverse: it would quietly serve the local forms in place of the repository's.
    //
    // Failing loudly is the only honest answer, and it is the rule this codebase already
    // applies to health.model's authenticationFacts.
    const repositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_forms")

    return repositories.map(repo => {
      const repoPath = path.join(appConfig.repoPath, repo.name)
      const formsSubPath = path.join(repoPath, "forms")
      if(fs.existsSync(formsSubPath)){
        logger.debug(`Using forms subfolder for repository '${repo.name}': ${formsSubPath}`)
        // dedicated: this folder is ours, so Form.save may delete files that no longer
        // correspond to a form. Stated as a FLAG rather than inferred from the basename -
        // a repository literally named 'forms' has a root path ending in /forms, and that
        // made Form.save treat the whole repository root as fully managed and delete every
        // unrelated yaml in it (playbooks, inventories, .gitlab-ci.yml) on the next save.
        return { name: repo.name, path: formsSubPath, dedicated: true }
      } else {
        logger.debug(`Forms subfolder not found for repository '${repo.name}', using root path: ${repoPath}`)
        return { name: repo.name, path: repoPath, dedicated: false }
      }
    })
  }

  static async getFormsFolderPath() {
    const folders = await Repository.getFormsFolders()
    const formsPaths = folders.map(f => f.path)
    if (formsPaths.length > 0) {
      logger.debug(`Found ${formsPaths.length} forms folder(s) from repositories: ${formsPaths.join(", ")}`)
    }
    return formsPaths
  }

  static async getAnsiblePath() {
  try{
    var repositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_playbooks")
    
    if(repositories.length === 0){
      return ""
    }
    
    if(repositories.length > 1){
      const repoNames = repositories.map(r => r.name).join(", ")
      logger.warning(`Multiple repositories are marked as 'use_for_playbooks': ${repoNames}. Only one should be enabled. Playbooks cannot be merged. Using first one: ${repositories[0].name}`)
    }
    
    const repoPath = path.join(appConfig.repoPath, repositories[0].name)
    const playbooksSubPath = path.join(repoPath, "playbooks")
    
    // Check if playbooks subfolder exists
    if(fs.existsSync(playbooksSubPath)){
      logger.debug(`Using playbooks subfolder for repository '${repositories[0].name}': ${playbooksSubPath}`)
      return playbooksSubPath
    } else {
      logger.debug(`Playbooks subfolder not found for repository '${repositories[0].name}', using root path: ${repoPath}`)
      return repoPath
    }
  }catch(e){
      logger.error("Failed to get ansible path : ", e)
      return ""
    }
  }

  static async getVarsFilesPath() {
  try{
    var repositories = await mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE use_for_vars_files")
    
    if(repositories.length === 0){
      // No repository configured, return default local path
      return appConfig.varsFilesPath
    }
    
    if(repositories.length > 1){
      const repoNames = repositories.map(r => r.name).join(", ")
      logger.warning(`Multiple repositories are marked as 'use_for_vars_files': ${repoNames}. Only one should be enabled. Using first one: ${repositories[0].name}`)
    }
    
    const repoPath = path.join(appConfig.repoPath, repositories[0].name)
    const varsSubPath = path.join(repoPath, "vars")
    
    // Check if vars subfolder exists
    if(fs.existsSync(varsSubPath)){
      logger.debug(`Using vars subfolder for repository '${repositories[0].name}': ${varsSubPath}`)
      return varsSubPath
    } else {
      logger.debug(`Vars subfolder not found for repository '${repositories[0].name}', using root path: ${repoPath}`)
      return repoPath
    }
  }catch(e){
    logger.error("Failed to get vars files path : ",e)
    return appConfig.varsFilesPath
  }
  }

  // migration path (issue #414) : when the only forms repository is cloned and
  // contains no forms content yet, its working tree is seeded with the local
  // designer forms (config.yaml + forms folder) ; nothing is pushed until the
  // first 'Push to repo'
  static async seedFormsRepo(name) {
    const formsRepos = await Repository.findFormsRepositories()
    if (formsRepos.length !== 1 || formsRepos[0].name !== name) {
      return ""
    }
    const repoDir = path.join(appConfig.repoPath, name)
    // also treat loose *.yaml at the repo root as content (root-served forms),
    // so seeding never overwrites a repo that already holds forms
    const rootYaml = fs.existsSync(repoDir) && fs.readdirSync(repoDir).some(f => /\.(yaml|yml)$/i.test(f))
    const hasContent = rootYaml || fs.existsSync(path.join(repoDir, "config.yaml")) || fs.existsSync(path.join(repoDir, "forms"))
    if (hasContent) {
      return ""
    }
    if (fs.existsSync(appConfig.configPath)) {
      fse.copySync(appConfig.configPath, path.join(repoDir, "config.yaml"))
    }
    if (fs.existsSync(appConfig.formsFolderPath)) {
      fse.copySync(appConfig.formsFolderPath, path.join(repoDir, "forms"))
    }
    logger.notice(`Seeded forms repository '${name}' with the local designer forms`)
    return "\nThe repository was empty : the working tree was seeded with the local designer forms, use 'Push to repo' to publish them"
  }

  // when claimed=true the caller already holds the atomic status='running' lock
  // (e.g. reset, which must claim before it deletes the tree) ; this avoids a
  // double-claim that would otherwise fail its own guard (issue #414)
  static async clone(name, claimed = false) {
    var output, status, head, repo
    if (!claimed) {
      // atomic check-and-set : a clone must not run git while a pull/sync/reset
      // is touching the same working tree
      const claim = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
      if (!claim.affectedRows) {
        throw new Error(`Repository '${name}' not found or already running, try again later`)
      }
    }
    try {
      repo = await Repository.findByName(name)
      var uri = Repository.getPrivateUri(repo)
      var branch = repo.branch || undefined
      output = await Repo.clone(uri, name, branch)
      if (repo.use_for_forms) {
        output += await Repository.seedFormsRepo(name)
      }
      status = "success"
    } catch (e) {
      output = e.message
      status = "failed"
    }
    output = Repository.maskSecrets(output, repo) // never expose git credentials
    await Repository.writeState("update AnsibleForms.`repositories` set output = ?,status = ? where name = ?", [output, status, name], { name })
    if (status == "success") {
      // Repo.info runs `git rev-parse --short HEAD`, which exits 128 on a repository
      // whose remote is EMPTY - a case this model explicitly supports (see
      // seedFormsRepo). The operation genuinely succeeded and its status is already
      // stored, so a missing head must not become a rejection that unwinds past it -
      // in the clone path that rejection has no caller at all, since create() runs it
      // in the background.
      try {
        head = await Repo.info(name)
        await Repository.writeState("update AnsibleForms.`repositories` set head = ? where name = ?", [head, name], { name })
      } catch (e) {
        logger.warning(`'${name}' succeeded but its HEAD could not be read (an empty repository has none) : ${helpers.getError(e)}`)
      }
    }
  }

  static async pull(name) {
    var output, status, head
    // atomic check-and-set : a pull and a sync (or another pull) must not run
    // git on the same working tree at the same time (issue #414)
    const claimed = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
    if (!claimed.affectedRows) {
      throw new Error(`Repository '${name}' not found or already running, try again later`)
    }
    var pullRepo = null
    var repoUnknown = false
    try {
      // the row is guaranteed to exist - the claim above matched it - so a failure here
      // is a real database or decrypt fault, which is exactly when NOT to degrade
      pullRepo = await Repository.findByName(name).catch(() => { repoUnknown = true; return null })
      output = await Repo.pull(name)
      status = "success"
    } catch (e) {
      output = e.message
      status = "failed"
    }
    // maskSecrets does two things: it rewrites the https://user:pass@host form, AND it
    // blanks any literal occurrence of this repository's password. With a null repo only
    // the first runs, so a password appearing in any other shape survived into the output
    // column and back to the API. Withhold the output entirely rather than risk it.
    if (repoUnknown) {
      logger.error(`Could not read repository '${name}' to mask its credentials ; withholding the git output`)
      output = `The git output was withheld: this repository's record could not be read, so its credentials could not be masked.`
    } else {
      output = Repository.maskSecrets(output, pullRepo) // never expose git credentials
    }
    await Repository.writeState("update AnsibleForms.`repositories` set output = ?,status = ? where name = ?", [output, status, name], { name })
    if (status == "success") {
      // Repo.info runs `git rev-parse --short HEAD`, which exits 128 on a repository
      // whose remote is EMPTY - a case this model explicitly supports (see
      // seedFormsRepo). The operation genuinely succeeded and its status is already
      // stored, so a missing head must not become a rejection that unwinds past it -
      // in the clone path that rejection has no caller at all, since create() runs it
      // in the background.
      try {
        head = await Repo.info(name)
        await Repository.writeState("update AnsibleForms.`repositories` set head = ? where name = ?", [head, name], { name })
      } catch (e) {
        logger.warning(`'${name}' succeeded but its HEAD could not be read (an empty repository has none) : ${helpers.getError(e)}`)
      }
    } else {
      // a pull failure used to be swallowed (status only) ; surface it so the
      // designer 'Load (repository)' does not report a false success. Local
      // uncommitted changes blocking the merge get a clear, actionable message.
      throw new Error(friendlyPullError(output, name))
    }
  }

  static async findFormsRepositories() {
    try {
      return await mysql.do("SELECT name,status,head FROM AnsibleForms.`repositories` WHERE use_for_forms")
    } catch (e) {
      logger.error("Failed to get forms repositories : ", e)
      return []
    }
  }

  // the repository that holds config.yaml (categories/roles/constants) ; config
  // is written to and pushed from there. Returns null when config is local.
  static async getConfigRepoName() {
    const configPath = await Repository.getConfigPath()
    return configRepoFromPath(configPath, appConfig.repoPath)
  }

  // the repositories the designer can push to : the forms repos plus the
  // config-origin repo when config lives in a separate use_for_config repo, so
  // config edits made in the designer can be committed and flagged as unpushed
  static async findPushableRepositories() {
    const repos = await Repository.findFormsRepositories()
    const configRepo = await Repository.getConfigRepoName()
    if (configRepo && !repos.some(r => r.name === configRepo)) {
      try {
        const cfg = await mysql.do("SELECT name,status,head FROM AnsibleForms.`repositories` WHERE name = ?", [configRepo])
        if (cfg.length) repos.push(cfg[0])
      } catch (e) {
        logger.error("Failed to add config repository to the pushable set : ", e)
      }
    }
    return repos
  }

  // are there new forms staged (created in the designer, not yet pushed to a
  // repository) ? they live in the staging folder until a 'Push to repo'
  static hasStagedForms() {
    const stagingPath = appConfig.formsStagingPath
    if (!fs.existsSync(stagingPath)) return false
    return fs.readdirSync(stagingPath).some(f => /\.(yaml|yml)$/i.test(f))
  }

  // the forms repositories with a 'dirty' flag (uncommitted or unpushed changes),
  // the config-origin repository name, and whether new forms are staged but not
  // yet pushed (issue #414)
  static async formsRepoStatus() {
    const repositories = await Repository.findPushableRepositories()
    const configRepo = await Repository.getConfigRepoName()
    const withDirty = []
    for (const repo of repositories) {
      withDirty.push({ ...repo, dirty: await Repo.hasChanges(repo.name) })
    }
    return { repositories: withDirty, configRepo, staged: Repository.hasStagedForms() }
  }

  // true when the working tree has uncommitted or unpushed changes ; used to
  // skip background pulls that would otherwise fail noisily while the designer
  // is mid-edit (issue #414)
  static async hasLocalChanges(name) {
    return Repo.hasChanges(name)
  }

  // claim a tracked repository for a local working-tree write (a designer Save
  // writes form files directly into the tree) : this serializes the save against
  // pull/sync/clone/reset, which all use the same status='running' lock, so a
  // git checkout can never race an fs.writeFileSync on the same files. Returns
  // the PRIOR status to restore on release (a save is not a git op, so it must
  // not leave a fake 'success'/'failed') ; returns undefined when the repo is
  // not tracked (nothing to claim) ; throws when the repo is busy. (issue #414)
  static async claimForWrite(name) {
    const rows = await mysql.do("SELECT status FROM AnsibleForms.`repositories` WHERE name = ?", [name])
    if (!rows.length) return undefined // not a tracked repo (e.g. the staging folder) : skip
    const claim = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
    if (!claim.affectedRows) {
      throw new Error(`Repository '${name}' is busy (a pull or sync is running), try again`)
    }
    // never carry 'running' forward as the prior status : the SELECT and the
    // claim are separate statements, so the SELECT could briefly catch another
    // op's claim that was released before ours succeeded ; restoring 'running'
    // would wedge the repo. Fall back to null (cleared) in that case.
    const prior = rows[0].status
    return (prior && prior !== 'running') ? prior : null
  }

  // release a write claim taken by claimForWrite, restoring the prior status ;
  // guarded on status='running' so it only ever clears OUR own claim and never
  // overwrites a status another operation legitimately set afterwards
  static async releaseWrite(name, priorStatus) {
    await Repository.writeState("update AnsibleForms.`repositories` set status = ? where name = ? and status = 'running'", [priorStatus ?? null, name], { name })
  }

  // clear any repository left at status='running' by a process that died mid
  // pull/sync : the atomic claim (status<>'running') would otherwise wedge the
  // repo forever. Run once at startup, mirroring Job.abandon (issue #414)
  static async resetStaleLocks() {
    const result = await Repository.writeState("update AnsibleForms.`repositories` set status = 'failed' where status = 'running'", [])
    return result.affectedRows || 0
  }

  // pull every forms repository, best effort (used when the designer lock is
  // acquired, so editing starts from the latest remote state)
  static async pullFormsRepositories() {
    const repositories = await Repository.findFormsRepositories()
    for (const repo of repositories) {
      try {
        await Repository.pull(repo.name)
      } catch (e) {
        logger.warning(`Failed to refresh forms repository '${repo.name}' : ${e.message}`)
      }
    }
  }

  // resolve the forms folder of a single repository (the 'forms' subfolder if
  // it exists, otherwise the repository root)
  static formsFolderOf(name) {
    const repoDir = path.join(appConfig.repoPath, name)
    const formsSub = path.join(repoDir, "forms")
    return fs.existsSync(formsSub) ? formsSub : repoDir
  }

  // move every staged new form into this repository's forms folder (issue #414) ;
  // staged forms are the new files the designer created that are not yet bound
  // to a repository. Returns the list of moved file names.
  static flushStagingInto(name) {
    const stagingPath = appConfig.formsStagingPath
    if (!fs.existsSync(stagingPath)) {
      return []
    }
    const moved = []
    const dest = Repository.formsFolderOf(name)
    for (const entry of fs.readdirSync(stagingPath)) {
      if (!/\.(yaml|yml)$/i.test(entry)) continue
      fse.ensureDirSync(dest)
      const target = path.join(dest, entry)
      if (fs.existsSync(target)) {
        // refuse to clobber an existing form file ; leave it staged so the user can rename
        logger.warning(`Staged form '${entry}' collides with an existing file in '${name}', leaving it staged`)
        continue
      }
      fse.moveSync(path.join(stagingPath, entry), target)
      moved.push(entry)
    }
    if (moved.length) {
      logger.notice(`Assigned ${moved.length} new form(s) to repository '${name}' : ${moved.join(", ")}`)
    }
    return moved
  }

  // commit & push the working tree of a forms repository (issue #414) ; the
  // designer saves into the tree, this publishes those saves to the remote.
  // New forms staged in the designer are assigned to this repository first.
  static async sync(name, triggeredBy) {
    var output, status, head, syncRepo = null
    // atomic check-and-set : refuse concurrent syncs of the same repository
    // (eg the settings page button while a designer push is in flight)
    const claimed = await Repository.writeState("update AnsibleForms.`repositories` set status = 'running' where name = ? and COALESCE(status,'') <> 'running'", [name], { name })
    if (!claimed.affectedRows) {
      throw new Error(`Repository '${name}' not found or already running, try again later`)
    }
    try {
      syncRepo = await Repository.findByName(name)
      // a forms repo (read+write forms) or the config-origin repo (so config
      // edits can be committed even when config lives in a separate repo)
      if (!syncRepo.use_for_forms && !syncRepo.use_for_config) {
        throw new Error(`Repository '${name}' is not a forms or config repository`)
      }
      const repoDir = path.join(appConfig.repoPath, name)
      if (!fs.existsSync(repoDir)) {
        // first sync : clone it (an empty remote repository is fine)
        await Repo.clone(Repository.getPrivateUri(syncRepo), name, syncRepo.branch || undefined)
      }
      // bind the new staged forms to this repository before committing (only a
      // forms repo receives staged forms ; a config-only repo just pushes config)
      if (syncRepo.use_for_forms) Repository.flushStagingInto(name)
      const message = `Forms sync by ${triggeredBy || "AnsibleForms"}`
      output = await Repo.sync(name, message)
      status = "success"
    } catch (e) {
      output = e.message
      status = "failed"
    }
    output = Repository.maskSecrets(output, syncRepo) // never expose git credentials
    await Repository.writeState("update AnsibleForms.`repositories` set output = ?,status = ? where name = ?", [output, status, name], { name })
    if (status == "success") {
      // Repo.info runs `git rev-parse --short HEAD`, which exits 128 on a repository
      // whose remote is EMPTY - a case this model explicitly supports (see
      // seedFormsRepo). The operation genuinely succeeded and its status is already
      // stored, so a missing head must not become a rejection that unwinds past it -
      // in the clone path that rejection has no caller at all, since create() runs it
      // in the background.
      try {
        head = await Repo.info(name)
        await Repository.writeState("update AnsibleForms.`repositories` set head = ? where name = ?", [head, name], { name })
      } catch (e) {
        logger.warning(`'${name}' succeeded but its HEAD could not be read (an empty repository has none) : ${helpers.getError(e)}`)
      }
    } else {
      throw new Error(output)
    }
    return output
  }
}

export default Repository;
