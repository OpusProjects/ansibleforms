'use strict';

import { Cron } from 'croner';
import logger from '../lib/logger.js';
import mysql from '../models/db.model.js';
import Repository from '../models/repository.model.js';
import Lock from '../models/lock.model.js';
import Schedule from '../models/schedule.model.js';
import Runner from '../models/runner.model.js';
// imported rather than injected like Job/Token/BackupModel : audit.model only pulls
// in the db pool and the logger, so there is no cycle to avoid here
import Audit from '../models/audit.model.js';
// same reasoning as Audit : lib/seed pulls in the models and the logger, and nothing it
// touches imports this service back, so there is no cycle to avoid by injecting it
import { reloadConfigSeed } from '../lib/seed.js';
import logConfig from '../../config/log.config.js';
import dayjs from 'dayjs';
import { forgetOldNodes } from '../lib/nodes.js';
import { nodeId } from '../lib/role.js';

// the cron registry is re-read from the database this often even without a change notice
// (lib/epochs.js), in case one was missed
const RESYNC_SAFETY_MS = 5 * 60 * 1000;

const scheduleSignature = (oneTimeRun, cron, runAt) =>
  `${oneTimeRun}|${cron || ''}|${runAt ? new Date(runAt).getTime() : ''}`;

/**
 * Centralized Cron Service
 * Manages all scheduled tasks for repositories and schedules
 * Uses the application timezone from LOG_TZ (via log.config.js)
 *
 * It runs in the worker only (the process holding the worker lock) : `active` turns on when
 * the worker starts it (initializeAll). Until then every add/remove is a no-op, so the
 * controllers can call it in any process - in an app node the change reaches the worker
 * through the database (resync, on the change notice of lib/epochs.js).
 */
class CronService {
  constructor() {
    this.jobs = {
      repositories: new Map(),
      schedules: new Map(),
      system: new Map() // For maintenance tasks
    };
    // what each registered entry was built from, so a resync only touches what changed
    this.signatures = {
      repositories: new Map(),
      schedules: new Map(),
    };
    this.active = false;
    // the system tasks (initializeSystemTasks) run on this node : what scheduleConfigSeedReload
    // checks before rescheduling
    this.systemTasksStarted = false;
    this.lastResync = null;
    this.safetyTimer = null;
    this.timezone = logConfig.tz;
    logger.info(`Cron service initialized with timezone: ${this.timezone}`);
  }

