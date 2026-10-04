//- MYSQL Module
import logger from './logger.js';
import { Client } from 'pg';
import Credential from '../models/credential.model.v2.js';

const Postgres = {}

// rewritten with await 5.0.3
Postgres.query = async function (connection_name, query) {
  var creds = await Credential.resolveCredential(connection_name)
  var config = {
      host: creds.host,
      user: creds.user,
      password: creds.password,
      database: creds.db_name||creds.user,
      port: creds.port,
  };
  var client
  try{
    client = new Client(config)
    await client.connect()
    var result = await client.query(query)
    return result?.rows
  }catch(err){
    logger.error(`[${connection_name}] query error`,err)
    throw err
  }finally{
    try{
      // logger.debug("["+connection_name+"] Closing connection")
      await client.end()
    }catch(e){
      logger.error(`[${connection_name}] connection error`,e)
      //throw e
    }
  }
}

export default Postgres
