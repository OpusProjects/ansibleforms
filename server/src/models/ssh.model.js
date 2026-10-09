'use strict';
import logger from "../lib/logger.js";
import config from "../../config/app.config.js";
import fs from "fs";
import path from "path";
import ssh_keygen from "../lib/ssh-keygen.js";
// Computed when used, not at import, so HOME_PATH can change without a restart. The value
// is identical unless the setting changes, so nothing moves for an instance that never
// touches it - and existing keys stay at the old path (the settings page says so).
const privateKeyPath = () => path.join(config.homePath, '/.ssh/id_rsa');
const publicKeyPath = () => path.join(config.homePath, '/.ssh/id_rsa.pub');

// constructor for ssh config
var Ssh=function(ssh){
    this.key = ssh.key;
};
// generate new keys (used only once during startup of ansibleforms (in the init/index.js))
Ssh.generate = function(force){
  return ssh_keygen.keygen({
    path: privateKeyPath(),
    read: true,
    force: force,
    destroy: false,
    comment: 'info@ansibleguy.com',
    password: false,
    size: '2048',
    format: 'PEM'
  })
  .then((keys)=>{
    logger.warning('SSH Keys created!');
    logger.debug('private key : '+keys.key);
    logger.notice('public key : '+keys.pubKey);
  })
}

// it allows a manual upload of a custom private key
// the public key is then auto generated
Ssh.update = function (record) {
    logger.info(`Updating ssh key`)
    try{
      // the .ssh folder of the home path may not exist yet (a fresh install, a new HOME_PATH) :
      // made first, private to the app, or the key could not be written
      fs.mkdirSync(path.dirname(privateKeyPath()),{recursive:true,mode:0o700})
      // write new private key
      fs.writeFileSync(privateKeyPath(),record.key,{mode:0o600})
      // autogenerate new public key
      return ssh_keygen.keygen({
        publicOnly: true,
        path: privateKeyPath(),
        read: true,
        force: true,
        destroy: false
      })
      .then((keys)=>{
        logger.notice('Public SSH Key created!');
        logger.debug('public key : '+keys.pubKey);
      })
      .catch((err)=>{
        logger.error("Error creating public key "+err)
      })

    }catch(e){
      logger.error(e)
      // force : a key that was never written is not a second error hiding the first (rmSync takes
      // options, a bare `true` threw a TypeError instead of reporting why the key failed)
      fs.rmSync(privateKeyPath(),{force:true})
      fs.rmSync(publicKeyPath(),{force:true})
      throw e
    }
};
// get private & public key info
Ssh.find = function () {
  logger.info("Reading sshkey key")
  return ssh_keygen.keygen({              // get random art for private key
    randomArt: true,
    path: privateKeyPath()
  })
  .then((out)=>{
    // logger.debug("Private key found")
    return fs.promises.readFile(publicKeyPath())  // read public key
      .then((pubkey)=>{
        return {art:out.art,publicKey:pubkey.toString()}
      })
      .catch(()=>{
        logger.error("No public key found")
        return Promise.resolve({art:out.art,publicKey:""})
      })

  })

};
export default  Ssh;
