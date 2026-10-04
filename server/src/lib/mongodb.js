//- MYSQL Module
import logger from './logger.js';
import { MongoClient as Client } from 'mongodb';
import Credential from '../models/credential.model.v2.js';

const Mongo = {}

Mongo.query = async function (connection_name, query) {

  var queryarr = query.split("~")
  var queryJson
  if(queryarr.length!=3){
    throw new Error("["+connection_name+"] query must contain 3 parts separated with '~'. " + query)
  }
  var dbName = queryarr[0]
  var collectionName = queryarr[1]
  try{
    queryJson = JSON.parse(queryarr[2])
  }catch(err){
    throw new Error("["+connection_name+"] query must be valid json. Use double quotes, not single quotes.  " + queryarr[2], { cause: err })
  }
  var creds = await Credential.resolveCredential(connection_name)
  var uri = `mongodb://${encodeURI(creds.user)}:${encodeURI(creds.password)}@${creds.host}:${creds.port}`
  var client
  try{
    client = await Client.connect(uri)
    var db = client.db(dbName)
    var collection = db.collection(collectionName)
    var result = await collection.find(queryJson).toArray()
    return result
  }catch(err){
    logger.error("["+connection_name+"] ", err)
    throw err
  }finally{
    try{
      client.close()
    }catch(e){
      logger.error("["+connection_name+"] ",e)
      //throw e
    }
  }

}
export default Mongo
