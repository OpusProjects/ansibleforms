import winston from 'winston';
import 'winston-daily-rotate-file';
import 'winston-syslog';
import loggerConfig from '../../config/log.config.js';
import moment from 'moment-timezone';

const color = {
'info': process.env.LOG_COLOR_INFO || "\x1b[32m",
'error': process.env.LOG_COLOR_ERROR || "\x1b[31m",
'warn': process.env.LOG_COLOR_WARN || "\x1b[33m",
'notice': process.env.LOG_COLOR_NOTICE || "\x1b[37m",
'debug' : process.env.LOG_COLOR_DEBUG || "\x1b[36m"
};

const getTimestamp = () => {
  const tz = loggerConfig.tz;
  return moment().tz(tz).format('YYYY-MM-DD HH:mm:ss:ms');
};

const formatColor = winston.format.printf(
  (info) => {
    const timestamp = getTimestamp();
    return `${timestamp} ${color[info.level] || ''}${info.level}: ${info.message}\x1b[0m`;
  }
);

const formatNoColor = winston.format.printf(
  (info) => {
    const timestamp = getTimestamp();
    return `${timestamp} ${info.level}: ${info.message}`;
  }
);

// how long the log files are kept (LOG_RETENTION_DAYS, Settings > Retention) : '<n>d' for the
// rotating transports, none (every file kept) for 0 ; read when a transport is built, so a new
// value applies when rebuildFileTransports rebuilds them
const keptFor = () => (loggerConfig.retentionDays > 0 ? `${loggerConfig.retentionDays}d` : undefined);

const transportConsole = new winston.transports.Console({
  stderrLevels: ["error"],
  level:loggerConfig.consolelevel,
  format:formatColor
});

const transportDailyRotateFileErrors = new winston.transports.DailyRotateFile({
  filename: loggerConfig.path + "/ansibleforms.errors.%DATE%.log",
  datePattern: 'YYYY-MM-DD',
  maxFiles: keptFor(),
  zippedArchive: true,
  level: 'error',
  format:formatNoColor
});

const transportDailyRotateFile = new winston.transports.DailyRotateFile({
  level: loggerConfig.level,
  filename: loggerConfig.path + "/ansibleforms.%DATE%.log",
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles: keptFor(),
  format:formatColor
});

var transports = [
  transportConsole,
  transportDailyRotateFileErrors,
  transportDailyRotateFile,
]

transportDailyRotateFile.on('error', error => {
  console.error('Error in transportDailyRotateFile:', error);
});

transportDailyRotateFileErrors.on('error', error => {
  console.error('Error in transportDailyRotateFileErrors:', error);
});


if(loggerConfig.sysloghost){
  transports.push(
    new winston.transports.Syslog({
      host: loggerConfig.sysloghost,
      port: loggerConfig.syslogport,
      protocol: loggerConfig.syslogprotocol,
      path: loggerConfig.syslogpath,
      localhost: loggerConfig.sysloglocalhost,
      type: loggerConfig.syslogtype,
      app_name: loggerConfig.syslogappname,
      format: formatNoColor,
      level: loggerConfig.sysloglevel
    })
  )
}

const Logger = winston.createLogger({
  levels: winston.config.syslog.levels,
  transports,
})

// Log levels applied without a restart. winston keeps the level on the logger and on each
// transport as a plain mutable property, so the settings page can change LOG_LEVEL,
// LOG_CONSOLE_LEVEL and LOG_SYSLOG_LEVEL and have the next line honour it. The transports
// themselves (file rotation, the syslog socket, the colour map) are built here at import
// and genuinely do need a restart.
// The colour map is built once at import, but the formatter looks a level up in it on
// every line - so replacing an entry takes effect immediately.
export function setLogColor(level, code) {
  if (!level || !(level in color)) return false;
  color[level] = code || color[level];
  return true;
}

