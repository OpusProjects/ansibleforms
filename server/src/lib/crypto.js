import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import appConfig from '../../config/app.config.js';

const algorithm = 'aes-256-ctr';

const encrypt = (text) => {
    if(text){
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, appConfig.encryptionSecret, iv);
      const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
      return encrypted.toString('hex') + "." + iv.toString('hex')
    }else{
      return ""
    }
};

const encrypt_to_file = (path,text) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', appConfig.encryptionSecret, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final(), iv]);
    const result = Buffer.from(encrypted,'binary').toString('base64');
    fs.writeFileSync(path, result);
};

const decrypt = (hash) => {
    if(hash){
      const tmp = hash.split(".")
      const hash2 = {content:tmp[0],iv:tmp[1]}
      const decipher = crypto.createDecipheriv(algorithm, appConfig.encryptionSecret, Buffer.from(hash2.iv, 'hex'));
      const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash2.content, 'hex')), decipher.final()]);
      return decrpyted.toString();
    }else{
      return ""
    }
};
// promise wrapper for bcrypthash
const hashPassword = (pw) => {
    const saltrounds = 10
    return new Promise((resolve,reject)=>{
      bcrypt.hash(pw, saltrounds,(err,hash)=>{
        if(err) reject(err)
        resolve(hash)
      })
    })
}
// a bcrypt hash of nothing anybody types : compared against when a username is unknown, so an
// unknown name takes as long as a wrong password and the timing tells nobody which names exist
// (made once, lazily, at the cost of the real ones : 10 rounds)
let dummyHash = null;
const checkNoPassword = (pw) => new Promise((resolve) => {
  if (!dummyHash) dummyHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  bcrypt.compare(String(pw ?? ''), dummyHash, () => resolve({ isValid: false }));
});
// promise wrapper for bcrypt compare
const checkPassword = (pw,hash,user) =>{
  return new Promise((resolve,reject)=>{
    bcrypt.compare(pw,hash,function(err,isSame){
      if(err)reject(err)
      resolve({isValid:isSame,user:user});
    });
  })
}


export default {
    encrypt,
    decrypt,
    encrypt_to_file,
    hashPassword,
    checkPassword,
    checkNoPassword
};
