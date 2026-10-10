'use strict';
import Expression from '../../models/expression.model.js';
import RestResult from '../../models/restResult.model.v2.js';
import i18n from '../../lib/i18n.js';
import logger from '../../lib/logger.js';
import helpers from '../../lib/common.js';
import { QueryPolicyError } from '../../lib/queryPolicy.js';
import { resolveExpression } from '../../lib/expressionPolicy.js';

/**
 * Evaluates a server expression for a form field.
 *
 * The expression TEXT comes from the form definition, not from the request - see
 * lib/expressionPolicy.js. A raw expression in the body is accepted only from a user with
 * settings or designer access.
 */
const execute = async function(req, res) {
    //handles null error
    if(req.body.constructor === Object && Object.keys(req.body).length === 0){
        return res.status(400).json(RestResult.error(i18n.t(req, 'errors.noDataSent')));
    }
    const user = req?.user?.user || {};

    let resolved;
    try {
      resolved = await resolveExpression(req);
    } catch (err) {
      if (err instanceof QueryPolicyError) {
        if (err.statusCode === 403) {
          logger.warning(`Refused a raw expression from ${user.username || 'unknown'} : send formName and fieldName instead`);
          return res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), err.detail));
        }
        return res.status(err.statusCode).json(RestResult.error(err.message));
      }
      // Form.load throws these ; 403, never 401 - a 401 makes the client drop the session
      if (err.name === 'AccessDeniedError') {
        return res.status(403).json(RestResult.error(i18n.t(req, 'errors.noAccess'), err.message));
      }
      if (err.name === 'NotFoundError') {
        return res.status(404).json(RestResult.error(err.message));
      }
      logger.error("Could not resolve the form expression: " + err.toString());
      return res.status(500).json(RestResult.error(err.toString()));
    }

    const { expression, noLog } = resolved;
    try {
      const result = await Expression.execute(expression, noLog)
      if(!noLog){
        try{
          logger.debug(`expression result : ${helpers.logSafe(JSON.stringify(result))}`)
        }catch(e){
          //
        }
      }
      res.json(RestResult.single(result))
    } catch(err) {
      logger.error(`Error in expression : ${err}`)
      res.status(500).json(RestResult.error(err.toString()))
    }
};

export default {
  execute
}
