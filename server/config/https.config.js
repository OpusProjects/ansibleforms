import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../src/lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var privatekey=undefined
var certificate=undefined

if(process.env.HTTPS=="1"){

  var certificatePath = process.env.HTTPS_CERT || (__dirname + '/../persistent/certificates/cert.pem')
  var privatekeyPath = process.env.HTTPS_KEY || (__dirname + '/../persistent/certificates/key.pem')
  // logger.info("Using https certificate : " + certificatePath)
  // logger.info("Using https private key : " + privatekeyPath)

  // check if httpsConfig.httpsKey and httpsConfig.httpsCert exist
  if(!fs.existsSync(certificatePath) || !fs.existsSync(privatekeyPath)){
    logger.warning("httpsKey or httpsCert not found, copying from templates")
    var certificateTemplatePath = path.join(__dirname,"/../templates/seed/cert.pem.template")
    var privatekeyTemplatePath = path.join(__dirname,"/../templates/seed/key.pem.template")
    var certificateDirPath = path.dirname(certificatePath)
    // logger.info("Using https certificate template : " + certificateTemplatePath)
    // logger.info("Using https private key template : " + privatekeyTemplatePath)
    try{
      // create the folder if it doesn't exist
      logger.info("Creating folder " + certificateDirPath)
      fs.mkdirSync(certificateDirPath, { recursive: true });
      logger.info("Copying templates to " + certificatePath + " and " + privatekeyPath)
      fs.copyFileSync(certificateTemplatePath, certificatePath);
      fs.copyFileSync(privatekeyTemplatePath, privatekeyPath);
      logger.info("Copied templates to " + certificatePath + " and " + privatekeyPath)
    }catch(e){
      logger.error("No certificate found and could not copy templates",e)
      // exit // no point to continue
      process.exit(1)
    }
  }


  try{
    privatekey = fs.readFileSync(privatekeyPath)
    certificate = fs.readFileSync(certificatePath)
  }catch(err){
    logger.error("Failed to open https private key and certificate : ",err)
    throw new Error("Failed to open https private key and certificate : " + err.message, { cause: err })
  }
}

export default {
  https: (process.env.HTTPS=="1") || false,
  httpsKey: privatekey,
  httpsCert: certificate
};
