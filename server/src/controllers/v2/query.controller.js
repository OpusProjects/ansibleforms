'use strict';
import Query from '../../models/query.model.js';
import RestResult from '../../models/restResult.model.v2.js';
import logger from '../../lib/logger.js';
import i18n from '../../lib/i18n.js';
import { resolveQuery, QueryPolicyError, escapeSqlValue, substitute } from '../../lib/queryPolicy.js';

// re-exported so the existing tests keep importing them from here ; the implementations
// lives in lib/queryPolicy.js
export { escapeSqlValue, substitute };

/**
 * Runs a query for a form field.
 *
 * The query TEXT comes from the form definition, not from the request. It used to be taken
 * verbatim from the body, on a route carrying nothing but JWT auth - so any authenticated
 * user could send any SQL to any configured datasource and read or write it with the stored
 * credential's privileges, whatever their role options said.
 *
 * A raw query in the body is still accepted, but only from a user with showSettings: the
 * designer previews queries that way while authoring, and that user can already read and
 * rewrite the whole configuration anyway.
 */
const findAll = async function(req, res) {
  if(req.body.constructor === Object && Object.keys(req.body).length === 0){
    return res.status(400).json(RestResult.error(i18n.t(req, 'errors.noDataSent')));
  }
  const user = req?.user?.user || {};
  const noLog = (req.query.noLog == "true");

  let resolved;
  try {
    resolved = await resolveQuery(req);
  } catch (err) {
    if (err instanceof QueryPolicyError) {
      if (err.statusCode === 403) {
        logger.warning(`Refused a raw query from ${user.username || 'unknown'} : send formName and fieldName instead`);
        return res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), err.detail));
      }
      if (err.statusCode === 400) {
        logger.error("database config is missing, provide 'dbConfig' parameter with type query");
        return res.status(400).json(RestResult.error(i18n.t(req, 'errors.missingDbConfig')));
      }
      return res.status(err.statusCode).json(RestResult.error(err.message));
    }
    // Form.load throws these, and they are answers rather than faults : a 500 hid the
    // reason and made the client report a broken server for a permission or a typo.
    // 403, never 401 - a 401 makes the client's axios interceptor drop the session.
    if (err.name === 'AccessDeniedError') {
      return res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), err.message));
    }
    if (err.name === 'NotFoundError') {
      return res.status(404).json(RestResult.error(err.message));
    }
    logger.error("Could not resolve the form query: " + err.toString());
    return res.status(500).json(RestResult.error(err.toString()));
  }

  try {
    const resultset = await Query.findAll(resolved.query, resolved.jq, resolved.config, noLog, resolved.values);
    res.json(RestResult.single(resultset));
  } catch(err) {
    logger.error("Query failed: " + err.toString());
    res.status(500).json(RestResult.error(err.toString()));
  }
};

export default {
  findAll
};
