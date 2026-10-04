'use strict';
import logger from "../lib/logger.js";
import Credential from "./credential.model.v2.js";
import mysql from "../lib/mysql.js";
import mssql from "../lib/mssql.js";
import postgres from "../lib/postgres.js";
import mongodb from "../lib/mongodb.js";
import oracle from "../lib/oracle.js";
import jq from "node-jq";
import { substitute } from "../lib/queryPolicy.js";

//reporter object create
var Query=function(){

};
/**
 * @param {object} [values] When given, `query` is a TEMPLATE and its `$(x)` placeholders
 *   are substituted here rather than by the caller. This is the only layer that knows
 *   each datasource's engine, and the correct escaping differs between them - a backslash
 *   is an escape character in mysql and a literal in postgres/mssql/oracle, and mongodb
 *   wants json escaping rather than sql. Escaping every value with the mysql rules
 *   corrupted `DOMAIN\user` and `C:\path` on the other four. A config naming several
 *   datasources is substituted once per datasource, for the same reason.
 *   Omit it (the default) and the query is run exactly as passed.
 */
Query.findAll = async function (query,jqExpression="",cfg,noLog,values=null) {

  // legacy config was an object
  // in 5.0.2 we allow string and array
  // dbtype is stored in the credential, so we don't need it in the config
  // hence we can allow a simple string as config
  // additinally we allow an array of strings and merge the results
  var config = []
  var result = []
  if(typeof cfg == "string"){
    config.push({})
    config[0].name = cfg
  }else if(Array.isArray(cfg)){
    // clone cfg
    cfg.forEach((c)=>{
      config.push({name:c})
    })
  }else if(cfg && typeof cfg == "object"){
    config.push(cfg)
  }else{
    // There was no else, so a dbConfig that is a number or a boolean (`dbConfig: 1` in a
    // form's yaml parses to one) left `config` empty, the loop below never ran, and the
    // endpoint answered 200 with []. An empty dropdown and no indication anything was
    // wrong - the same class of lie as the `type` switch further down, which does raise.
    throw new Error(`Invalid dbConfig: expected a datasource name, a list of names or a config object, got ${cfg === null ? 'null' : typeof cfg}`)
  }


  for await (var c of config){

    var res
    if(!c.type){ // if no type is given, we try to find the credential
      logger.debug(`[${c.name}] No type is passed, looking up credential`)
      var cred = await Credential.resolveCredential(c.name)
      c.type = cred.db_type || "mysql"
    }
    // substituted per datasource, now that the engine is known - see the `values` note
    // on this function. Done before the logging so the log shows what actually ran.
    const finalQuery = values ? substitute(query,values,c.type) : query
    if(noLog){
      logger.info(`[${c.type}][${c.name}] Running query : noLog is applied`)
    }else{
      logger.info(`[${c.type}][${c.name}] Running query ${finalQuery}`)
    }
    if(c.type=="mssql"){  // use mssql connection lib
      res = await mssql.query(c.name,finalQuery)
      if(!noLog){
        logger.debug(`[${c.name}] query result : ${JSON.stringify(res)}`)
      }
      result = result.concat(res)

    }else if(c.type=="mysql"){  // use mysql connection lib
      res = await mysql.query(c.name,finalQuery)
      if(!noLog){
        logger.debug(`[${c.name}] query result : ${JSON.stringify(res)}`)
      }
      result = result.concat(res)
    }else if(c.type=="postgres"){  // use postgres connection lib
      res = await postgres.query(c.name,finalQuery)
      if(!noLog){
        logger.debug(`[${c.name}] query result : ${JSON.stringify(res)}`)
      }
      result = result.concat(res)
    }else if(c.type=="oracle"){  // use postgres connection lib
      res = await oracle.query(c.name,finalQuery)
      if(!noLog){
        logger.debug(`[${c.name}] query result : ${JSON.stringify(res)}`)
      }
      result = result.concat(res)
    }else if(c.type=="mongodb"){  // use postgres connection lib
      res = await mongodb.query(c.name,finalQuery)
      if(!noLog){
        logger.debug(`[${c.name}] query result : ${JSON.stringify(res)}`)
      }
      result = result.concat(res)
    }else{
      throw new Error("Unsupported database type")
    }
  }
  
  // Apply jq expression if provided
  if(jqExpression && jqExpression.trim() !== ""){
    logger.debug(`Applying jq expression: ${jqExpression}`)
    result = await jq.run(jqExpression, result, { input:"json", output:"json" })
    if(!noLog){
      logger.debug(`jq result : ${JSON.stringify(result)}`)
    }
  }
  
  return result
};
export default  Query;