  /**
   * Validate a cron expression
   */
  validateCronExpression(cronExpression) {
    try {
      // Try to create a Cron instance - it will throw if invalid
      const test = new Cron(cronExpression, { paused: true });
      test.stop();
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Add or update a repository cron job
   */
  addRepository(name, cronExpression) {
    if (!this.active) return;
    try {
      // Remove existing job if any
      this.removeRepository(name);

      if (!cronExpression || cronExpression.trim() === '') {
        logger.debug(`No cron expression for repository ${name}, skipping`);
        return;
      }

      // Validate cron expression
      if (!this.validateCronExpression(cronExpression)) {
        logger.error(`Invalid cron expression for repository ${name}: ${cronExpression}`);
        return;
      }

      // Create new cron job with Croner
      const task = new Cron(cronExpression, {
        timezone: this.timezone,
        paused: true,
        protect: true // Prevent overlapping runs
      }, async () => {
        logger.info(`Cron triggered for repository: ${name}`);
        try {
          // Check if repository is already running
          const repos = await mysql.do(
            "SELECT status FROM AnsibleForms.`repositories` WHERE name=? AND COALESCE(status,'')<>'running'",
            [name],
            true
          );
          
          if (repos.length > 0) {
            // skip the pull while the designer holds the lock : it is editing the
            // working trees and may write form files at any moment ; a git pull
            // racing those writes could corrupt them (issue #414)
            if (await Lock.isHeld()) {
              logger.debug(`Designer lock held, skipping cron pull for ${name}`);
            } else if (await Repository.hasLocalChanges(name)) {
              // skip the pull while the working tree has uncommitted/unpushed
              // changes (e.g. the designer is mid-edit) : pulling would conflict
              // and flip the status to 'failed' on every tick
              logger.debug(`Repository ${name} has local changes, skipping cron pull`);
            } else {
              await Repository.pull(name).catch((e) => {
                logger.error(`Failed to pull repository ${name}:`, e);
              });
            }
          } else {
            logger.debug(`Repository ${name} is already running, skipping cron execution`);
          }
        } catch (err) {
          logger.error(`Error in repository cron job for ${name}:`, err);
        }
      });

      task.resume();
      this.jobs.repositories.set(name, task);
      this.signatures.repositories.set(name, cronExpression);
      logger.info(`Added cron job for repository: ${name} with schedule: ${cronExpression}`);
    } catch (err) {
      logger.error(`Failed to add repository cron job for ${name}:`, err);
    }
  }

  /**
   * Remove a repository cron job
   */
  removeRepository(name) {
    this.signatures.repositories.delete(name);
    const task = this.jobs.repositories.get(name);
    if (task) {
      task.stop();
      this.jobs.repositories.delete(name);
      logger.info(`Removed cron job for repository: ${name}`);
    }
  }

  /**
   * Add or update a schedule cron job
   */
  addSchedule(id, name, cronExpression, oneTimeRun, runAt) {
    if (!this.active) return;
    try {
      // Remove existing job if any
      this.removeSchedule(id);

      if (oneTimeRun === 1 && runAt) {
        // One-time schedule: check every minute if it's time to run
        const task = new Cron('* * * * *', {
          timezone: this.timezone,
          paused: true,
          protect: true
        }, async () => {
          logger.debug(`Checking one-time schedule: ${name} (ID: ${id})`);
          try {
            const schedules = await mysql.do(
              "SELECT id, run_at FROM AnsibleForms.`schedule` WHERE id=? AND COALESCE(state,'')<>'running' AND COALESCE(state,'')<>'queued'",
              [id],
              true
            );
            
            if (schedules.length > 0) {
              const schedule = schedules[0];
              const runAtTime = dayjs(schedule.run_at);
              const now = dayjs();
              
              if (runAtTime.isBefore(now) || runAtTime.isSame(now, 'minute')) {
                logger.info(`One-time schedule triggered: ${name} (ID: ${id})`);
                await Schedule.queue(id);
              }
            }
          } catch (err) {
            logger.error(`Error in one-time schedule cron job for ${name} (ID: ${id}):`, err);
          }
        });

        task.resume();
        this.jobs.schedules.set(id, task);
        this.signatures.schedules.set(id, scheduleSignature(oneTimeRun, cronExpression, runAt));
        logger.info(`Added one-time schedule job for: ${name} (ID: ${id}) to run at: ${runAt}`);
      } else if (oneTimeRun === 0 && cronExpression && cronExpression.trim() !== '') {
        // Recurring cron schedule
        // Validate cron expression
        if (!this.validateCronExpression(cronExpression)) {
          logger.error(`Invalid cron expression for schedule ${name} (ID: ${id}): ${cronExpression}`);
          return;
        }

        const task = new Cron(cronExpression, {
          timezone: this.timezone,
          paused: true,
          protect: true
        }, async () => {
          logger.info(`Cron triggered for schedule: ${name} (ID: ${id})`);
          try {
            // Check if schedule is already running or queued
            const schedules = await mysql.do(
              "SELECT id FROM AnsibleForms.`schedule` WHERE id=? AND COALESCE(state,'')<>'running' AND COALESCE(state,'')<>'queued'",
              [id],
              true
            );
            
            if (schedules.length > 0) {
              await Schedule.queue(id);
            } else {
              logger.debug(`Schedule ${name} (ID: ${id}) is already running or queued, skipping cron execution`);
            }
          } catch (err) {
            logger.error(`Error in schedule cron job for ${name} (ID: ${id}):`, err);
          }
        });

        task.resume();
        this.jobs.schedules.set(id, task);
        this.signatures.schedules.set(id, scheduleSignature(oneTimeRun, cronExpression, runAt));
        logger.info(`Added cron job for schedule: ${name} (ID: ${id}) with schedule: ${cronExpression}`);
      }
    } catch (err) {
      logger.error(`Failed to add schedule cron job for ${name} (ID: ${id}):`, err);
    }
  }

  /**
   * Remove a schedule cron job
   */
  removeSchedule(id) {
    this.signatures.schedules.delete(id);
    const task = this.jobs.schedules.get(id);
    if (task) {
      task.stop();
      this.jobs.schedules.delete(id);
      logger.info(`Removed cron job for schedule ID: ${id}`);
    }
  }

  /**
   * Initialize all cron jobs from database : the worker's start. From here on the registry
   * follows the database (resync).
   */
  async initializeAll() {
    logger.info('Initializing all cron jobs from database...');
    this.active = true;
    await this.resync();
    if (!this.safetyTimer) {
      this.safetyTimer = setInterval(() => {
        this.resync().catch((err) => logger.error('Cron resync failed:', err));
      }, RESYNC_SAFETY_MS);
      this.safetyTimer.unref?.();
    }
    logger.info('Cron service initialization complete');
  }

  /**
   * Make the registry match the database : add what is new, rebuild what changed, drop what
   * is gone. A schedule or repository changed on any app node, or by the seed, gets here.
   */
  async resync() {
    if (!this.active) return;
    try {
      const repositories = await mysql.do(
        "SELECT name, cron FROM AnsibleForms.`repositories` WHERE cron<>''",
        undefined,
        true
      );
      const wanted = new Map(repositories.map(r => [r.name, r.cron]));
      for (const name of [...this.jobs.repositories.keys()]) {
        if (!wanted.has(name)) this.removeRepository(name);
      }
      for (const [name, cron] of wanted) {
        if (this.signatures.repositories.get(name) !== cron) this.addRepository(name, cron);
      }
      logger.debug(`Repository cron jobs in sync : ${this.jobs.repositories.size}`);
    } catch (err) {
      logger.error('Failed to sync the repository cron jobs:', err);
    }

    try {
      const schedules = await mysql.do(
        "SELECT id, name, one_time_run, cron, run_at FROM AnsibleForms.`schedule` WHERE (one_time_run=0 AND cron<>'') OR (one_time_run=1 AND run_at IS NOT NULL)",
        undefined,
        true
      );
      const wanted = new Map(schedules.map(r => [r.id, r]));
      for (const id of [...this.jobs.schedules.keys()]) {
        if (!wanted.has(id)) this.removeSchedule(id);
      }
      for (const [id, r] of wanted) {
        if (this.signatures.schedules.get(id) !== scheduleSignature(r.one_time_run, r.cron, r.run_at)) {
          this.addSchedule(r.id, r.name, r.cron, r.one_time_run, r.run_at);
        }
      }
      logger.debug(`Schedule cron jobs in sync : ${this.jobs.schedules.size}`);
    } catch (err) {
      logger.error('Failed to sync the schedule cron jobs:', err);
    }
    this.lastResync = new Date();
  }

  /**
   * Initialize system maintenance tasks
   * These are internal maintenance jobs (not from database)
   */
  async initializeSystemTasks(Job, Token, BackupModel, appConfig) {
    logger.info('Initializing system maintenance tasks...');
    // never twice : a replaced task that is not stopped keeps firing next to its successor
    this.jobs.system.forEach((task) => task.stop());
    this.jobs.system.clear();

    // 1. Abandoned jobs cleanup - runs every hour
    const abandonedJobsTask = new Cron('0 * * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      logger.info('Running abandoned jobs cleanup');
      try {
        const changed = await Job.abandon();
        if (changed > 0) {
          logger.warning(`Abandoned ${changed} jobs`);
        }
      } catch (err) {
        logger.error('Failed to abandon jobs:', err);
      }
    });
    this.jobs.system.set('abandonedJobs', abandonedJobsTask);
    logger.info('Initialized abandoned jobs cleanup (hourly)');

    // 1b. The jobs of an app node that stopped answering - every minute. The node that follows
    // a job (jobs.tracker) ends it itself when it restarts, but a replaced container comes back
    // under another name, or not at all.
    const deadNodesTask = new Cron('* * * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      try {
        const changed = await Job.abandonDeadNodes(nodeId);
        if (changed > 0) {
          logger.warning(`Abandoned ${changed} jobs followed by a node that stopped answering`);
        }
      } catch (err) {
        logger.error('Failed to abandon the jobs of stopped nodes:', err);
      }
      // and the claims they held : a repository left 'running' refuses every pull and save, a
      // schedule left 'running' stops the whole queue
      try {
        const repos = await Repository.releaseStaleClaims();
        if (repos > 0) logger.warning(`Released ${repos} repository claim(s) held by a node that stopped answering`);
        const schedules = await Schedule.releaseStale();
        if (schedules > 0) logger.warning(`Released ${schedules} schedule launch(es) held by a node that stopped answering`);
      } catch (err) {
        logger.error('Failed to release the claims of stopped nodes:', err);
      }
      // and the runners an RTE registered itself (rte/register.js) whose RTE is gone : a
      // recreated container registered again under its new address
      try {
        const runners = await Runner.removeUnresponsive();
        if (runners > 0) logger.warning(`Removed ${runners} runner(s) registered by an RTE that stopped answering`);
      } catch (err) {
        logger.error('Failed to remove the runners of stopped RTEs:', err);
      }
    });
    this.jobs.system.set('deadNodes', deadNodesTask);
    logger.info('Initialized the stopped-node sweep (every minute)');

