import logger from "../lib/logger.js";
import Settings from '../models/settings.model.js';
import { DEFAULT_LOGO } from '../lib/defaultlogo.js';
import Ssh from '../models/ssh.model.js';
import Form from '../models/form.model.js';
import Job from '../models/job.model.js';
import Schema from '../models/schema.model.js';
import mysql from "../models/db.model.js";
import Repository from '../models/repository.model.js';
import Schedule from '../models/schedule.model.js';
import BackupModel from '../models/backup.model.js';
import cronService from '../services/cron.service.js';
import appConfig from "../../config/app.config.js";
import User from "../models/user.model.js";
import Group from "../models/group.model.js";
import Token from "../models/token.model.js";
import { applyConfigSeed } from "../lib/seed.js";
import { importVaultFromEnvOnce } from "../secrets/importVaultEnv.js";
import { nodeId } from "../lib/role.js";

// The worker's start : the database bootstrap and every background task. It runs only in the
// process holding the worker lock (lib/workerLock.js) - AF_ROLE unset, or a worker - so
// whatever runs here runs once per database, however many app nodes share it.
//
// The bootstrap half (schema, admin, default rows, ssh key, vault import, seed) may run again :
// POST /api/v2/schema re-enters it after creating the schema, and a worker that started on a
// database without one retries it (init/worker.js). The background half (the boot sweeps, the
// cron registry, the schedule queue) starts once per process : starting it again doubled
// every loop and left the first set of system tasks running next to the second.
let backgroundStarted = false;

export async function sleep(millis) {
  return new Promise(resolve => setTimeout(resolve, millis));
}

// don't start until mysql is ready
export async function waitForDatabase() {
  var MYSQL_IS_READY = false
  while(!MYSQL_IS_READY){
    try{
      logger.info("Waiting for mysql to start")
      await mysql.do("SELECT 1")
      MYSQL_IS_READY = true
    }catch(e){
      logger.warning("Mysql not ready yet")
      await sleep(5000)
    }
  }
  logger.info("Mysql is ready")
}

/**
 * @returns {Promise<boolean>} whether the schema is ready
 * @param {object} [opts]
 * @param {boolean} [opts.boot] True only on the application boot path (app.js). A seed
 *   failure is FATAL there - the process must not come up misconfigured. It must NOT be
 *   fatal when init() is re-entered from POST /api/v2/schema, because process.exit()
 *   inside a request handler kills the server in response to an API call - and that
 *   endpoint is unauthenticated while the database has no accounts. There the failure is
 *   thrown so the caller answers with an error instead.
 */
