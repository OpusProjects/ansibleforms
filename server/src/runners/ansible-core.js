// The one place a playbook is run : the local runner (in the app) and, later, the RTE call
// runAnsibleJob with nothing but a job id. Everything it needs is in the jobs row and the
// database (credentials, secret stores), so where it runs makes no difference to the result.
//
// The approval gate is NOT here : a job reaches this module only once it may run
// (runners/orchestrator.js).
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import logger from "../lib/logger.js";
import Cmd from "../lib/cmd.js";
import Helpers from "../lib/common.js";
import { safeParse } from "../lib/safejson.js";
import ansibleConfig from "../../config/ansible.config.js";
import appConfig from "../../config/app.config.js";
import Repository from "../models/repository.model.js";
import Credential from "../models/credential.model.v2.js";
import mysql from "../models/db.model.js";
// a cycle (job.model imports the orchestrator, which reaches this module) ; harmless, Job is
// only used when a playbook runs, long after both modules have loaded
import Job from "../models/job.model.js";

/**
 * Who runs the process, stored in jobs.host while it runs. An RTE has its own name
 * (RTE_ID, default rte-<hostname>), so an RTE on the same machine as the app is never
 * taken for it - each only abandons its own jobs when it restarts.
 */
export function runnerIdentity() {
  if (process.env.AF_ROLE === "rte") return process.env.RTE_ID || `rte-${os.hostname()}`;
  return os.hostname();
}

/** the last output line written for a job ; the next one is this + 1 */
export async function lastOrder(jobId) {
  const res = await mysql.do("SELECT COALESCE(MAX(`order`),0) AS last FROM AnsibleForms.`job_output` WHERE job_id=?", [jobId]);
  return Number(res?.[0]?.last) || 0;
}

/** the folder the playbook runs from : the playbooks repository, else ANSIBLE_PATH, plus the sub path */
export async function resolvePlaybookDirectory(playbookSubPath = "") {
  let directory = await Repository.getAnsiblePath();
  directory = directory || ansibleConfig.path;
  if (playbookSubPath) {
    directory = path.join(directory, playbookSubPath);
  }
  return directory;
}

/**
 * The ansible-playbook arguments for a job's extravars. No shell runs them, so no value
 * needs quoting ; the vault password is not among them (it goes in on stdin).
 */
export function buildAnsibleArgs(extravars, { extravarsFileName, hiddenExtravarsFileName, vaultPassword = "" }) {
  // ansible can have multiple inventories ; the main one is listed twice, as it always
  // was - ansible reads an inventory once however often it is named
  const inventory = [];
  const invent = extravars?.__inventory__;
  if (invent) {
    inventory.push(invent);
  }
  if (extravars["__inventory__"]) {
    [].concat(extravars["__inventory__"]).forEach((item) => {
      if (typeof item == "string") {
        inventory.push(item);
      } else {
        logger.warning("Non-string inventory entry");
      }
    });
  }
  const tags = extravars?.__tags__ || "";
  const check = extravars?.__check__ || false;
  const verbose = extravars?.__verbose__ || false;
  const limit = extravars?.__limit__ || "";
  const diff = extravars?.__diff__ || false;

  // each argument is text the way the quoted shell string made it : a list becomes "a,b"
  const arg = (value) => String(value ?? "");
  const args = ["-e", `@${extravarsFileName}`, "-e", `@${hiddenExtravarsFileName}`];
  if (vaultPassword) {
    // read from stdin, never from a file or the command line
    args.push("--vault-password-file=/bin/cat");
  }
  inventory.forEach((item) => {
    args.push("-i", arg(item));
  });
  if (tags) {
    args.push("-t", arg(tags));
  }
  if (check) {
    args.push("--check");
  }
  if (diff) {
    args.push("--diff");
  }
  if (verbose) {
    args.push("-vvv");
  }
  if (limit) {
    args.push("--limit", arg(limit));
  }
  args.push(arg(extravars?.__playbook__));
  return { args, inventory };
}