    // 2. Token cleanup - runs daily at 3:00 AM
    const tokenCleanupTask = new Cron('0 3 * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      logger.info('Running token cleanup');
      try {
        await Token.cleanup();
      } catch (err) {
        logger.error('Failed to cleanup tokens:', err);
      }
    });
    this.jobs.system.set('tokenCleanup', tokenCleanupTask);
    logger.info('Initialized token cleanup (daily at 3:00 AM)');

    // 2b. Audit retention - runs at 3:30 AM. Shipped with the audit trail rather
    // than after it : an append-only table with no sweep is the same unbounded
    // growth problem job_output already has.
    const auditCleanupTask = new Cron('30 3 * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      const keep = appConfig.auditRetentionDays;
      if (!keep || keep < 1) {
        logger.info('Audit retention is disabled, keeping all entries');
        return;
      }
      logger.info(`Running audit cleanup, keeping the last ${keep} days`);
      try {
        const removed = await Audit.removeOlderThan(keep);
        logger.info(`Removed ${removed} audit entries older than ${keep} days`);
      } catch (err) {
        logger.error('Failed to cleanup audit entries:', err);
      }
    });
    this.jobs.system.set('auditCleanup', auditCleanupTask);
    logger.info('Initialized audit cleanup (daily at 3:30 AM)');

    // 2c. Job retention - runs at 2:30 AM. Job output is longtext and nothing pruned
    // it before, so this is the table that grows without limit on a busy instance.
    // Disabled by default (JOB_RETENTION_DAYS=0) : upgrading must never silently
    // delete job history somebody relied on. The health page reports the size, so
    // switching it on is an informed choice rather than a surprise.
    const jobCleanupTask = new Cron('30 2 * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      const keep = appConfig.jobRetentionDays;
      if (!keep || keep < 1) {
        logger.info('Job retention is disabled (JOB_RETENTION_DAYS), keeping all jobs');
        return;
      }
      logger.info(`Running job cleanup, keeping the last ${keep} days`);
      try {
        const removed = await Job.removeOlderThan(keep);
        // only audited when it actually removed something : a nightly 'removed 0 rows'
        // entry for every task would bury the events worth reading
        if (removed > 0) {
          logger.warning(`Removed ${removed} finished jobs older than ${keep} days`);
          Audit.log({
            action: 'job.prune', outcome: 'success', targetType: 'job',
            detail: { removed, retentionDays: keep }
          });
        }
      } catch (err) {
        logger.error('Failed to cleanup jobs:', err);
        Audit.log({ action: 'job.prune', outcome: 'failure', targetType: 'job', detail: { error: err.message || String(err) } });
      }
    });
    this.jobs.system.set('jobCleanup', jobCleanupTask);
    logger.info('Initialized job cleanup (daily at 2:30 AM)');

    // 3. Nightly backup - runs at midnight
    const nightlyBackupTask = new Cron('0 0 * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      logger.info('Running automated nightly backup');
      try {
        const result = await BackupModel.doBackup('Automated nightly backup');
        logger.info(`Nightly backup completed: ${result.backupFolder}`);
        // Audited as well as logged : every nightly backup on this machine failed for
        // weeks and the only trace was one line in a log file nobody reads. A cron
        // task has no user, so the trail records it as actor_type 'system'.
        Audit.log({
          action: 'backup.create', outcome: 'success', targetType: 'backup',
          target: result.timestamp || null,
          detail: { folder: result.backupFolder, description: result.description }
        });

        // Cleanup old nightly backups.
        // A retention of 0 (or a negative / non-numeric value) means DO NOT CLEAN UP :
        // slice(0) returns the whole list, so this used to delete every nightly backup
        // including the one taken seconds earlier - and help.yaml documents 0 as the way
        // to disable cleanup. It also matches AUDIT_RETENTION_DAYS / JOB_RETENTION_DAYS,
        // where 0 means keep for ever.
        const keepBackups = appConfig.nightlyBackupRetention;
        if (!(keepBackups >= 1)) {
          logger.info('Nightly backup cleanup is disabled (NIGHTLY_BACKUP_RETENTION), keeping all backups');
          return;
        }
        logger.info(`Cleaning up nightly backups, keeping last ${keepBackups} backups`);
        const backups = await BackupModel.listBackups();   // newest first
        const nightlyBackups = backups.filter(b => b.description === 'Automated nightly backup');
        // Only VALID backups count towards the quota : an instance whose backups have
        // been failing would otherwise keep N pieces of 0-byte junk and delete the last
        // genuinely restorable snapshot to make room for them.
        const validNightly = nightlyBackups.filter(b => b.valid);
        const kept = new Set(validNightly.slice(0, keepBackups).map(b => b.folder));

        // Nothing valid at all : keep everything. There is no snapshot to protect, and
        // deleting the only record of what went wrong helps nobody - the health page
        // reports the invalid count instead.
        const newestKept = validNightly[0]?.folder || null;
        if (!newestKept) {
          logger.warning('No valid nightly backup exists, skipping the retention sweep entirely');
        } else {
          // INVALID folders are swept too. Excluding them from the quota (above) is right,
          // but they were then also excluded from the deletion list, so a 0-byte folder was
          // kept for ever - the retention setting silently did not apply to exactly the
          // folders nobody wants. Nothing NEWER than the newest kept backup is ever a
          // candidate, so a backup still being written cannot be deleted underneath itself.
          const toDelete = nightlyBackups.filter(b => !kept.has(b.folder) && b.folder < newestKept);
          for (const backup of toDelete) {
            logger.info(`Deleting old nightly backup: ${backup.folder}${backup.valid ? '' : ' (no usable dump)'}`);
            await BackupModel.deleteBackup(backup.folder);
            Audit.log({
              action: 'backup.delete', outcome: 'success', targetType: 'backup',
              target: backup.folder, detail: { reason: 'retention', keep: keepBackups, valid: !!backup.valid }
            });
          }
          if (toDelete.length > 0) {
            const junk = toDelete.filter(b => !b.valid).length;
            logger.info(`Cleaned up ${toDelete.length} old nightly backups${junk ? ` (${junk} with no usable dump)` : ''}`);
          }
        }
      } catch (err) {
        logger.error('Failed to create nightly backup:', err);
        // the whole point : a failed backup is now queryable in the audit trail and
        // red on the health page, instead of living only in the log
        Audit.log({
          action: 'backup.create', outcome: 'failure', targetType: 'backup',
          detail: { error: err.message || String(err) }
        });
      }
    });
    this.jobs.system.set('nightlyBackup', nightlyBackupTask);
    logger.info('Initialized nightly backup (daily at midnight)');

    // 4. Stored jobs cleanup - runs daily at 4:00 AM
    const storedJobsCleanupTask = new Cron('0 4 * * *', {
      timezone: this.timezone,
      protect: true
    }, async () => {
      logger.info('Running stored jobs cleanup');
      try {
        const result = await mysql.do(
          "DELETE FROM AnsibleForms.stored_jobs WHERE expires_at IS NOT NULL AND expires_at < NOW()",
          undefined,
          true
        );
        if (result.affectedRows > 0) {
          logger.info(`Cleaned up ${result.affectedRows} expired stored job(s)`);
        }
      } catch (err) {
        logger.error('Failed to cleanup expired stored jobs:', err);
      }
      // and the rows of nodes gone for a day
      try {
        const forgotten = await forgetOldNodes();
        if (forgotten > 0) logger.info(`Forgot ${forgotten} node(s) not seen for a day`);
      } catch (err) {
        logger.error('Failed to forget old nodes:', err);
      }
    });
    this.jobs.system.set('storedJobsCleanup', storedJobsCleanupTask);
    logger.info('Initialized stored jobs cleanup (daily at 4:00 AM)');

    // 5. Config seed reload - re-applies CONFIG_SEED_PATH when its content changes
    this.systemTasksStarted = true;
    this.scheduleConfigSeedReload(appConfig);

    logger.info('System maintenance tasks initialization complete');
  }

  /**
   * (Re)registers the config seed reload : re-applies CONFIG_SEED_PATH when its content changes,
   * every CONFIG_SEED_RELOAD_SECONDS. Called at startup with the other system tasks, and again
   * when the interval is changed in the settings, so a new interval needs no restart. A node
   * that runs no scheduler (its system tasks never started) has nothing to reschedule.
   *
   * Registered here rather than as a watcher of its own so it stops with everything else, and
   * so the seed is refreshed by the same machinery that already refreshes the repositories.
   * `interval` is croner's own throttle : the pattern fires every second and the option holds
   * each run back until the interval has passed, which is how an arbitrary number of seconds
   * is expressed - a step pattern (every n seconds) silently breaks for anything above 59.
   *
   * Args:
   *   appConfig (object): the app config (configSeedPath, configSeedReloadSeconds).
   *
   * Returns:
   *   boolean: whether the scheduler runs here (the task is then as configured).
   */
  scheduleConfigSeedReload(appConfig) {
    if (!this.systemTasksStarted) return false;
    // the task in place goes first : one left running keeps firing next to its successor
    const previous = this.jobs.system.get('configSeedReload');
    if (previous) {
      previous.stop();
      this.jobs.system.delete('configSeedReload');
    }
    const seedReloadSeconds = appConfig.configSeedReloadSeconds;
    if (appConfig.configSeedPath && seedReloadSeconds > 0) {
      const configSeedTask = new Cron('* * * * * *', {
        timezone: this.timezone,
        interval: seedReloadSeconds,
        // an apply that runs long (a seeded repository being cloned) must not have a
        // second one started on top of it
        protect: true
      }, async () => {
        // reloadConfigSeed handles its own failures - it must never throw into the
        // scheduler, because a rejection here would leave the tick counted and the
        // reason logged by croner rather than by the seed
        await reloadConfigSeed({ trigger: 'poll' });
      });
      this.jobs.system.set('configSeedReload', configSeedTask);
      logger.info(`Initialized config seed reload (every ${seedReloadSeconds}s)`);
    } else if (appConfig.configSeedPath) {
      logger.info('Config seed reload is off (CONFIG_SEED_RELOAD_SECONDS=0), the seed applies at startup only');
    }
    return true;
  }

  /**
   * Stop all cron jobs
   */
  stopAll() {
    logger.info('Stopping all cron jobs...');
    
    this.jobs.repositories.forEach((task, name) => {
      task.stop();
      logger.debug(`Stopped repository cron job: ${name}`);
    });
    this.jobs.repositories.clear();

    this.jobs.schedules.forEach((task, id) => {
      task.stop();
      logger.debug(`Stopped schedule cron job: ${id}`);
    });
    this.jobs.schedules.clear();

    this.jobs.system.forEach((task, name) => {
      task.stop();
      logger.debug(`Stopped system task: ${name}`);
    });
    this.jobs.system.clear();

    logger.info('All cron jobs stopped');
  }

  /**
   * What the Status page shows about the scheduler. The worker publishes it with its node row
   * (lib/nodes.js), so an app node can show it too.
   */
  describe() {
    const tasks = [];
    for (const [name, task] of this.jobs.system.entries()) {
      var next;
      try { next = task.nextRun?.() || null; } catch { next = null; }
      tasks.push({ name, nextRun: next ? new Date(next).toISOString() : null });
    }
    return {
      counts: {
        system: this.jobs.system.size,
        schedules: this.jobs.schedules.size,
        repositories: this.jobs.repositories.size,
      },
      tasks,
      lastResync: this.lastResync ? this.lastResync.toISOString() : null,
    };
  }
}

// Export singleton instance
const cronService = new CronService();
export default cronService;
