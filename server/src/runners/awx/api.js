// AWX / Ansible Automation Platform / Ascender : launching a job or workflow template and
// tracking its output back into the job. Every function takes the runner ROW (a runner of
// type awx, its secrets decrypted) - the connection the form named, or the default one.
import axios from "axios";
import https from "https";
import yaml from "yaml";
import logger from "../../lib/logger.js";
import Errors from "../../lib/errors.js";
import appConfig from "../../../config/app.config.js";
import { safeParse } from "../../lib/safejson.js";
// a cycle (job.model imports the orchestrator, which reaches this module) ; Job is only
// used when a job runs, long after both modules have loaded
import Job from "../../models/job.model.js";

function delay(t, v) {
  return new Promise((resolve) => setTimeout(resolve, t, v));
}

export function getHttpsAgent(awx) {
  return new https.Agent({
    rejectUnauthorized: !awx.ignore_certs,
    ca: awx.ca_bundle || undefined,
  });
}

// basic auth with a user and password, or a bearer token
// every AWX call : a connection that hangs must fail and reach the retries, not wait for ever
const AWX_TIMEOUT_MS = 60000;
// polls in a row that may fail before the job is given up
const AWX_MAX_RETRIES = 10;

// Above STDOUT_MAX_BYTES_DISPLAY (1 MB by default), AWX refuses the display formats of a
// job's stdout : it answers 200 with this placeholder instead of the log (issue #733). The
// stdout is read in a download format, which has no such limit ; the placeholder is still
// recognized, so it can never be taken for the log.
const AWX_STDOUT_TOO_LARGE = /^Standard Output too large to display \(\d+ bytes\)/;

/**
 * Tells whether a stdout answer is AWX's "too large to display" placeholder.
 *
 * Args:
 *   text (string): what AWX returned for the stdout.
 *
 * Returns:
 *   boolean: true for the placeholder.
 */
export function isStdoutTooLarge(text) {
  return typeof text === "string" && AWX_STDOUT_TOO_LARGE.test(text);
}

export function getAuthorization(awx) {
  const headers = awx.use_credentials
    ? { Authorization: `Basic ${Buffer.from(`${awx.username}:${awx.password}`).toString("base64")}` }
    : { Authorization: `Bearer ${awx.token}` };
  return { headers, httpsAgent: getHttpsAgent(awx), timeout: AWX_TIMEOUT_MS };
}

// AWX stopped answering while a job was followed : end ours, rather than leave it 'running'
// until the daily sweep. The job in AWX may well go on.
// an error thrown after the job was ended : who catches it must not end it again
function jobEnded(err) {
  err.jobEnded = true;
  return err;
}

async function lostContact(jobid, counter, job, message) {
  const line = `[ERROR]: lost contact with AWX while following AWX job ${job?.id} (${message}) : it may still be running, check it in AWX`;
  await Job.resetAbortRequested(jobid).catch(() => {});
  await Job.endJobStatus(jobid, counter, "stderr", "failed", line);
  return line;
}

/** proves the connection works : it lists the job templates the credentials can see */
export async function check(awx) {
  const uri = `${awx.uri}${appConfig.awxApiPrefix}`;
  logger.info(`Checking AWX connection at ${uri}`);
  let data;
  try {
    ({ data } = await axios.get(`${uri}/job_templates/`, { ...getAuthorization(awx), timeout: 10000 }));
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) throw new Errors.BadRequestError(`AWX at ${awx.uri} refused the credentials (${status})`);
    if (status) throw new Errors.BadRequestError(`AWX at ${awx.uri} answered ${status} : ${err.message}`);
    throw new Errors.BadRequestError(`AWX at ${awx.uri} is unreachable : ${err.code || err.message}`);
  }
  if (!data?.results) throw new Errors.BadRequestError(`AWX at ${awx.uri} did not answer like AWX (no job templates list)`);
  return { templates: data.count ?? data.results.length };
}