/**
 * Runs a job's playbook : reads the row, resolves its credentials, writes the extravars
 * files, runs ansible-playbook and writes its output and final status to the database.
 * Resolves true on success, false otherwise (the job row says why).
 */
export async function runAnsibleJob({ jobId }) {
  const rows = await mysql.do("SELECT extravars, credentials FROM AnsibleForms.`jobs` WHERE id=?", [jobId]);
  if (!rows?.length) throw new Error(`Job ${jobId} does not exist`);
  const extravars = safeParse(rows[0].extravars, {}, `job.extravars id=${jobId}`);
  const creds = safeParse(rows[0].credentials, {}, `job.credentials id=${jobId}`);
  // stored before the id was known
  extravars.__jobid__ = jobId;
  // credentials passed through extravars have precedence over the others
  const credentials = await Credential.resolveCredentialMap(extravars.__credentials__ || creds || {});
  return launchPlaybook(extravars, credentials, jobId, await lastOrder(jobId));
}

async function launchPlaybook(ev, credentials, jobid, counter) {
  // we make a copy, we don't want to mutate the original
  var extravars = { ...ev };
  var playbook = extravars?.__playbook__;
  var keepExtravars = extravars?.__keepExtravars__ || false;
  var ansibleCredentials = extravars?.__ansibleCredentials__ || "";
  var vaultCredentials = extravars?.__vaultCredentials__ || "";
  var playbookSubPath = extravars?.__playbookSubPath__ || "";
  // merge credentials now
  const merged = { ...extravars, ...credentials };
  // define hiddenExtravars
  var hiddenExtravars = {};
  try {
    if (ansibleCredentials) {
      const runCredential = await Credential.resolveCredential(ansibleCredentials);
      hiddenExtravars.ansible_user = runCredential.user;
      hiddenExtravars.ansible_password = runCredential.password;
    }
    hiddenExtravars = JSON.stringify(hiddenExtravars);
  } catch (err) {
    logger.error("Failed to get ansible credentials : ", err);
    await Job.endJobStatus(
      jobid,
      counter + 1,
      "stderr",
      "failed",
      "[ERROR]: Failed to get ansible credentials"
    );
    return false;
  }
  // define vaultPassword
  var vaultPassword = "";
  try {
    if (vaultCredentials) {
      const vaultCredential = await Credential.resolveCredential(vaultCredentials);
      vaultPassword = vaultCredential.password;
    }
  } catch (err) {
    logger.error("Failed to get vault credentials : ", err);
    await Job.endJobStatus(
      jobid,
      counter + 1,
      "stderr",
      "failed",
      "[ERROR]: Failed to get vault credentials"
    );
    return false;
  }
  const extravarsFileName = `extravars_${jobid}.json`;
  const hiddenExtravarsFileName = `he_${extravarsFileName}`;
  logger.debug(`Extravars File: ${extravarsFileName}`);
  const { args, inventory } = buildAnsibleArgs(extravars, { extravarsFileName, hiddenExtravarsFileName, vaultPassword });
  var cmdObj = {
    directory: await resolvePlaybookDirectory(playbookSubPath),
    file: "ansible-playbook",
    args: args,
    stdin: vaultPassword,
    description: "Running playbook",
    task: "Playbook",
    extravars: JSON.stringify(merged),
    hiddenExtravars: hiddenExtravars,
    extravarsFileName: extravarsFileName,
    hiddenExtravarsFileName: hiddenExtravarsFileName,
    keepExtravars: keepExtravars,
  };

  logger.notice("Running from directory : " + cmdObj.directory);
  logger.notice("Running playbook : " + playbook);
  // the keys only : the values include the resolved credentials
  logger.debug("extravars : " + Object.keys(merged).join(", "));
  logger.debug("inventory : " + inventory);
  try {
    await executeCommand(cmdObj, jobid, counter);
    return true;
  } catch (err) {
    logger.error("Ansible job failed : ", err);
    return false;
  }
}

