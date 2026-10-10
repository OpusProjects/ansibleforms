import certinfo from "cert-info";
import logger from "./logger.js";
import config from "../../config/app.config.js";
import { DateTime } from "luxon";
import logConfig from "../../config/log.config.js";

var Helpers = function(){

}

Helpers.htmlEscape = function(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Remove undefined, null, and empty string values from an object
// Useful for preventing accidental data wiping during database updates
Helpers.removeEmptyFields = function(obj) {
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
      delete obj[key];
    }
  });
  return obj;
}

// this is needed because ldap-authentication has missing try catch
Helpers.checkCertificateBase64=function(cert){
  var b64 = cert.replace(/(\r\n|\n|\r)/gm, "").replace(/-{5}[^-]+-{5}/gm,"").replaceAll(" ","")
  return (Buffer.from(b64, 'base64').toString('base64') === b64)
}

Helpers.getError=function(err,prefix=""){
  var m = undefined
  if(err){
    if(err.message){
      m=err.message
    }else{
      if(typeof err == 'string'){
        m=err
      }else{
        m='Could not extract error from err object'
      }
    }
  }
  if(prefix){
    return `${prefix} : ${m}`
  }
  return m
}

Helpers.escapeStringForCommandLine=function(value) {
  const escaped = value.replace(/'/g, "\\'")
  return escaped;
}

Helpers.checkCertificate=function(cert){
  var certs=cert.replace(/-----(\r\n|\n|\r)-----/gm,"-----|-----").split("|")
  if(certs.length>1){
    logger.debug("Certificate is a bundle...")
  }else{
    logger.debug("Certificate is single...")
  }
  for(let i=0;i<certs.length;i++){
    logger.debug(`Certificate ${i+1}`)
    var c=certs[i]
    logger.debug(c)
    if(!Helpers.checkCertificateBase64(c)){
      logger.error("Bad Base64 Encoding...")
      return false
    }else{
      logger.debug("Base64 is valid...")
      try{
        var tmp
        tmp = certinfo.info(c)
        logger.debug(JSON.stringify(tmp))
      }catch(e){
        logger.error("Certificate cannot be parsed...")
        return false
      }
    }
  };
  // we parsed all certificates, no errors found
  return true
}

/**
 * Compile an OPERATOR SUPPLIED regular expression, falling back to the built-in default
 * when it does not compile.
 *
 * MASK_EXTRAVARS_REGEX and REGEX_FILTER_JOB_OUTPUT are both live-editable from the settings
 * page and both were interpolated straight into `new RegExp`. A single stray bracket
 * therefore threw a SyntaxError from inside a LOGGING call and from inside the job output
 * formatter - so a typo in a settings field aborted job launches and made every job
 * unviewable (Job.findById rethrows), with nothing at the point of entry to say why.
 * The same class was already fixed for the log viewer's filter in logs.vue.
 *
 * The fallback is the DOCUMENTED DEFAULT, never "no pattern": for the mask, dropping it
 * would write the credentials it exists to hide into the log, which is the worse failure
 * of the two. Warned once per distinct pattern, or a bad value would log per line.
 */
const regexCache = new Map()
Helpers.safeRegExp = (pattern, fallback, flags, name)=>{
  const key = `${name}\0${pattern}\0${flags}`
  if(regexCache.has(key)) return regexCache.get(key)
  var compiled
  try{
    compiled = new RegExp(pattern, flags)
  }catch(e){
    logger.error(`${name} is not a valid regular expression (${e.message}), falling back to the default`)
    try{
      compiled = new RegExp(fallback, flags)
    }catch(e2){
      // the built-in default is a constant, so this cannot happen - but a regex that
      // matches nothing is still better than throwing out of a log line
      compiled = /(?!)/
    }
  }
  regexCache.set(key, compiled)
  return compiled
}

// checks for passwords from credentials and masks them
Helpers.logSafe = (v)=>{
  var result
  if(!v){
    return ""
  }
  // get the property regex from config and create pattern with group capture
  const maskRegex = config.maskExtravarsRegex
  const pattern = Helpers.safeRegExp(
    `"([^"]*(?:${maskRegex})[^"]*)":"[^"]+"`,
    `"([^"]*(?:password|secret|token)[^"]*)":"[^"]+"`,
    'ig', 'MASK_EXTRAVARS_REGEX')
  result = v.replaceAll(pattern, '"$1":"**NOLOG**"')
  // Both spellings. The vault command was changed from `base64 --decode` to `base64 -d`
  // (5.0.3) and this mask was not, so from then on it matched nothing and the base64
  // encoded ansible-vault password was written to the log in full on every vault run.
  // Non-greedy, so a line carrying two commands cannot have the whole line swallowed.
  result = result.replace(/echo .*? base64 (--decode|-d)/g,"echo **NOLOG**")
  return result
}
// a smart object placeholder replacer
Helpers.replacePlaceholders = (msg,extravars)=>{
  if(!msg)return ""
  return msg.replace(
    /\$\(([^)]+)\)/g,
    (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
      Helpers.findExtravar(extravars,placeholderWithoutDelimiters) || placeholderWithDelimiters
  );
}
Helpers.findExtravar =(data,expr)=>{
  // convert expr into actual data
  // svm.lif.ipaddress => data["svm"]["lif"]["ipaddress"]
  // using reduce, which is a recursive function
  var outputValue=""
  // outputValue=expr.split(/\s*\.\s*/)
  expr.split(/\s*\.\s*/).reduce((master,obj, level,arr) => {
    // if last
    if (level === (arr.length - 1)){
        // the last piece we assign the value to
        try{
          outputValue=master[obj]
        }catch(e){
          outputValue=""
        }

    }else{
        // initialize first time to object
        outputValue=master
    }
    // return the result for next reduce iteration
    return master[obj]

  },data);
  return outputValue
}
Helpers.friendlyAJVError= (e,property,label,o)=>{
  const re= new RegExp(`${property}\\.([0-9]+)*`)
  const matches = e.match(re)    
  var value = `${e}`
  var changed = false
  var result
  var index=-1
  var name=""
  if(matches && matches.length>1){
    index = parseInt(matches[1])
    name = o[index].name || o[index].label || (index+1)
    value = e.replace(matches[0], `${label} '${name}', `)
    changed = true
  }   

  result = {
    changed,
    value,
    index,
    name
  }
  return result
}
Helpers.formatOutput = (records,asText)=>{
  var output=[] // => is final output array
  if(asText){
      // we loop all records, we generalize all newlines to \r\n (output can be mix)
      records.forEach(function(el){
        // we first change new lines to \n
        // we split and rejoin with \r\n
        output.push(el.output.trim('\r\n').replace(/\r/g,'').split('\n').join('\r\n'))
      })
      return output.join('\r\n') // me merge all as 1 big string
  }
  // not as text, so we need to colorize
  // loop all records
  var filterOutput=false
  records.forEach(function(el){
    var escapedLine
    var output2=[] // => each record can still be multiple line => so this is intermediate output array
    var lineoutput=[]
    var record = el.output.trim('\r\n').replace(/\r/g,'') // => first generalize linefeeds
    var lines = record.split('\n') // => break record if multiple lines
    var previousformat="" // => a string to hold the format of a previous line in case multiline
    var matchfound=false

    lines.forEach((line,i)=>{ // loop lines
      matchfound=false // => a flag to check if previous line was changed
      escapedLine = Helpers.htmlEscape(line)
      if(el.output_type=="stderr"){ // if it was in the error stream
        // mark errors
        // warnings (and deprecations) in ansible's purple, not the amber of a changed line
        if(line.match(/^\[(DEPRECATION )?WARNING\].*/g) || previousformat=="purple"){ // warnings
          previousformat="purple"
          matchfound=true
          line = "<span class='has-text-purple'>"+escapedLine+"</span>"
        }else{  // errors
          previousformat="danger"
          matchfound=true
          line = "<span class='has-text-danger'>"+escapedLine+"</span>"
        }
      }else{ // regular output stream
        if(line.match(/^WORKFLOW( NODE)? \[.*\] \([a-z_ ]+\).*$/)){ // awx workflow (node) status lines
          previousformat=""
          matchfound=true
          var statusclass=""
          if(line.match(/\(successful\)/)) statusclass=" has-text-success"
          else if(line.match(/\((failed|error)\)/)) statusclass=" has-text-danger"
          else if(line.match(/\(canceled\)/)) statusclass=" has-text-warning"
          else if(line.match(/\((skipped|pending|waiting)\)/)) statusclass=" has-text-info"
          // escapedLine, like every other branch in this loop. This one concatenated the
          // RAW line, and the line it matches is `WORKFLOW NODE [<name>] (status)` where
          // <name> is an AWX workflow node name - set in AWX, a different trust domain -
          // so a node named `<img src=x onerror=...>` executed in the browser of anyone
          // opening that job. The output is rendered with v-html (AppAnsibleOutput.vue),
          // and the tokens live in localStorage. The status match above deliberately
          // still tests the unescaped `line`; only the concatenation was wrong.
          line = `<span class='has-text-weight-bold${statusclass}'>`+escapedLine+"</span>"
        }else if(line.match(/^\[(DEPRECATION )?WARNING\].*/g)){ // warnings, in ansible's purple
          previousformat="purple"
          matchfound=true
          line = "<span class='has-text-purple'>"+escapedLine+"</span>"
        }else if(line.match(/^\[ERROR\].*/g)){ // errors
          previousformat="danger"
          matchfound=true
          line = "<span class='has-text-danger'>"+escapedLine+"</span>"
        }else if(line.match(/^([A-Z\s]*)[^*]*(\*+)$/g)){ // task line with **** // mark play / task lines as bold
          previousformat=""
          matchfound=true
          if(i>1){
            line = "<span class='has-text-weight-bold'>" + escapedLine + "</span>"
          }else{
            // it's a fresh line/// ansible output assumed
            line = "\n<span class='has-text-weight-bold'>" + escapedLine + "</span>"
          }
          // if task line matches filter regex, register this task as low
          // guarded : an uncompilable REGEX_FILTER_JOB_OUTPUT threw from here, and this
          // runs for every line of every job - so one bad character made every job
          // unviewable rather than merely unfiltered
          var filter=Helpers.safeRegExp(config.filterJobOutputRegex, "\\[low\\]", "i", "REGEX_FILTER_JOB_OUTPUT")
          if(line.match(filter)){
            filterOutput=true
          }else{
            filterOutput=false
          }
        }else if(line.match(/^(fatal|failed): \[([^\]]*)\].*/g)){ // a host that failed : red, as ansible
          previousformat="danger"
          matchfound=true
          line = "<span class='has-text-danger'>" + escapedLine + "</span>"
        }else if(line.match(/^FAILED - RETRYING: /)){ // a retry : ansible's grey
          previousformat=""
          matchfound=true
          line = "<span class='has-text-muted'>" + escapedLine + "</span>"
        }else if(line.match(/^(included: |\.\.\.ignoring)/)){ // an include, an ignored error : ansible's cyan
          previousformat=""
          matchfound=true
          line = "<span class='has-text-info'>" + escapedLine + "</span>"
        }else if(line.match(/^(ok): \[([^\]]*)\].*/g)){ // mark succes lines
          matchfound=true
          previousformat="success"
          line = "<span class='has-text-success'>" + escapedLine + "</span>"
        }else if(line.match(/^(changed): \[([^\]]*)\].*/g)){ // mark change lines
          previousformat="warning"
          matchfound=true
          line = "<span class='has-text-warning'>" + escapedLine + "</span>"
        }else if(line.match(/^(skipping): \[([^\]]*)\].*/g)){ // mark skip lines
          previousformat="info"
          matchfound=true
          line = "<span class='has-text-info'>" + escapedLine + "</span>"
        }else if(!matchfound && previousformat && line && line.trim()!='\r\n' && line.trim()){ // if line continues on next line, give same format
          line = `<span class='has-text-${previousformat}'>${escapedLine}</span>`
        }else{
          if(line && line.trim()!='\r\n' && line.trim()){  // is text ?
            line = `<span class=''>${escapedLine}</span>` // then wrap in span
          }
        }        
        // summary line ?
        if(escapedLine.match('ok=.*failed.*')){
          matchfound=true
          previousformat=""
          // the counts in ansible's colours : ok and rescued green, changed amber, failed and
          // unreachable red, skipped cyan, ignored purple ; the host red when it failed or was
          // unreachable, amber when it changed, else green
          var hostclass = escapedLine.match(/(failed|unreachable)=[1-9]/) ? "has-text-danger"
            : escapedLine.match(/changed=[1-9]/) ? "has-text-warning" : "has-text-success"
          line=escapedLine.replace(/^(\s*)(\S+)(\s*:)/, `$1<span class='${hostclass}'>$2</span>$3`)
                      .replace(/(ok=[1-9]+[0-9]*)/g, "<span class='tag is-success'>$1</span>")
                      .replace(/(changed=[1-9]+[0-9]*)/g, "<span class='tag is-warning'>$1</span>")
                      .replace(/(failed=[1-9]+[0-9]*)/g, "<span class='tag is-danger'>$1</span>")
                      .replace(/(unreachable=[1-9]+[0-9]*)/g, "<span class='tag is-danger'>$1</span>")
                      .replace(/(skipped=[1-9]+[0-9]*)/g, "<span class='tag is-info'>$1</span>")
                      .replace(/(rescued=[1-9]+[0-9]*)/g, "<span class='tag is-success'>$1</span>")
                      .replace(/(ignored=[1-9]+[0-9]*)/g, "<span class='tag is-purple'>$1</span>")
        }
        if(filterOutput){
          line=line.replace(/class='/g,"class='low ")
        }
      }
      lineoutput.push(line)
    }) // end line loop
    // the record's lines as ansible printed them : no time of our own added (a record is a batch
    // of output as it arrived, its time not a line's, nor a task's)
    lineoutput.forEach(function(el2){
      output2.push(el2)
    })
    // we merge the intermediate colorized output finally
    output.push(output2.join("\r\n"))
  })
  return output.join("\r\n") // return all as one nice merged string
}

