'use strict';
import appConfig from '../../../config/app.config.js';
import multer from 'multer';
import logger from '../../lib/logger.js';
import RestResult from '../../models/restResult.model.v2.js';
import i18n from '../../lib/i18n.js';
import fs from 'fs';


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(appConfig.uploadPath, { recursive: true })
    cb(null, appConfig.uploadPath)
  }
})

// File size cap. Default 10 GB (configurable via UPLOAD_MAX_GB), 0 disables it. Read on each
// upload, not at import : a new UPLOAD_MAX_GB applies without a restart (envSettings LIVE).
// multer is cheap to build ; it holds no state between requests.
function uploadMulter() {
  const gb = appConfig.uploadMaxGb;
  const limits = gb && gb > 0 ? { fileSize: gb * 1024 * 1024 * 1024 } : undefined;
  return multer({ storage: storage, limits });
}
const upload = function(req, res, _next) {
  const result = uploadMulter().single('file')

  result(req, res, function (err) {
      if(err) {
          logger.error(`Upload error : ${err.toString()}`)
          return res.status(400).json(RestResult.error(i18n.t(req, 'resources.fileUploadFailed'), err.toString()))
      } 
      // A multipart POST with no `file` part leaves req.file undefined. Dereferencing it
      // threw from inside multer's callback, where only the global uncaughtException
      // handler sees it - so NO RESPONSE was ever sent and the client hung until it timed
      // out. It is a bad request, and it should say so.
      if (!req.file) {
          return res.status(400).json(RestResult.error(i18n.t(req, 'resources.fileUploadFailed'), 'No file was included in the request'))
      }
      logger.info(`Uploaded file ${String(req.file.originalname).replace(/[\r\n]+/g,' ')} as ${req.file.path}`)
      return res.json(RestResult.single(req.file))
  })    
};

export default {
  upload
}