const init = async function({ boot = false } = {}){


  let adminGroupId = undefined;

  await waitForDatabase()

  // Bootstrap an empty database.
  //
  // Until now a fresh install started, logged "please create the schema via the
  // /schema endpoint" and waited for somebody to call it. A declarative deployment
  // (kubernetes/ArgoCD) cannot express "and then a human clicks", so an empty
  // database provisions itself here.
  //
  // isEmpty() is the ONLY safe precondition : create_schema_and_tables.sql DROPs all
  // 16 tables first. It deliberately does not use schemaIsReady (false for a single
  // missing column, or a patch that could not apply) nor isProvisioned() (false for a
  // database full of forms and jobs whose users table happens to be empty) - driving
  // an automatic create from either would destroy a live database to fix a small gap.
  if(appConfig.allowSchemaCreation){
    try{
      if(await Schema.isEmpty()){
        logger.notice("The database holds no AnsibleForms tables : creating the schema")
        // asked again under the schema lock : POST /api/v2/schema on an app node may be
        // creating it at this very moment
        await Schema.createTables({ onlyIf: () => Schema.isEmpty() })
      }
    }catch(err){
      // not fatal : hasSchema() below reports what is missing, and the /schema
      // endpoint is still there as the manual route
      logger.error("Failed to create the schema automatically : " + (err.message || err))
    }
  }

  // check Schema
  var schemaIsReady
  try{
    var schemaresult = await Schema.hasSchema()
    if(schemaresult.data.failed.length>0){
      logger.warning("Schema is not up to date")
      for(let i=0;i<schemaresult.data.success.length;i++){
        logger.info(schemaresult.data.success[i])
      }
      for(let i=0;i<schemaresult.data.failed.length;i++){
        logger.error(schemaresult.data.failed[i])
      }
      // Schema exists but has issues - continue with caution
      schemaIsReady = false
    }else{
      logger.info("Schema is up to date")
      schemaIsReady = true
    }

  }catch(err){
    var result = err.result
    if(result?.data){
      if(result.data.failed.length>0){
        for(let i=0;i<result.data.success.length;i++){
          logger.info(result.data.success[i])
        }
        for(let i=0;i<result.data.failed.length;i++){
          logger.error(result.data.failed[i])
        }
      }
    }else{
      logger.error("Fatal error : " + err)
      throw err
    }
    // Schema is missing - stop initialization here
    schemaIsReady = false
  }

  // Only continue with group/user creation if schema is ready
  if(!schemaIsReady){
    logger.warning("Schema is not ready, skipping group and user initialization")
    logger.warning("Please create the schema via the /schema endpoint")
    // Continue to start the app so the /schema endpoint is available
  }else{
    // check admins groups
    logger.info("Checking admins group exists")
    try{
      var adminGroupName = "admins"
      var adminGroup = await Group.findByName(adminGroupName)
      if(!adminGroup){
        logger.info(`Group ${adminGroupName} not found, creating it`)
        adminGroupId = await Group.create({name:adminGroupName})
        logger.info(`Created admins group with id ${adminGroupId}`)
      }else{
        adminGroupId = adminGroup.id
        logger.info(`Found admins group with id ${adminGroupId}`)
      }
    }catch(err){
      logger.error("Failed to check/create admins group : " + err)
    }

    // check admin user
    logger.info("Checking admin user exists")
    try{
      var adminUsername = appConfig.adminUsername
      var adminUser = await User.findByUsername(adminUsername)
      if(!adminUser){
        logger.info(`Admin user ${adminUsername} not found, creating it`)
        var adminPassword = appConfig.adminPassword
        await User.create({username:adminUsername,email:'',password:adminPassword,group_id:adminGroupId})
        logger.info(`Created admin user ${adminUsername}`)
      }else if(appConfig.reinitAdmin){
        // Recovery hatch: REINIT_ADMIN=1 was set. Force-reset the admin
        // password and re-attach to the admins group. Logged loudly so the
        // operator notices if it stays enabled across restarts.
        logger.warning(`REINIT_ADMIN=1 detected: resetting password and group for admin user '${adminUsername}'`)
        try{
          await User.update({password:appConfig.adminPassword,group_id:adminGroupId}, adminUser.id)
          logger.warning(`REINIT_ADMIN: admin user '${adminUsername}' has been recreated. UNSET REINIT_ADMIN now.`)
        }catch(e){
          logger.error(`REINIT_ADMIN: failed to reset admin user '${adminUsername}': ${e.message || e}`)
        }
      }else{
        logger.info(`Admin user ${adminUsername} already exists`)
      }
    }catch(err){
      logger.error("Failed to check/create admin user : " + err)
    }
  }

  // let's check other database records like settings,ldap. if no record exists, create them, this is for fresh install
  logger.info("Checking database records")
  const records = {
    ldap:{server:'',port:389,ignore_certs:1,enable_tls:0,cert:'',ca_bundle:'',bind_user_dn:'',bind_user_pw:'',search_base:'',username_attribute:'sAMAccountName',groups_attribute:'memberOf',enable:0,groups_search_base:'',group_class:'',group_member_attribute:'',group_member_user_attribute:'',groupfilter:''},    
    settings:{mail_server:'',mail_port:25,mail_secure:0,mail_username:'',mail_password:'',mail_from:'',url:'',forms_yaml:''},
    chat_settings:{provider:'',api_key:'',base_url:'',model:'',max_turns:20,max_tool_rounds:6,timeout_seconds:60,allow_job_status:1,auth_type:'',api_version:'',request_user:'',extra_headers:'',ignore_certs:0}
  }
 
  for(let record in records){
    try{
      const result = await mysql.do(`SELECT * FROM AnsibleForms.${record}`)
      if(result.length==0){
        logger.warning(`No record found for ${record}, creating it`)
        var obj = records[record]
        var keys = Object.keys(obj)
        var values = keys.map((key)=>{return obj[key]})
        var sql = `INSERT INTO AnsibleForms.${record}(${keys.join(",")}) VALUES(${values.map(()=>{return "?"}).join(",")})`
        await mysql.do(sql,values)
      }
    }catch(err){
      logger.error(`Failed to check/create ${record} : ` + err)
    }
  }

  // seed the default logo on fresh installs and on upgrades that just added
  // the logo column ; afterwards it is never null again (removing a custom
  // logo resets it to the default instead)
  try{
    if(await Settings.getLogo()===null){
      logger.warning("No logo found, seeding the default AnsibleForms logo")
      await Settings.setLogo(DEFAULT_LOGO)
    }
  }catch(err){
    logger.error("Failed to check/seed the default logo : " + err)
  }

  logger.info("All database records are checked")

  // Refusing to start is only useful if the REASON survives. winston's file transport is
  // asynchronous, so process.exit() truncates whatever it has not written yet - which
  // loses precisely the one line that explains a crash-looping container. Verified: three
  // deliberately broken seeds logged "Applying config seed" and then died silently.
  // stderr is what `kubectl logs` and `docker logs` show, so the reason goes there too,
  // and the short wait gives the file transport a chance to catch up.
  async function refuseToStart(message){
    logger.error(message)
    if(!boot){
      // not the boot path : never exit the process for an API call
      throw new Error(message)
    }
    console.error(message)
    await new Promise(resolve => setTimeout(resolve, 250))
    process.exit(1)
  }

  logger.info("Checking ssh keys")
  Ssh.generate(false)
    .catch((err)=>{
      logger.warning("Failed to generate ssh keys : " + err)
    })

  const startBackground = !backgroundStarted
  if(startBackground){
    backgroundStarted = true

    logger.info("Checking backup folder")
    Form.initBackupFolder()

    // the jobs this process followed before it restarted, and the jobs nobody follows (from
    // before 7.3, when no job named its node). A job another app node follows is left alone :
    // that node is alive, or the worker's dead-node sweep ends it (Job.abandonDeadNodes).
    logger.info("Checking old jobs")
    Job.abandonOwn(nodeId, { untracked: true })
    .then((changed)=>{
      logger.warning(`Abandoned ${changed} jobs`)
    })
    .catch((err)=>{
      logger.error("Failed to abandon jobs : " + err)
    })

    logger.info("Checking stale repository locks")
    // awaited : the boot clone/pull below now use the atomic status='running'
    // claim, so a stale 'running' must be cleared first or they'd be rejected.
    // Safe with several app nodes : only the worker runs this, and a clone or pull
    // started on an app node (a designer refresh) is over long before a worker restarts.
    try {
      const reset = await Repository.resetStaleLocks()
      if(reset) logger.warning(`Reset ${reset} stale repository lock(s)`)
    } catch(err) {
      logger.error("Failed to reset stale repository locks : " + err)
    }
  }

  // Declarative config seed (CONFIG_SEED_PATH).
  //
  // It MUST come after resetStaleLocks and before the cron/rebase bootstrap below.
  // Creating a seeded repository fires Repository.clone WITHOUT awaiting it, and that
  // clone takes the atomic status='running' claim. Run earlier, resetStaleLocks then
  // wiped the claim of a clone that was still running - marking a healthy repository
  // 'failed' and letting the rebase_on_start block start a SECOND git process in the
  // same directory. In this position the claim survives, so that block is correctly
  // rejected for a repository the seed is already cloning, and a seeded cron is still
  // registered by initializeAll() in this same boot.
  //
  // A broken seed refuses to start, on purpose : running on the previous configuration
  // would mean an instance that no longer matches the manifest describing it, with
  // nothing saying so. Only the worker applies it, so app nodes may run as replicas ;
  // a second worker waits for the worker lock.
  // the VAULT_* variables of before 7.1 become the secret store `vault`, once. Before the
  // seed, so a seed that declares `vault` takes the imported row over.
  if(schemaIsReady){
    try{
      await importVaultFromEnvOnce()
    }catch(err){
      logger.error("Could not import the VAULT_* environment variables : " + (err.message || err))
    }
  }

  try {
    await applyConfigSeed({ schemaIsReady })
  } catch (err) {
    await refuseToStart("Config seed failed, refusing to start : " + (err.message || err))
  }

  if(!startBackground){
    // re-entered : the background below is running already, but a schema created just now
    // has schedules and repository crons the registry has not seen
    await cronService.resync()
    return schemaIsReady
  }

  logger.info("Initializing cron service for scheduled tasks")
  // Initialize all cron jobs from database (repositories, schedules)
  await cronService.initializeAll();

  logger.info("Initializing system maintenance tasks")
  // Initialize system maintenance cron jobs (abandoned jobs, token cleanup, backups, etc.)
  await cronService.initializeSystemTasks(Job, Token, BackupModel, appConfig);

  logger.info("Pulling repositories")
  mysql.do("SELECT name FROM AnsibleForms.`repositories` WHERE rebase_on_start=1")
  .then((repositories)=>{
    repositories.map((repo)=>{
      logger.info("Pulling " + repo.name)
      Repository.clone(repo.name).catch((e)=>{
        logger.warning(`Failed to pull repository ${repo.name}: ${e.message || e}`)
      })
    })
  })
  .catch((e)=>{
    logger.warning(`Failed to query repositories for rebase_on_start: ${e.message || e}`)
  })

  // the schedules : a queue in the database, processed one at a time

  /**
   * Nothing can still be running: this process has just started, and it holds the worker
   * lock, so no other process runs the queue. A row left at 'running' is the remains of a crash or a kill during
   * a launch, and since the check below refuses to dequeue anything while one is
   * 'running', leaving it would disable every scheduled run until somebody edited the
   * database by hand. Same reasoning as the abandoned-jobs sweep.
   */
  async function releaseStaleRunning(table){
    try{
      const res = await mysql.do(`UPDATE AnsibleForms.\`${table}\` SET state='idle' WHERE state='running'`)
      if(res?.changedRows > 0){
        logger.warning(`Released ${res.changedRows} ${table}(s) left at 'running' by a previous run`)
      }
    }catch(e){
      logger.error(`Failed to release stale running ${table}s : ` + e)
    }
  }
  const releaseStaleRunningSchedules = () => releaseStaleRunning('schedule')

  async function checkSchedules(){
    try{
      // logger.info("Checking schedules")
      // one schedule at a time : wait while one is still launching
      const running = await mysql.do("SELECT id FROM AnsibleForms.`schedule` WHERE state='running'",undefined,true)
      if(running.length>0){
        logger.debug("A schedule is still launching, checking again later")
        return
      }
      // logger.info("No schedule is running, checking for queued schedules")
      const schedules = await mysql.do("SELECT id, name FROM AnsibleForms.`schedule` WHERE state='queued' ORDER BY queue_id LIMIT 1",undefined,true)
      if(schedules.length>0){
        logger.info("Found queued schedule")
        const schedule = schedules[0]
        logger.info(`Importing schedule '${schedule.name}'`)
        try{
          await Schedule.launch(schedule.id)
        }catch(e){
          logger.error(`Failed to launch schedule '${schedule.name}' : ` + e)
        }
      }
    }catch(e){
      logger.error(e)
    }finally{
      // Schedule the next execution
      setTimeout(checkSchedules,10000)
    }
  }

  // Initial call to start the process, after clearing anything a crash left behind
  // (the expired stored jobs are swept by the system task at 4:00, cron.service.js)
  releaseStaleRunningSchedules().finally(() => setTimeout(checkSchedules,10000))

  return schemaIsReady
}

export default init