const Awx = {};
Awx.abortJob = async function (awx, id, isWorkflow = false) {
  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  logger.info(`aborting awx ${isWorkflow ? "workflow " : ""}job ${id}`);
  const axiosConfig = getAuthorization(awxConfig);
  // workflow jobs have their own cancel endpoint
  const jobsPath = isWorkflow ? "/workflow_jobs/" : "/jobs/";
  try {
    const axiosResult = await axios.post(
      awxConfig.uri + appConfig.awxApiPrefix + jobsPath + id + "/cancel/",
      {},
      axiosConfig
    );
    const job = axiosResult.data;
    return job;
  } catch (error) {
    if (error.response && error.response.status === 405) {
      const message = `cannot cancel job id ${id}`;
      logger.error(message);
      throw new Errors.ConflictError(message);
    } else {
      logger.error("Failed to abort awx job : ", error);
      throw new Errors.ApiError(
        `Failed to abort awx job ${id} : ${error.message}`
      );
    }
  }
};
Awx.launch = async function (
  awx,
  ev,
  credentials,
  jobid,
  counter
) {
  var message;
  // the last output line written so far ; the next ones follow it
  counter = counter || 0;

  // we make a copy, we don't mutate the original
  var extravars = { ...ev };

  // get awx data from the extravars
  var invent = extravars?.__inventory__;
  var execenv = extravars?.__executionEnvironment__;
  var instanceGroups = [].concat(extravars?.__instanceGroups__ || []); // always array ! force to array
  var tags = extravars?.__tags__ || "";
  var scmBranch = extravars?.__scmBranch__ || "";
  var check = extravars?.__check__ || false;
  var verbose = extravars?.__verbose__ || false;
  var limit = extravars?.__limit__ || "";
  var diff = extravars?.__diff__ || false;
  var template = extravars?.__template__;

  var awxCredentials = extravars?.__awxCredentials__ || [];
  try {
    const jobTemplate = await Awx.findJobTemplateByName(awx, template);
    logger.debug("Found jobtemplate, id = " + jobTemplate.id);
    await Awx.launchTemplate(
      awx,
      jobTemplate,
      ev,
      invent,
      tags,
      limit,
      check,
      diff,
      verbose,
      credentials,
      awxCredentials,
      execenv,
      instanceGroups,
      scmBranch,
      jobid,
      ++counter
    );
    return true;
  } catch (err) {
    message = "failed to launch awx template " + template + "\n" + err.message;
    // ended once : launchTemplate ends the job itself before it throws, and a second end wrote
    // a second last line and sent a second "failed" mail
    if (!err.jobEnded) await Job.endJobStatus(jobid, counter + 1, "stdout", "failed", message);
    throw jobEnded(new Errors.ApiError(message));
  }
};
Awx.launchTemplate = async function (
  awx,
  template,
  ev,
  invent,
  tags,
  limit,
  check,
  diff,
  verbose,
  credentials,
  awxCredentials,
  execenv,
  instanceGroups,
  scmBranch,
  jobid,
  counter
) {
  var message;
  if (!counter) {
    counter = 0;
  }
  // get existing credentials in the template, and then add the external ones.
  var awxCredentialList = [];
  try {
    awxCredentialList = await Awx.findCredentialsByTemplate(
      awx,
      template.id
    );
    logger.notice(`Found ${awxCredentialList.length} existing creds`);
  } catch (e) {
    logger.warning("No credentials available... could be workflow template");
  }
  // add external ones
  for (let i = 0; i < awxCredentials.length; i++) {
    var ac = awxCredentials[i];
    var credId = await Awx.findCredentialByName(awx, ac);
    logger.debug(`Found awx credential '${ac}'; id = ${credId}`);
    awxCredentialList.push(credId);
  }
  awxCredentialList = [...new Set(awxCredentialList)];

  // get inventory
  var inventory = await Awx.findInventoryByName(awx, invent);
  // get execution environment
  var executionEnvironment = await Awx.findExecutionEnvironmentByName(
    awx,
    execenv
  );

  // get instance groups
  var instanceGroupIds = [];
  for (let index = 0; index < instanceGroups.length; index++) {
    instanceGroupIds.push(
      await Awx.findInstanceGroupByName(awx, instanceGroups[index])
    );
  }

  // get config and go

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");

  var extravars = { ...ev }; // we make a copy of the main extravars
  // merge credentials now
  extravars = { ...extravars, ...credentials };
  extravars = JSON.stringify(extravars);
  // prep the post data
  var postdata = {
    extra_vars: extravars,
  };
  if (awxCredentialList.length > 0) {
    postdata.credentials = awxCredentialList;
  }
  if (executionEnvironment) {
    postdata.execution_environment = executionEnvironment.id;
  }
  if (instanceGroups) {
    postdata.instance_groups = instanceGroupIds.map((x) => x.id);
  }
  if (inventory) {
    postdata.inventory = inventory.id;
  }
  if (check) {
    postdata.job_type = "check";
  } else {
    postdata.job_type = "run";
  }
  if (diff) {
    postdata.diff_mode = true;
  } else {
    postdata.diff_mode = false;
  }
  if (verbose) {
    postdata.verbosity = 3;
  }
  if (limit) {
    postdata.limit = limit;
  }
  if (scmBranch) {
    postdata.scm_branch = scmBranch;
  }
  if (tags) {
    postdata.job_tags = tags;
  }

  logger.notice("Running template : " + template.name);
  // the names only : the values hold the credentials mapped into the template
  logger.info("extravars : " + Object.keys(safeParse(extravars) || {}).join(", "));
  logger.info("inventory : " + inventory);
  logger.info("execution_environment : " + executionEnvironment);
  logger.info("instance_groups : " + instanceGroups);
  logger.info("credentials : " + awxCredentialList);
  logger.info("check : " + check);
  logger.info("diff : " + diff);
  logger.info("verbose : " + verbose);
  logger.info("tags : " + tags);
  logger.info("limit : " + limit);
  logger.info("scm_branch : " + scmBranch);
  // post
  if (template.related === undefined) {
    message = `Failed to launch, no launch attribute found for template ${template.name}`;
    logger.error(message);
    await Job.endJobStatus(jobid, counter + 1, "stderr", "failed", message);
    throw jobEnded(new Errors.ConflictError(message));
  } else {
    // prepare axiosConfig
    const axiosConfig = getAuthorization(awxConfig);
    // logger.debug("Lauching awx with data : " + JSON.stringify(postdata))
    logger.debug("Launching awx template");
    // launch awx job
    var axiosResult;
    try {
      axiosResult = await axios.post(
        awxConfig.uri + template.related.launch,
        postdata,
        axiosConfig
      );
    } catch (error) {
      message = `failed to launch ${template.name}`;
      if (error.response) {
        logger.error("", error.response.data);
        message += "\r\n" + yaml.stringify(error.response.data);
        await Job.endJobStatus(
          jobid,
          counter + 1,
          "stderr",
          // "failed", not "success". endJobStatus writes the status AND sends the status
          // notification built from it, so a template AWX refused to launch (a missing
          // survey variable, a credential that is not prompt-on-launch) mailed everyone
          // "- success" and then a second mail "- failed" once Awx.launch's own catch
          // corrected the row.
          "failed",
          `Failed to launch template ${template.name}. ${message}`
        );
      } else {
        logger.error("Failed to launch : ", error);
        await Job.endJobStatus(
          jobid,
          counter + 1,
          "stderr",
          // "failed", not "success". endJobStatus writes the status AND sends the status
          // notification built from it, so a template AWX refused to launch (a missing
          // survey variable, a credential that is not prompt-on-launch) mailed everyone
          // "- success" and then a second mail "- failed" once Awx.launch's own catch
          // corrected the row.
          "failed",
          `Failed to launch template ${template.name}. ${error}`
        );
      }
      throw jobEnded(new Errors.ApiError(message));
    }

    // get awx job (= remote job !!)
    var job = axiosResult.data;
    if (job) {
      logger.info(`awx job id = ${job.id}`);
      // log launch
      await Job.update({ awx_id: job.id }, jobid);
      await Job.printJobOutput(
        `Launched template ${template.name} with jobid ${job.id}`,
        "stdout",
        jobid,
        ++counter
      );
      // track the job in the background
      return Awx.trackJob(awx, job, jobid, counter + 1);
    } else {
      // no awx job, end failed
      message = `could not launch job template ${template.name}`;
      await Job.endJobStatus(
        jobid,
        counter,
        "stderr",
        "failed",
        `Failed to launch template ${template.name}`
      );
      logger.error(message);
      throw new Errors.ApiError(message);
    }
  }
};

