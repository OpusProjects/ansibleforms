//- MYSQL Module
import logger from './logger.js';
import client from 'mysql2/promise.js';
import Credential from '../models/credential.model.v2.js';

const MySql = {}

MySql.clean=function(config){
  delete config.name
  delete config.db_type
  delete config.db_name
  delete config.secure
  delete config.is_database
  return config
}

// rewrite with await 5.0.3

MySql.query = async function (connection_name, query) {
  // get credentials
  var config = await Credential.resolveCredential(connection_name)
  logger.debug(`[${connection_name}] query : ${query}`)
  var conn
  try{

    // fixed in 5.0.4
    config.multipleStatements=true
    // remove database if not defined
    if(config.db_name){
      config.database = config.db_name
    }
    if(config.secure){
      config.ssl={
        sslmode:"required",
        rejectUnauthorized:false
      }
    }else{
      config.ssl={
        sslmode:"none",
        rejectUnauthorized:false
      }
    }
    // get connection
    config=MySql.clean(config) // remove unsupported properties      

    conn = await client.createConnection(MySql.clean(config))
    var result
    try{
      [result] = await conn.query(query)
      return result
    }catch(err){
      logger.error(`[${connection_name}] query error : ${err.toString()}`)
      throw err
    }
  }catch(err){
    logger.error(`[${connection_name}] connection error : ${err.toString()}`)
    throw err
  }finally{
    try{
      await conn.end()
    }catch(e){
      logger.error(`[${connection_name}] ${e}`)
      // throw e
    }
  }
}
export default MySql
