
"use strict";
import Schedule from "../../models/schedule.model.js";
import RestResult from "../../models/restResult.model.v2.js";
import Errors from "../../lib/errors.js";
import cronService from "../../services/cron.service.js";
import logger from "../../lib/logger.js";
import i18n from "../../lib/i18n.js";

const scheduleController = {
  async find(req, res) {
    try {
      if (req.query.name) {
        const schedule = await Schedule.findByName(req.query.name);
        return res.json(RestResult.single(schedule));
      } else {
        const schedules = await Schedule.findAll();
        return res.json(RestResult.list(schedules));
      }
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async create(req, res) {
    try {
      const user = req?.user?.user || {};
      // Without allowScheduledJobs the route guard let this through on allowPlannedJobs :
      // that is "Run later" on a form, a one-time run of a form the user may run, as them.
      // Decided again here on the option itself rather than trusted from the guard.
      const insertId = user.options?.allowScheduledJobs
        ? await Schedule.create(req.body)
        : await Schedule.plan(user, req.body);
      // Fetch the created record to get all fields for cron service
      const created = await Schedule.findById(insertId);
      // Add to cron service
      logger.info(`Adding schedule '${created.name}' (ID: ${created.id}) to cron service`);
      cronService.addSchedule(created.id, created.name, created.cron, created.one_time_run, created.run_at);
      return res.status(201).json(RestResult.single(i18n.t(req, 'resources.scheduleAdded'), created));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async findById(req, res) {
    try {
      const schedule = await Schedule.findById(req.params.id);
      return res.json(RestResult.single(schedule));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async update(req, res) {
    try {
      await Schedule.update(req.body, req.params.id);
      // Fetch the updated record to get all fields for cron service
      const updated = await Schedule.findById(req.params.id);
      // Update cron service with complete record
      logger.info(`Updating schedule '${updated.name}' (ID: ${updated.id}) in cron service`);
      cronService.addSchedule(updated.id, updated.name, updated.cron, updated.one_time_run, updated.run_at);
      return res.json(RestResult.single(updated));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async delete(req, res) {
    try {
      const deleted = await Schedule.delete(req.params.id);
      // Remove from cron service
      logger.info(`Removing schedule ID ${req.params.id} from cron service`);
      cronService.removeSchedule(req.params.id);
      return res.json(RestResult.single(deleted));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async queue(req, res) {
    try {
      await Schedule.queue(req.params.id);
      return res.json(RestResult.single(i18n.t(req, 'resources.scheduleQueued'), req.params.id));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  },

  async launch(req, res) {
    try {
      await Schedule.launch(req.params.id);
      return res.json(RestResult.single(i18n.t(req, 'resources.scheduleLaunched'), req.params.id));
    } catch (err) {
      Errors.ReturnError(res, err);
    }
  }
};

export default scheduleController;