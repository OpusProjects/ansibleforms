'use strict';
import Job from '../../models/job.model.js';
import RestResultv2 from '../../models/restResult.model.v2.js';
import logger from "../../lib/logger.js";
import stream from 'stream';
import Audit from "../../models/audit.model.js";
import i18n from '../../lib/i18n.js';
import appConfig from '../../../config/app.config.js';

const abortJob = async function(req, res) {
  var jobid = req.params.id;
  if(!jobid){
    res.status(409).json(RestResultv2.error(i18n.t(req, 'jobs.mustProvideJobId')));
    return false
  }
  try {
    await Job.abort(req.user.user, jobid);
    res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'jobs.abortRequested') }));
  } catch (err) {
    if (err.name === 'NotFoundError') {
      res.status(404).json(RestResultv2.error(err.message));
    } else if (err.name === 'ConflictError') {
      res.status(409).json(RestResultv2.error(err.message));
    } else if (err.name === 'AccessDeniedError') {
      res.status(403).json(RestResultv2.error(err.message));
    } else {
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedAbort'), err.toString()));
    }
  }
};
const getJob = async function(req, res) {
  var user = req.user.user
  try {
    const job = await Job.findById(user, req.params.id, (req.query.text == "true"), true)
    var restData = job
    restData.extravars = JSON.parse(job.extravars || "{}")
    restData.credentials = JSON.parse(job.credentials || "{}")
    restData.approval = JSON.parse(job.approval || "{}")
    restData.notifications = JSON.parse(job.notifications || "{}")
    restData.subjobs = (job.subjobs || "").split(",").filter(x => x != "").map(x => parseInt(x))
    res.status(200).json(RestResultv2.single(restData));
  } catch (err) {
    if (err.name === 'NotFoundError') {
      res.status(404).json(RestResultv2.error(err.message));
    } else if (err.name === 'AccessDeniedError') {
      res.status(403).json(RestResultv2.error(err.message));
    } else {
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRetrieve'), err.toString()));
    }
  }
};
const findAllJobs = async function(req, res) {
    var user = req?.user?.user || {}
    // how many of the newest jobs : the page may ask, else Settings > Jobs (JOBS_LIST_SIZE)
    var records = parseInt(req.query.records) || appConfig.jobsListSize || 1000
    try{
      const jobs = await Job.findAll(user,records)
      res.status(200).json(RestResultv2.list(jobs));
    }catch(err){
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRetrieveJobs'), err.toString()));
    }
};
const findApprovals = async function(req, res) {
    var user = req.user.user
    try{
      const count = await Job.findApprovals(user)
      res.status(200).json(RestResultv2.single(count));
    }catch(err){
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRetrieveApprovals'), err.toString()));
    }
};
const download = async function(req,res){
  try{
    var user = req.user.user
    var job = await Job.findById(user,req.params.id,true,true)

    var fileName = `ansibleforms-job-${job.id}.txt`;
    var joboutput = job.output || ""
    // convert output string to stream

    var readStream = new stream.PassThrough();
    readStream.write(joboutput);
    readStream.end();
  
    res.set('Content-disposition', 'attachment; filename="' + fileName + '"');
    res.set('Content-Type', 'text/plain');

    readStream.on('error', (err) => {
      logger.error(`Job download stream error: ${err.message}`)
      if (!res.headersSent) {
        res.status(500).json(RestResultv2.error('stream error'))
      } else {
        res.destroy(err)
      }
    });

    readStream.pipe(res);

  }catch (err) {
    if (err.name === 'NotFoundError') {
      res.status(404).json(RestResultv2.error(err.message));
    } else if (err.name === 'AccessDeniedError') {
      res.status(403).json(RestResultv2.error(err.message));
    } else {
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRetrieve'), err.toString()));
    }
  }
}
const getRawFormData = async function(req, res) {
  try {
    var user = req.user.user;
    const rawFormData = await Job.getRawFormData(user, req.params.id);
    res.status(200).json(RestResultv2.single(rawFormData));
  } catch (err) {
    if (err.name === 'NotFoundError') {
      res.status(404).json(RestResultv2.error(err.message));
    } else if (err.name === 'AccessDeniedError' || err.name === 'ForbiddenError') {
      res.status(403).json(RestResultv2.error(err.message));
    } else if (err.name === 'BadRequestError') {
      res.status(400).json(RestResultv2.error(err.message));
    } else {
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRetrieveRawData'), err.toString()));
    }
  }
};
const deleteJob = async function(req, res) {
  try {
    var user = req?.user?.user || {};
    await Job.delete(user, req.params.id);
    res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'jobs.deleted') }));
  } catch (err) {
    if (err.name === 'NotFoundError') {
      res.status(404).json(RestResultv2.error(err.message));
    } else if (err.name === 'AccessDeniedError') {
      res.status(403).json(RestResultv2.error(err.message));
    } else {
      res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedDelete'), err.toString()));
    }
  }
};
// this is the main launch code for everything
const launch = async function(req, res) {
    //handles null error
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        // wrong implementation -> send 409 error
        res.status(409).json(RestResultv2.error(i18n.t(req, 'errors.noDataSent')));
    }else{
        // get the form data
        var form = req.body.formName || "";
        // the client may not choose the playbook, credentials or working directory unless
        // the form declares a field of that name - stripped inside Job.launch, which is the
        // first place the form definition is known (see stripReservedExtravars)
        var extravars = req.body.extravars || {}
        var creds = req.body.credentials || {}
        var rawFormData = req.body.rawFormData || {}
        // the uploads of the form's file fields, as POST /api/v2/job/upload returned them
        var files = (req.body.files && typeof req.body.files === 'object') ? req.body.files : {}
        // new in 4.0.16, awxCreds are extracted from form and extravars
        var user = req?.user?.user || {}
        // check permission for verbose mode
        if (extravars.__verbose__ && !user.options.allowVerboseMode) {
          res.status(403).json(RestResultv2.error(i18n.t(req, 'errors.noVerbosePermission')));
          return false;
        }
        try{
          const job = await Job.launch({ form, user, credentials: creds, extravars, rawFormData, files, fromClient: true });
          res.status(200).json(RestResultv2.single(job));
        }catch(err){
          // LAUNCH_VALIDATION=enforce : the field values break the form's rules
          if (err?.name === 'ValidationError') {
            logger.warning(err.message);
            res.status(422).json(RestResultv2.error(i18n.t(req, 'jobs.invalidFormData'), err.details || err.message));
            return;
          }
          logger.error("Errors in job launch : ", err)
          try{
            res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedLaunch'), err.toString()));
          }catch(e){}
        }
    }
};
const relaunchJob = async function(req, res) {

    // get the form data
    var jobid = req.params.id;
    var verbose = (req.query.verbose || "false")=="true"
    if(!jobid){
      res.status(409).json(RestResultv2.error(i18n.t(req, 'jobs.mustProvideJobId')));
      return false
    }
    var user = req?.user?.user || {}
    // check permission for verbose mode
    if (verbose && !user.options.allowVerboseMode) {
      res.status(403).json(RestResultv2.error(i18n.t(req, 'errors.noVerbosePermission')));
      return false;
    }
    // a body with `values` : relaunch with those fields changed, through the form engine ;
    // without one : replay the job as it ran
    const values = (req.body && typeof req.body.values === 'object' && req.body.values !== null && !Array.isArray(req.body.values))
      ? req.body.values : null;
    try{
      const job = values
        ? await Job.relaunchWithValues({ user, id: jobid, values, verbose })
        : await Job.relaunch(user, jobid, verbose);
      res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'jobs.relaunched', { id: job.id }), id: job.id }));
    } catch(err) {
      if (err.name === 'ValidationError') {
        res.status(422).json(RestResultv2.error(i18n.t(req, 'jobs.invalidFormData'), err.details || err.message));
      } else if (err.name === 'BadRequestError') {
        res.status(400).json(RestResultv2.error(err.message));
      } else if (err.name === 'NotFoundError') {
        res.status(404).json(RestResultv2.error(err.message));
      } else if (err.name === 'AccessDeniedError' || err.name === 'ForbiddenError') {
        res.status(403).json(RestResultv2.error(err.message));
      } else if (err.name === 'ConflictError') {
        res.status(409).json(RestResultv2.error(err.message));
      } else {
        logger.error(`Error relaunching job: ${err.toString()}`);
        res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedRelaunch'), err.toString()));
      }
    }
};
const approveJob = async function(req, res) {

    // get the form data
    var jobid = req.params.id;
    if(!jobid){
      res.status(409).json(RestResultv2.error(i18n.t(req, 'jobs.mustProvideJobId')));
      return false
    }
    var user = req?.user?.user || {}
    try{
      await Job.approve(user,jobid);
      // an approval is a human decision to let privileged automation run : worth its
      // own entry beyond the generic 'someone POSTed here' the middleware records
      Audit.log({ user, ip: req.ip, action: 'job.approve', targetType: 'job', target: jobid });
      res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'jobs.approved', { id: jobid }) }));
    }catch(err){
      // Mapped like every sibling in this file. A bare 500 for a permission refusal is
      // wrong twice over: the caller is told the server broke, and auditMiddleware only
      // files 401/403 as outcome='denied' - so a refused approval was recorded as a
      // 'failure' and vanished from the very filter the audit log exists to provide.
      // (Audit.log above only runs on success, so the middleware row is the only trace.)
      if (err.name === 'NotFoundError') {
        res.status(404).json(RestResultv2.error(err.message));
      } else if (err.name === 'AccessDeniedError' || err.name === 'ForbiddenError') {
        res.status(403).json(RestResultv2.error(err.message));
      } else if (err.name === 'ConflictError') {
        res.status(409).json(RestResultv2.error(err.message));
      } else {
        logger.error(`Error : ${err.toString()}`)
        res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedApprove'), err.toString()));
      }
    }    
};
const rejectJob = async function(req, res) {

    // get the form data
    var jobid = req.params.id;
    if(!jobid){
      res.status(409).json(RestResultv2.error(i18n.t(req, 'jobs.mustProvideJobId')));
      return false
    }
    var user = req?.user?.user || {}
    try{
      await Job.reject(user,jobid)
      Audit.log({ user, ip: req.ip, action: 'job.reject', targetType: 'job', target: jobid });
      res.status(200).json(RestResultv2.single({ message: i18n.t(req, 'jobs.rejected', { id: jobid }) }));
    }catch(err){
      // Mapped like every sibling in this file. A bare 500 for a permission refusal is
      // wrong twice over: the caller is told the server broke, and auditMiddleware only
      // files 401/403 as outcome='denied' - so a refused approval was recorded as a
      // 'failure' and vanished from the very filter the audit log exists to provide.
      // (Audit.log above only runs on success, so the middleware row is the only trace.)
      if (err.name === 'NotFoundError') {
        res.status(404).json(RestResultv2.error(err.message));
      } else if (err.name === 'AccessDeniedError' || err.name === 'ForbiddenError') {
        res.status(403).json(RestResultv2.error(err.message));
      } else if (err.name === 'ConflictError') {
        res.status(409).json(RestResultv2.error(err.message));
      } else {
        logger.error(`Error : ${err.toString()}`)
        res.status(500).json(RestResultv2.error(i18n.t(req, 'jobs.failedReject'), err.toString()));
      }
    }    

};

export default {
  abortJob,
  getJob,
  findAllJobs,
  findApprovals,
  download,
  getRawFormData,
  deleteJob,
  launch,
  relaunchJob,
  approveJob,
  rejectJob
};