// An operator-supplied group filter, the server side twin of the one login.vue applies to
// Entra ID and OIDC logins. Same contract on purpose: a regular expression matched against
// the BARE group name - before the provider prefix - and an empty pattern means keep
// everything, so `^AF_` means the same thing whichever directory AnsibleForms points at.
//
// A pattern that does not compile must NOT drop the groups. Groups are what
// User.getRolesAndOptions maps to roles, so filtering everything away on a stray bracket
// would quietly demote every directory user to no roles at all - a lockout, with nothing
// at the point of entry to say why. Log it and keep the unfiltered list, which is also what
// login.vue does with an invalid filter. Note the deliberate absence of the `g` flag:
// a global regex carries lastIndex between .test() calls and would match every other group.
Helpers.filterGroups = function(groups, filter) {
  const pattern = (filter || "").trim()
  if (!pattern) return groups
  var regex
  try {
    regex = new RegExp(pattern)
  } catch (e) {
    logger.error(`Group filter '${pattern}' is not a valid regular expression, keeping all groups`)
    return groups
  }
  return groups.filter((group) => regex.test(group))
}

// What of the launching user goes into the extravars as `ansibleforms_user`.
//
// Every launch has always injected the WHOLE user object. With a directory login that is
// the user's complete group membership - a hundred entries is ordinary for AD - plus every
// resolved role option, so a form with ten useful variables ships a hundred lines of
// extravars the playbook never reads, and that group membership is then persisted in the
// AWX job and in jobs.extravars, readable by anyone with read access to the job.
//
// It stays opt in, and the default is the full object. docs/faq.md documents
// `ansibleforms_user.groups` for playbook side authorization ("defence in depth"), so
// trimming by default would silently weaken a check somebody wrote on purpose.
//
//   absent / ""            the full object, as before
//   "all"                  the same, said out loud - for a form overriding a global trim
//   "none"                 no ansibleforms_user at all
//   "username,email,type"  only those top level keys
//
// `formSetting` is a form's own `userExtravars` property and outranks the global one, so a
// single form that really does need the groups can ask for them while the rest of the
// instance stays trimmed. Unknown keys are simply absent rather than present-and-undefined:
// a playbook testing `ansibleforms_user.email is defined` must not see a key that is there
// but empty.
Helpers.userForExtravars = (user, formSetting) => {
  // A BLANK form value inherits rather than overrides. `??` would not do: the designer
  // writes the key away when the box is emptied, but a hand written `userExtravars: ""`
  // is an empty string, and that has to mean "no opinion" like the empty env var does -
  // not "send everything", which would be an override nobody asked for.
  const own = String(formSetting ?? "").trim()
  const setting = own || String(config.extravarsUserFields ?? "").trim()
  if (!setting || setting.toLowerCase() === "all") return user
  if (setting.toLowerCase() === "none") return undefined
  const keys = setting.split(",").map((k) => k.trim()).filter(Boolean)
  if (!keys.length) return user
  const result = {}
  for (const key of keys) {
    if (user && Object.prototype.hasOwnProperty.call(user, key)) result[key] = user[key]
  }
  return result
}

Helpers.dateFromBackupFolder = function(folder, tz = logConfig.tz) {
  try {
    return DateTime.fromFormat(folder, 'yyyyLLddHHmmss', { zone: 'UTC' })
      .setZone(tz)
      .toISO();
  } catch {
    return null;
  }
}

export default Helpers