/**
 * Poll an AWX job to completion.
 *
 * This is a LOOP, and must stay one. It used to call itself for the next poll, once a
 * second, for as long as the job ran - so an hour-long template built up ~3600 nested
 * async frames, and every one of them held its own `o` / `previousoutput` alive: AWX has
 * no incremental output, so those are each a full copy of the job's stdout so far. A job
 * with a few MB of output therefore retained hundreds of MB until it finished and the
 * whole chain finally unwound, on top of a real risk of exhausting the stack.
 *
 * Each place that used to recurse now assigns the next iteration's parameters and
 * `continue`s, so only the current poll's output is reachable.
 */
Awx.trackJob = async function (
  awx,
  job,
  jobid,
  counter,
  previousoutput,
  previousoutput2 = undefined,
  lastrun = false,
  retryCount = 0
) {
  // workflow jobs have no stdout of their own, we track them node by node
  if (job.type === "workflow_job" || job.related?.workflow_nodes) {
    return Awx.trackWorkflowJob(awx, job, jobid, counter);
  }
  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  // the stdout of this job was too large to display : told the user once already
  var toldTooLarge = false;
  for (;;) {
  logger.info(`searching for job with id ${job.id}`);
  try {
    // get job info
    const axiosResult = await axios.get(awxConfig.uri + job.url, axiosConfig);
    var j = axiosResult.data;
    if (j) {
      // logger.debug(inspect(j))
      logger.debug(`awx job status : ` + j.status);
      try {
        // get text output
        const o = await Awx.getJobTextOutput(awx, job);

        var incrementIssue = false;
        var output = o;
        // AWX's "too large to display" placeholder (issue #733). The download format that
        // getJobTextOutput reads is not limited, so AWX should never send it ; should one
        // still do, it is no log and is never diffed - as the display format's answer it took
        // the increment-issue path, deleted the last stored chunk and wrote nothing from then
        // on. Say once why the log stops, keep what is stored, and keep polling.
        const tooLarge = isStdoutTooLarge(o);
        if (tooLarge) {
          output = "";
          if (!toldTooLarge) {
            await Job.printJobOutput(o, "stderr", jobid, ++counter);
            toldTooLarge = true;
          }
        } else if (output && previousoutput) {
          // does the previous output fit in the new
          if (output.includes(previousoutput)) {
            output = output.substring(previousoutput.length);
          } else {
            if (output && previousoutput2) {
              // here we have an output problem, the incremental of AWX can sometimes deviate
              // and the last output was wrong, in this case we remove the last output from the db and take the second last output
              // as last reference.
              incrementIssue = true;
              // logger.error("Incremental problem")
              output = output.substring(previousoutput2.length);
            }
          }
        }
        // the increment issue (if true) will remove the last entry before add the new (corrected) one.
        const abort_requested = await Job.printJobOutput(
          output,
          "stdout",
          jobid,
          ++counter,
          incrementIssue
        );
        if (abort_requested) {
          await Job.printJobOutput(
            "Abort requested",
            "stderr",
            jobid,
            ++counter
          );
          try {
            // we try to abort the job
            await Awx.abortJob(awx, j.id);
            await Job.resetAbortRequested(jobid);
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "aborted",
              "Aborted job",
              j.artifacts
            );
            return "Aborted job";
          } catch (error) {
            // 405 : AWX is cancelling already (the abort sent the cancel straight away)
            if (error instanceof Errors.ConflictError) {
              await Job.resetAbortRequested(jobid);
              await Job.endJobStatus(jobid, ++counter, "stderr", "aborted", "Aborted job", j.artifacts);
              return "Aborted job";
            }
            // abort failed... , revert abort request
            await Job.printJobOutput(
              "Abort request denied, reverting abort request",
              "stderr",
              jobid,
              ++counter
            );
            await Job.resetAbortRequested(jobid);
            // next poll (was: recurse) - previousoutput becomes the second last
            job = j;
            ++counter;
            if (!tooLarge) {
              previousoutput2 = previousoutput;
              previousoutput = o;
            }
            lastrun = j.finished;
            retryCount = 0;
            continue;
          }
        } else {
          if (j.finished && lastrun) {
            if (j.status === "successful") {
              await Job.endJobStatus(
                jobid,
                ++counter,
                "stdout",
                "success",
                `Successfully completed template ${j.name}`,
                j.artifacts
              );
              return true;
            } else {
              // if error, end with status (aborted or failed)
              var status = "failed";
              message = `Template ${j.name} completed with status ${j.status}`;
              if (j.status == "canceled") {
                status = "aborted";
                message = `Template ${j.name} was aborted`;
                await Job.resetAbortRequested(jobid);
              }
              await Job.endJobStatus(
                jobid,
                ++counter,
                "stderr",
                status,
                message,
                j.artifacts
              );
              return message;
            }
          } else {
            // not finished, try again
            await delay(1000);
            if (j.finished) {
              logger.debug("Getting final stdout");
            }
            // next poll (was: recurse). After an increment issue the SECOND last output
            // is the reliable reference, so it is the one carried forward.
            job = j;
            ++counter;
            // a placeholder poll changes nothing : the next real output is diffed against
            // the last real one
            if (!tooLarge) {
              previousoutput2 = incrementIssue ? previousoutput2 : previousoutput;
              previousoutput = o;
            }
            lastrun = j.finished;
            retryCount = 0;
            continue;
          }
        }
      } catch (err) {
        message = err.toString();
        logger.error(message);
        retryCount++;
        if (retryCount >= AWX_MAX_RETRIES) {
          return lostContact(jobid, counter + 1, job, message);
        } else {
          logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
          await delay(1000);
          // retry the SAME poll : job, counter and both outputs stay as they were
          continue;
        }
      }
    } else {
      message = `could not find job with id ${job.id}`;
      logger.error(message);
      retryCount++;
      if (retryCount >= AWX_MAX_RETRIES) {
        return lostContact(jobid, counter + 1, job, message);
      } else {
        logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
        await delay(1000);
        // retry the SAME poll, as above
        continue;
      }
    }
  } catch (e) {
    logger.error("Failed to track job : ", e);
    return lostContact(jobid, counter + 1, job, e.message);
  }
  }
};
// format a workflow (node) status line ; Helpers.formatOutput() colors these by status
function workflowStatusLine(prefix, name, status, banner = false) {
  var line = `${prefix} [${name}] (${status})`;
  if (banner) line += " " + "*".repeat(Math.max(5, 79 - line.length));
  return line;
}
// get the nodes of an awx workflow job, simplified to what we need for output and visualization
Awx.getWorkflowNodes = async function (awx, job) {
  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  if (!job.related?.workflow_nodes) return [];
  const axiosConfig = getAuthorization(awxConfig);
  var results = [];
  var url = job.related.workflow_nodes;
  // the node list is paginated, follow the next links
  while (url) {
    const axiosResult = await axios.get(awxConfig.uri + url, axiosConfig);
    results = results.concat(axiosResult.data?.results || []);
    url = axiosResult.data?.next;
  }
  return results.map((n) => ({
    id: n.id,
    name:
      n.summary_fields?.job?.name ||
      n.summary_fields?.unified_job_template?.name ||
      `node ${n.id}`,
    type:
      n.summary_fields?.job?.type ||
      n.summary_fields?.unified_job_template?.unified_job_type ||
      "job",
    status:
      n.summary_fields?.job?.status || (n.do_not_run ? "skipped" : "pending"),
    elapsed: n.summary_fields?.job?.elapsed || 0,
    job: n.job,
    job_url: n.related?.job,
    success_nodes: n.success_nodes || [],
    failure_nodes: n.failure_nodes || [],
    always_nodes: n.always_nodes || [],
    do_not_run: n.do_not_run || false,
  }));
};
// track an awx workflow job ; poll the workflow nodes, dump the output of every
// finished node and store the workflow graph as json for visualization
Awx.trackWorkflowJob = async function (
  awx,
  job,
  jobid,
  counter,
  printedNodeIds = [],
  previousWorkflowJson = "",
  retryCount = 0
) {
  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  const axiosConfig = getAuthorization(awxConfig);
  for (;;) {
    try {
      // get workflow job info
      const axiosResult = await axios.get(awxConfig.uri + job.url, axiosConfig);
      var j = axiosResult.data;
      if (!j) throw new Error(`could not find workflow job with id ${job.id}`);
      logger.debug(`awx workflow job status : ` + j.status);
      // get the workflow nodes
      const nodes = await Awx.getWorkflowNodes(awx, j);
      // store the workflow graph json, the client uses this to visualize the workflow
      const workflowJson = JSON.stringify({
        id: j.id,
        name: j.name,
        status: j.status,
        nodes,
      });
      if (workflowJson != previousWorkflowJson) {
        await Job.update({ awx_workflow: workflowJson }, jobid);
      }
      // dump the output of the nodes that just finished (in completion order)
      const finishedStatuses = ["successful", "failed", "error", "canceled"];
      const finishedNodes = nodes.filter(
        (n) =>
          n.job &&
          finishedStatuses.includes(n.status) &&
          !printedNodeIds.includes(n.id)
      );
      for (const node of finishedNodes) {
        var nodeOutput = "";
        try {
          // get the child job (job, project_update, workflow_approval, ...) and grab its output
          const childResult = await axios.get(
            awxConfig.uri + node.job_url,
            axiosConfig
          );
          nodeOutput =
            (await Awx.getJobTextOutput(awx, childResult.data)) || "";
        } catch (e) {
          logger.warning(
            `Failed to get output of workflow node ${node.name} : ${e.message}`
          );
        }
        const banner = workflowStatusLine(
          "WORKFLOW NODE",
          node.name,
          node.status,
          true
        );
        await Job.printJobOutput(
          `${banner}\n${nodeOutput}`.trim(),
          "stdout",
          jobid,
          ++counter
        );
        printedNodeIds.push(node.id);
      }
      // check for abort request
      const abort_requested = await Job.isAbortRequested(jobid);
      if (abort_requested) {
        await Job.printJobOutput("Abort requested", "stderr", jobid, ++counter);
        try {
          // we try to abort the workflow job
          await Awx.abortJob(awx, j.id, true);
          await Job.resetAbortRequested(jobid);
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stderr",
            "aborted",
            "Aborted workflow job"
          );
          return "Aborted workflow job";
        } catch (error) {
          // 405 : AWX is cancelling already (the abort sent the cancel straight away)
          if (error instanceof Errors.ConflictError) {
            await Job.resetAbortRequested(jobid);
            await Job.endJobStatus(jobid, ++counter, "stderr", "aborted", "Aborted workflow job");
            return "Aborted workflow job";
          }
          // abort failed... , revert abort request
          await Job.printJobOutput(
            "Abort request denied, reverting abort request",
            "stderr",
            jobid,
            ++counter
          );
          await Job.resetAbortRequested(jobid);
        }
      }
      if (j.finished) {
        // print a summary of all the nodes with their status
        var summary = [workflowStatusLine("WORKFLOW", j.name, j.status, true)];
        nodes.forEach((node) => {
          summary.push(workflowStatusLine("WORKFLOW NODE", node.name, node.status));
        });
        await Job.printJobOutput(summary.join("\n"), "stdout", jobid, ++counter);
        if (j.status === "successful") {
          await Job.endJobStatus(
            jobid,
            ++counter,
            "stdout",
            "success",
            `Successfully completed workflow ${j.name}`
          );
          return true;
        } else {
          // if error, end with status (aborted or failed)
          var status = "failed";
          var message = `Workflow ${j.name} completed with status ${j.status}`;
          if (j.status == "canceled") {
            status = "aborted";
            message = `Workflow ${j.name} was aborted`;
            await Job.resetAbortRequested(jobid);
          }
          await Job.endJobStatus(jobid, ++counter, "stderr", status, message);
          return message;
        }
      }
      // not finished, try again : a loop, not a call per second, so a workflow that runs for
      // hours does not hold one stack frame (and its node list) for every poll
      await delay(1000);
      job = j;
      counter++;
      previousWorkflowJson = workflowJson;
      retryCount = 0;
    } catch (err) {
      const message = err.toString();
      logger.error(message);
      retryCount++;
      if (retryCount >= AWX_MAX_RETRIES) {
        return lostContact(jobid, counter + 1, job, message);
      }
      logger.warning(`Retrying jobid ${jobid} [${retryCount}]`);
      await delay(1000);
    }
  }
};
Awx.getJobTextOutput = async function (awx, job) {
  if (!job) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  if (job.related === undefined) {
    throw new Errors.ConflictError(
      "No related attribute found for job " + job.id
    );
  } else {
    if (!job.related.stdout) {
      // workflow job... just return status
      return job.status;
    }
    // prepare axiosConfig
    const axiosConfig = getAuthorization(awxConfig);
    // txt_download, not txt : the display formats are refused above AWX's
    // STDOUT_MAX_BYTES_DISPLAY (1 MB by default) with a placeholder instead of the log
    // (issue #733), the download formats are not limited. Below the limit both return the
    // same plain text, in the same time.
    const axiosResult = await axios.get(
      awxConfig.uri + job.related.stdout + "?format=txt_download",
      { ...axiosConfig, responseType: "text" }
    );
    return axiosResult.data;
  }
};
Awx.findJobTemplateByName = async function (awx, name) {
  if (!name) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  logger.info(`searching job template ${name}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  var axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/job_templates/?name=" +
      encodeURIComponent(name),
    axiosConfig
  );
  var job_template = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (job_template) {
    return job_template;
  } else {
    logger.info("Template not found, looking for workflow job template");
    // trying workflow job templates
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/workflow_job_templates/?name=" +
        encodeURIComponent(name),
      axiosConfig
    );
    job_template = axiosResult.data.results.find(function (x) {
      return x.name == name;
    });
    if (job_template) {
      return job_template;
    } else {
      message = `could not find job template ${name}`;
      logger.error(message);
      throw new Errors.NotFoundError(message);
    }
  }
};
Awx.findCredentialByName = async function (awx, name) {
  if (!name) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  logger.info(`searching credential ${name}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  const axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/credentials/?name=" +
      encodeURIComponent(name),
    axiosConfig
  );
  var credential = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (credential) {
    return credential.id;
  } else {
    message = `could not find credential ${name}`;
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findExecutionEnvironmentByName = async function (awx, name) {
  if (!name) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  logger.info(`searching execution environment ${name}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  message = `could not find execution environment ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/execution_environments/?name=" +
        encodeURIComponent(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var execution_environment = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (execution_environment) {
    return execution_environment;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findInstanceGroupByName = async function (awx, name) {
  if (!name) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  logger.info(`searching instance group ${name}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  message = `could not find instance group ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/instance_groups/?name=" +
        encodeURIComponent(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var instance_group = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (instance_group) {
    return instance_group;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};
Awx.findCredentialsByTemplate = async function (awx, id) {
  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  logger.info(`searching credentials for template id ${id}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  const axiosResult = await axios.get(
    awxConfig.uri +
      appConfig.awxApiPrefix +
      "/job_templates/" +
      id +
      "/credentials/",
    axiosConfig
  );
  if (axiosResult.data?.results?.length) {
    return axiosResult.data.results.map((x) => x.id);
  }
  return [];
};
Awx.findInventoryByName = async function (awx, name) {
  if (!name) return undefined;

  const awxConfig = awx;
  if (!awxConfig) throw new Errors.ApiError("No AWX runner given");
  var message;
  logger.info(`searching inventory ${name}`);
  // prepare axiosConfig
  const axiosConfig = getAuthorization(awxConfig);
  message = `could not find inventory ${name}`;
  var axiosResult;
  try {
    axiosResult = await axios.get(
      awxConfig.uri +
        appConfig.awxApiPrefix +
        "/inventories/?name=" +
        encodeURIComponent(name),
      axiosConfig
    );
  } catch (error) {
    throw new Errors.ApiError(`${message}, ${error.message}`);
  }
  var inventory = axiosResult.data.results.find(function (x) {
    return x.name == name;
  });
  if (inventory) {
    return inventory;
  } else {
    logger.error(message);
    throw new Errors.NotFoundError(message);
  }
};

export { Awx };
export default Awx;
