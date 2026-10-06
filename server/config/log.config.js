import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



var log_config = {
  level: process.env.LOG_LEVEL || "notice",
  path: process.env.LOG_PATH || path.resolve(__dirname + '/../persistent/logs'),
  consolelevel: process.env.LOG_CONSOLE_LEVEL || "notice",
  sysloglevel: process.env.LOG_SYSLOG_LEVEL || "debug",
  // no default host : syslog is off until LOG_SYSLOG_HOST names one (logger.js only builds
  // the transport for a host). A "localhost" default sent every install's logs to udp 514.
  sysloghost: process.env.LOG_SYSLOG_HOST || "",
  syslogport: process.env.LOG_SYSLOG_PORT || 514,
  syslogprotocol: process.env.LOG_SYSLOG_PROTOCOL || "udp4",
  syslogpath: process.env.LOG_SYSLOG_PATH || "/dev/log",
  sysloglocalhost: process.env.LOG_SYSLOG_SOURCE || "localhost",
  syslogtype: process.env.LOG_SYSLOG_TYPE || "BSD",
  syslogappname: process.env.LOG_SYSLOG_APPNAME || "AnsibleForms",
  tz: process.env.LOG_TZ || "UTC",
};
if ( !fs.existsSync( log_config.path ) ) {
  try{
    // Create the directory if it does not exist.
    // `recursive` matters : the default LOG_PATH is ./persistent/logs and persistent/ is
    // gitignored, so on a fresh clone the parent does not exist either and a plain mkdir
    // fails with ENOENT - taking 22 test suites and `npm run dev` down with it. That is
    // what "server/persistent/ must exist" was a manual workaround for.
    fs.mkdirSync( log_config.path, { recursive: true } );
  }catch(err){
    throw new Error("Failed to create the path for the log files", { cause: err })
  }

}
export default log_config;