// The syslog transport is built at import from seven separate settings, so changing any of
// them means rebuilding it. winston lets a transport be removed and added at runtime, so a
// rebuild is enough - no restart. If the new configuration is invalid (winston-syslog
// throws for a unix protocol with no path, for instance) the old transport is kept and the
// caller is told, rather than leaving the logger with no syslog at all.
// LOG_PATH is baked into each rotating file's filename at construction, so a change means
// rebuilding both file transports. Same remove/add as the syslog one, and the same rule: if
// the new path cannot be used, keep the old transports rather than lose file logging.
// Winston's remove() only UNPIPES a transport - it does not close it (see
// winston/lib/winston/logger.js). So a rebuilt transport keeps whatever it was holding:
// a DailyRotateFile keeps its open write stream and its file-stream-rotator watchers, and
// a Syslog keeps its udp/tcp socket. Both then live for the process lifetime, one set per
// rebuild - and seven LOG_SYSLOG_* variables each trigger a rebuild, so saving that tab
// with all seven changed leaked six sockets from a single click.
//
// Both close() implementations drain first (DailyRotateFile ends its stream with a
// callback, Syslog waits for its queue with a backoff), and this is only ever called AFTER
// the transport has been unpiped, so nothing new is arriving. A close that throws must not
// stop the replacement being installed, hence the catch.
function closeTransport(transport) {
  try {
    if (transport && typeof transport.close === 'function') transport.close();
  } catch (e) {
    console.error('Could not close a replaced log transport:', e.message);
  }
}

// The main file transport CURRENTLY attached. setLogLevel('file') used to mutate the
// import-time const, which rebuildFileTransports orphans - so after a LOG_PATH change a
// LOG_LEVEL change updated a transport nothing was piped to any more, while logConfig.level
// and the Status page both reported the new level. The file kept logging at the old one.
let currentFileTransport = transportDailyRotateFile;

export function rebuildFileTransports() {
  const make = (suffix, level, format) => new winston.transports.DailyRotateFile({
    level,
    filename: loggerConfig.path + suffix,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxFiles: keptFor(),
    format,
  });
  let errorsT, mainT;
  try {
    errorsT = make('/ansibleforms.errors.%DATE%.log', 'error', formatNoColor);
    mainT = make('/ansibleforms.%DATE%.log', loggerConfig.level, formatColor);
  } catch (e) {
    Logger.warning(`Could not apply the new log path, keeping the previous one : ${e.message}`);
    return false;
  }
  for (const t of [errorsT, mainT]) {
    t.on('error', (error) => console.error('Error in a rotating file transport:', error));
  }
  for (const old of [...transports]) {
    if (old instanceof winston.transports.DailyRotateFile) {
      // unpipe first, so nothing new arrives while it drains, then release the stream
      Logger.remove(old);
      transports.splice(transports.indexOf(old), 1);
      closeTransport(old);
    }
  }
  transports.push(errorsT, mainT);
  Logger.add(errorsT);
  Logger.add(mainT);
  // the level setter has to follow the live transport, not the one we just orphaned
  currentFileTransport = mainT;
  return true;
}

export function rebuildSyslogTransport() {
  const existing = transports.find((t) => t instanceof winston.transports.Syslog);
  if (!loggerConfig.sysloghost) {
    // no host configured : drop any transport we had and stop
    if (existing) {
      Logger.remove(existing);
      transports.splice(transports.indexOf(existing), 1);
      closeTransport(existing);
    }
    return true;
  }
  let replacement;
  try {
    replacement = new winston.transports.Syslog({
      host: loggerConfig.sysloghost,
      port: loggerConfig.syslogport,
      protocol: loggerConfig.syslogprotocol,
      path: loggerConfig.syslogpath,
      localhost: loggerConfig.sysloglocalhost,
      type: loggerConfig.syslogtype,
      app_name: loggerConfig.syslogappname,
      format: formatNoColor,
      level: loggerConfig.sysloglevel,
    });
  } catch (e) {
    Logger.warning(`Could not apply the new syslog settings, keeping the previous ones : ${e.message}`);
    return false;
  }
  if (existing) {
    Logger.remove(existing);
    transports.splice(transports.indexOf(existing), 1);
    closeTransport(existing);
  }
  transports.push(replacement);
  Logger.add(replacement);
  return true;
}

export function setLogLevel(which, level) {
  if (!level) return false;
  if (which === 'file') {
    // the transport currently attached, NOT the import-time one : see currentFileTransport
    currentFileTransport.level = level;
    return true;
  }
  if (which === 'console') {
    transportConsole.level = level;
    return true;
  }
  if (which === 'syslog') {
    const syslog = transports.find((t) => t instanceof winston.transports.Syslog);
    if (!syslog) return false;
    syslog.level = level;
    return true;
  }
  return false;
}

export default Logger;