export function executeCommand(cmd, jobid, counter) {
  // a counter to order the output (as it's very fast and the database can mess up the order)
  var jobstatus = "success";
  // a program and its arguments, run without a shell : form values never pass through one
  var file = cmd.file;
  var args = cmd.args || [];
  // written to the process's stdin, then closed (the vault password ; ansible reads it
  // with --vault-password-file=/bin/cat)
  var stdin = cmd.stdin || "";
  var directory = cmd.directory;
  var description = cmd.description;
  var extravars = cmd.extravars;
  var hiddenExtravars = cmd.hiddenExtravars;
  var extravarsFileName = cmd.extravarsFileName;
  var hiddenExtravarsFileName = cmd.hiddenExtravarsFileName;
  var keepExtravars = cmd.keepExtravars;
  var task = cmd.task;
  const ac = new AbortController();
  // the abort flag lives in the database (Job.abort sets it), so whoever runs the process
  // - this host or another - notices it here and stops the playbook itself
  let killed = false;
  let abortPoll = null;

  // execute the procces
  return new Promise((resolve, reject) => {
    logger.debug(`${description}, ${directory} > ${Helpers.logSafe([file, ...args].join(" "))}`);
    try {
      if (extravarsFileName) {
        logger.debug(`Storing extravars to file ${extravarsFileName}`);
        var filepath = path.join(directory, extravarsFileName);
        fs.writeFileSync(filepath, extravars);

        logger.debug(
          `Storing hidden extravars to file ${hiddenExtravarsFileName}`
        );
        var he_filepath = path.join(directory, hiddenExtravarsFileName);
        fs.writeFileSync(he_filepath, hiddenExtravars);
      } else {
        logger.warning("No filename was given");
      }

      // adding abort signal
      // spawn, not exec : no shell, and exec ignores `detached`. Detached, the process runs
      // in its own process group, so stopping it stops ansible-playbook and all its workers.
      var child = spawn(file, args, {
        cwd: directory,
        signal: ac.signal,
        detached: true,
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      // a playbook that prompts gets end-of-input instead of waiting for ever
      child.stdin.on("error", (e) => logger.debug(`[Job ${jobid}] stdin : ${e.message}`));
      child.stdin.end(stdin);

      const stopProcess = (why) => {
        if (killed) return;
        killed = true;
        logger.warning(`[Job ${jobid}] ${why}, stopping the playbook`);
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (e) {
          // no process group (already gone, or a platform without them) : walk the tree
          logger.debug(`[Job ${jobid}] Process group kill failed : ${e.message}`);
          Cmd.killChildren(child.pid);
        }
      };
      const stopIfAborted = (abortRequested) => {
        if (abortRequested) stopProcess("Abort requested");
      };
      // exec stopped a process whose output on one stream passed maxBuffer ; kept, so a
      // playbook with that much output still ends the way it did (the 'main process'
      // message below, since nobody requested an abort)
      const outputBytes = { stdout: 0, stderr: 0 };
      const countOutput = (stream, data) => {
        outputBytes[stream] += Buffer.byteLength(data);
        if (outputBytes[stream] > appConfig.processMaxBuffer) stopProcess(`Output passed PROCESS_MAX_BUFFER (${appConfig.processMaxBuffer} bytes)`);
      };
      // a quiet playbook writes no output for minutes, so the flag is also polled
      abortPoll = setInterval(() => {
        Job.isAbortRequested(jobid)
          .then(stopIfAborted)
          .catch((e) => logger.debug(`[Job ${jobid}] Abort check failed : ${e.message}`));
      }, 2000);

      // Store the process ID and host identifier in the database for job control
      if (child.pid) {
        const hostname = runnerIdentity();
        logger.info(`[Job ${jobid}] Process started with PID: ${child.pid} on host: ${hostname}`);
        mysql.do("UPDATE AnsibleForms.`jobs` SET pid=?, host=? WHERE id=?", [child.pid, hostname, jobid])
          .then(() => {
            logger.debug(`[Job ${jobid}] PID ${child.pid} and host ${hostname} stored in database`);
          })
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to store PID and host in database: ${err.message}`);
          });
      }

      // capture the abort event, logging only
      ac.signal.addEventListener(
        "abort",
        () => {
          logger.warning("Operator aborted the process");
        },
        { once: true }
      );

      // add output eventlistener to the process to save output
      child.stdout.on("data", function (data) {
        countOutput("stdout", data);
        // save the output to database
        Job.createOutput({
          output: data,
          output_type: "stdout",
          job_id: jobid,
          order: ++counter,
        })
          .then(stopIfAborted)
          .catch((error) => {
            logger.error("Failed to create output : ", error);
          });
      });
      // add error eventlistener to the process to save output
      child.stderr.on("data", async function (data) {
        countOutput("stderr", data);
        // save the output to database
        try {
          stopIfAborted(await Job.createOutput({
            output: data,
            output_type: "stderr",
            job_id: jobid,
            order: ++counter,
          }));
        } catch (error) {
          logger.error("Failed to create output: ", error);
        }
      });

      // add exit eventlistener to the process to handle status update
      child.on("exit", async function (data) {
        clearInterval(abortPoll);
        // Clear the PID and host from the database as the process has ended
        logger.debug(`[Job ${jobid}] Process with PID ${child.pid} has exited`);
        await mysql.do("UPDATE AnsibleForms.`jobs` SET pid=NULL, host=NULL WHERE id=?", [jobid])
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to clear PID and host from database: ${err.message}`);
          });
        
        // if the exit was an actual request ; set aborted
        if (child.signalCode == "SIGTERM") {
          const abort_requested = await Job.isAbortRequested(jobid);
          if (abort_requested) {
            await Job.resetAbortRequested(jobid); // reset the abort requested flag
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "aborted",
              `${task} was aborted by the operator`
            );
            reject(`${task} was aborted by the operator`);
          } else {
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              "failed",
              `${task} was aborted by the main process.  Likely some buffer or memory error occured.  Also check the maxBuffer option.`
            );
            reject(`${task} was aborted by the main process`);
          }
        } else {
          // if the exit was natural; set the jobstatus (either success or failed)
          if (data != 0) {
            jobstatus = "failed";
            logger.error(`[${jobid}] Failed with code ${data}`);
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stderr",
              jobstatus,
              `[ERROR]: ${task} failed with status (${data})`
            );
            reject(`${task} failed with status (${data})`);
          } else {
            await Job.endJobStatus(
              jobid,
              ++counter,
              "stdout",
              jobstatus,
              `ok: [${task} finished] with status (${data})`
            );
            resolve(true);
          }
        }
        if (extravarsFileName && !keepExtravars) {
          logger.debug(`Removing extavars file ${filepath}`);
          fs.unlinkSync(filepath);
        }
        if (hiddenExtravarsFileName) {
          fs.unlinkSync(he_filepath);
        }
      });
      // add error eventlistener to the process; set failed
      child.on("error", async function (data) {
        clearInterval(abortPoll);
        // Clear the PID and host from the database as the process has errored
        logger.debug(`[Job ${jobid}] Process with PID ${child.pid} encountered an error`);
        await mysql.do("UPDATE AnsibleForms.`jobs` SET pid=NULL, host=NULL WHERE id=?", [jobid])
          .catch((err) => {
            logger.error(`[Job ${jobid}] Failed to clear PID and host from database: ${err.message}`);
          });
        
        await Job.endJobStatus(
          jobid,
          ++counter,
          "stderr",
          "failed",
          `${task} failed : ` + data
        );
      });
    } catch (e) {
      clearInterval(abortPoll);
      Job.endJobStatus(
        jobid,
        ++counter,
        "stderr",
        "failed",
        `${task} failed : ` + e
      );
      reject();
    }
  });
}
