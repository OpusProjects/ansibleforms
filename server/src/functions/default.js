// Core Node.js modules
import fs from "fs";
import fsPromises from 'fs/promises';
import path from 'path';
import dns from 'dns';
import https from 'https';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { inspect } from 'node:util';

// Third-party modules
import axios from "axios";
import jq from "node-jq";
import yaml from "yaml";
import JSONbig from 'json-bigint';
import dayjs from "dayjs";
import thenbypkg from "thenby";

const { firstBy } = thenbypkg;

// Project-specific modules
import logger from "../lib/logger.js";
import ip from "../lib/ip.js";
import { shellQuote } from "../lib/shell.js";
import { assertUrlAllowed } from "../lib/hostfilter.js";
import credentialModel from "../models/credential.model.v2.js";
import Errors from "../lib/errors.js";
import Helpers from '../lib/common.js';
import { readSecret, mapPayloadToCredential, parseInlineSecret } from "../secrets/providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jqDef = await fsPromises.readFile(path.join(__dirname, 'jq.definitions'), 'utf8');
const jqCustomDef = await fsPromises.readFile(new URL('./jq.custom.definitions', import.meta.url), 'utf8');

const combinedJqDef = (jqDef + jqCustomDef).replace(/(\r\n|\n|\r)/gm, "");
logger.debug("jq definitions loaded : " + combinedJqDef)

const fnGetNumberedName=function(names,pattern,value,fillgap=false){
  var nr=null
  var nrsequence
  var regex
  var nrs
  var re=new RegExp("[^#]*(#+)[^#]*")
  var patternmatch=re.exec(pattern)
  if(!names || !Array.isArray(names)){
    const e = "[fnGetNumberedName] No input or no array"
    logger.warning(e)
    throw(new Error(e))
  }
  if(patternmatch && patternmatch.length==2){
  	nrsequence=patternmatch[1]
	  regex="^" + pattern.replace(nrsequence,"([0-9]{"+nrsequence.length+"})") + "$"
    nrs=names.map((item)=>{
      var regexp=new RegExp(regex,"g");
      var matches=regexp.exec(item)
      if(matches && matches.length==2){
        return parseInt(matches[1])
      }else{
        null
      }
    }).filter((item)=>(item))
    var gaps=nrs.reduce(function(acc, cur, ind, arr) {
      var diff = cur - arr[ind-1];
      if (diff > 1) {
        var i = 1;
        while (i < diff) {
          acc.push(arr[ind-1]+i);
          i++;
        }
      }
      return acc;
    }, []);
    var max=(nrs.length>0)?Math.max(...nrs):null
    var gap=(gaps.length>0)?Math.min(...gaps):null
    if(max){
      nr=max+1
    }
    if(fillgap && gap){
      nr=gap
    }
    if(nr){
      var tmp = pattern.replace(nrsequence,nr.toString().padStart(nrsequence.length,"0"))
      return tmp
    }else{
      const e = "fnGetNumberedName, no pattern matches found in the list"
      logger.warning(e)
    	return value
    }
  }else{
    const e = "fnGetNumberedName, no pattern found, use ### for numbers"
    logger.warning(e)
	  return value
  }
}
const fnCidr=function(i,n){
  return ip.subnet(i,n)
}
const fnTime=function(d){
  if(d==undefined){
    return dayjs()
  }else{
    return dayjs(d)
  }
}
const fnJq=async function(input,jqe){
    let result=undefined
    if(!jqe){
      logger.warning("[fnJq] jq is empty")
      return result
    }
    try{
      result=await jq.run(combinedJqDef+jqe, input, { input:"json",output:"json" })
    }catch(e){
      logger.error("Error in fnJq : ",e)
      throw(e)
    }
    return result
}
const fnCopy=function(input){
    return input
}

const fnSort=function(input,sort){
  let result=input
  if(!Array.isArray(input)){
    const e = "Warning in fnSort : input is not an array"
    logger.warning(e)
    throw(new Error(e))
  }
  if(!sort){
    const e = "Warning in fnSort : sort list not provided"
    logger.warning(e)
    throw(new Error(e))
  }
  logger.debug("[fnSort] sorting result")
  // force sort to array
  var o = [].concat(sort || [])
  // convert sort to thenBy values
  var order=o.map((e)=>{
          var ks,k,v,t
          t=typeof e
          // if string, return the string
          if(t=="string")return [e]
          // if object
          if(t=="object"){
              // get keys
              ks=Object.keys(e)
              // if empty object, return empty
              if(!ks)return []
              // get first key
              k=(ks)[0];
              // get value of key
              v=e[k];
              // empty key : flat array ; use 0
              if(k=="")k=0
              // if value if empty, return key, otherwise return key and value
              return (v)?[k,v]:[k]
          }
      })
  // console.log(order)
  var first = order[0]
  var rest = order.slice(1)
  let s = rest.reduce((a, e) => a.thenBy(...e), firstBy(...first));
  try{
    result.sort(s)
  }catch(e){
    logger.error("[fnSort] error in fnSort : ",e)
    throw(e)
  }
  return result
}
const fnReadJsonFile = async function(path,jqe=null) {
  if(!path)return undefined
  let result
  try{
    let rawdata = fs.readFileSync(path,'utf8');
    result = JSON.parse(rawdata)
    if(jqe){
      result=await jq.run(combinedJqDef+jqe, result, { input:"json",output:"json" })
    }
  }catch(e){
    logger.error("Error in fnReadJsonFile : ",e)
    throw(e)
  }
  return result
};
const fnReadYamlFile = async function(path,jqe=null) {
  if(!path)return undefined
  let result
  try{
    let rawdata = fs.readFileSync(path,'utf8');
    result = yaml.parse(rawdata)
    if(jqe){
      result=await jq.run(combinedJqDef+jqe, result, { input:"json",output:"json" })
    }
  }catch(e){
    logger.error("Error in fnReadYamlFile : ",e)
    throw(e)
  }
  return result
};
const fnDnsResolve = async function(hostname,type) {
  logger.debug("[fnDnsResolve] dns resolve is happening")
  return new Promise((resolve,reject) => {
    dns.resolve(hostname,type,(err,addresses) => {
      if (err) {
        reject(err)
      } else {
        resolve(addresses)
      }
    })
  })
}
const fnCredentials = async function(name,fallbackname="",credJqe=null){
  var result=undefined
  if(name){
    try{
      // Straight from a secret store, no credential row needed :
      //   "secret:<store>:<ref>"  e.g. "secret:cyberark:Safe=Linux;Object=root"
      //   "vault:<path>"          the store named `vault` (HashiCorp Vault)
      const inline = parseInlineSecret(name)
      if (inline) {
        const payload = await readSecret(inline.store, inline.ref)
        let projected = payload
        if (credJqe) {
          projected = await jq.run(combinedJqDef + credJqe, payload, { input: "json", output: "json" })
        }
        result = mapPayloadToCredential(projected)
      } else {
        // the exact name first, with every column of the row ; then the name as a
        // regex, then the fallback - as the docs have always promised
        result = await credentialModel.findByName(name)
        if (!result) {
          try {
            result = await credentialModel.resolveCredential(name, fallbackname)
          } catch (e) {
            if (!(e instanceof Errors.NotFoundError)) throw e
            logger.warning(`fnCredentials : no credential matches '${name}'${fallbackname ? ` or '${fallbackname}'` : ""}`)
          }
        }
        if (result && credJqe) {
          // Allow callers to reshape a stored credential too (rare, but symmetric).
          result = await jq.run(combinedJqDef + credJqe, result, { input: "json", output: "json" })
        }
      }
    }catch(e){
      logger.error("Error getting credentials",e)
      throw(e)
    }
  }
  return result
}
const fnRestBasic = async function(action,url,body,credential=null,jqe=null,sort=null,hasBigInt=false){
  var headers={}
  if(credential){
    const restCreds = await fnCredentials(credential)
    // RFC 7617: username:password must be UTF-8 encoded before base64 encoding
    // This handles special characters like :, @, and UTF-8 characters (é, ñ, 中文, etc.)
    headers.Authorization="Basic " + Buffer.from(restCreds.user + ':' + restCreds.password, 'utf8').toString('base64')
  }
  return await fnRestAdvanced(action,url,body,headers,jqe,sort,hasBigInt)
}
const fnRestAdvanced = async function(action,url,body,headers={},jqe=null,sort=null,hasBigInt=false,raw=false){
  if(!action || !url){
    const e = "[fnRest] No action or url defined"
    logger.warning(e)
    throw(new Error(e))
  }
  
  // Fix URL encoding for special characters like '+' 
  // Parse and reconstruct URL to properly encode query parameters
  try {
    const urlObj = new URL(url);
    // Re-encode query parameters to handle '+' and other special chars
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      urlObj.search = params.toString();
    }
    url = urlObj.toString();
  } catch (e) {
    // If URL parsing fails, use the original URL
    logger.debug(`[fnRestAdvanced] URL parsing failed, using original URL: ${e.message}`);
  }

  // Outbound host allow/deny check (REST_ALLOWED_HOSTS / REST_DENIED_HOSTS).
  // No-op when neither env var is set.
  await assertUrlAllowed(url);

  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  })
  var axiosConfig = {
    headers: {},
    httpsAgent:httpsAgent
  }
  if(hasBigInt){
    logger.debug("Using bigint transform")
    axiosConfig.transformResponse = (data => JSONbig.parse(data) )
  }

  // added in 5.0.10
  if (headers && typeof headers === "object") {
    for (const key in headers) {

      if (typeof headers[key] === "string") {
        // logger.debug(`[fnRestAdvanced] processing header ${key} with value ${headers[key]}`);
        let m;
        // base64(credential_name) - for Basic auth
        if ((m = headers[key].match(/base64\(([^)]+)\)/i))) {
          // logger.debug(`[fnRestAdvanced] base64 encoding for header ${key} with credential ${m[1]}`);
          const cred = await fnCredentials(m[1]);
          if (cred && cred.user && cred.password) {
            // RFC 7617: UTF-8 encode username:password before base64 encoding
            headers[key] = headers[key].replace(/base64\(([^)]+)\)/i,Buffer.from(cred.user + ":" + cred.password, 'utf8').toString("base64"))
          }
        }
        // password(credential_name)
        else if ((m = headers[key].match(/password\(([^)]+)\)/i))) {
          // logger.debug(`[fnRestAdvanced] password substitution for header ${key} with credential ${m[1]}`);
          const cred = await fnCredentials(m[1]);
          if (cred && cred.password) {
            headers[key]=headers[key].replace(/password\([^)]+\)/i, cred.password);
          }
        }
        // username(credential_name)
        else if ((m = headers[key].match(/username\(([^)]+)\)/i))) {
          // logger.debug(`[fnRestAdvanced] username substitution for header ${key} with credential ${m[1]}`);
          const cred = await fnCredentials(m[1]);
          if (cred && cred.user) {
            headers[key]=headers[key].replace(/username\([^)]+\)/i, cred.user);
          }
        }
      }
    }
  }

  // logger.debug(`[fnRestAdvanced] action: ${action}, url: ${url}, body: ${JSON.stringify(body)}, headers: ${JSON.stringify(headers)}`)

  if(typeof headers=="object"){
    axiosConfig.headers=headers
  }

  let result
  let data=null
  try{
    if(action=="get"){
      data = await axios.get(url,axiosConfig);
    }else if(action=="post"){
      data = await axios.post(url,body,axiosConfig);
    }else if(action=="delete"){
      data = await axios.post(url,axiosConfig);
    }else if(action=="put"){
      data = await axios.put(url,body,axiosConfig);
    }
    if(raw) return {data:data.data,response_headers:data.headers} // return raw data
    result=data.data
    if(jqe){
      result=await jq.run(combinedJqDef+jqe, result, { input:"json",output:"json" })
    }
    if(sort)result=fnSort(result,sort)
  }catch(e){
    logger.error("Error in fnRestAdvanced : ",e)
    throw(e)
  }
  return result

}
const fnRestJwt = async function(action,url,body,token,jqe=null,sort=null,hasBigInt=false,tokenPrefix="Bearer"){
  var headers={}
  if(token){
    headers.Authorization=tokenPrefix + " " + token
  }
  return await fnRestAdvanced(action,url,body,headers,jqe,sort,hasBigInt)
}
const fnRestJwtSecure = async function(action,url,body,tokenname,jqe=null,sort=null,hasBigInt=false,tokenPrefix="Bearer"){
  var headers={}
  if(tokenname){
    var token = await fnCredentials(tokenname)
    headers.Authorization=tokenPrefix + " " + token.password
  }
  return await fnRestAdvanced(action,url,body,headers,jqe,sort,hasBigInt)
}
const fnSsh = async function(user,host,cmd,jqe=null){

  var result= await new Promise((resolve,reject)=>{
    // Form-controlled values — must be properly shell-escaped before going
    // through `exec` (which uses /bin/sh -c). The previous .replace/.replaceAll
    // calls were not real escaping (single replace, not all occurrences, and
    // no protection against $(), backticks, ;, &&, ||).
    const command=`ssh ${shellQuote(`${user}@${host}`)} ${shellQuote(cmd)}`
    logger.debug(`invoking ssh : ${command}`)
    var child = exec(command,{encoding: "UTF-8"});
    var output=[]
    
    // add output eventlistener to the process to save output
    child.stdout.on('data',function(data){
      // save the output ; but whilst saving, we quickly check the status to detect abort
      data.split(/\r?\n/).forEach(element => {
        output.push(element)
      });
    })
    // add error eventlistener to the process to save output
    child.stderr.on('data',function(data){
      // save the output ; but whilst saving, we quickly check the status to detect abort
      data.split(/\r?\n/).forEach(element => {
        output.push(element)
      });
    })
    // add exit eventlistener to the process to handle status update
    child.on('exit',function(data){
      output.push(`exit(${data})`)

      resolve(output)
    })
    // add error eventlistener to the process; set failed
    child.on('error',function(data){
      output.push(Helpers.getError())
      logger.error(inspect(data))
      reject(output)
    })  
  })
  if(jqe){
    result=await jq.run(combinedJqDef+jqe, result, { input:"json",output:"json" })
  }
  return result

}
/**
 * List the contents of a directory (optionally recursively), with optional regex filtering.
 * @param {string} dirPath - The path to the directory to list.
 * @param {object} options - Options: { regex, recursive, metadata }
 * @returns {Promise<string[]|object[]>} - Array of file/folder names (if metadata=false) or objects with metadata (if metadata=true)
 */
export async function fnLs(dirPath, options = {}) {
  const results = [];
  let regex = null;
  if (options.regex) {
    regex = options.regex instanceof RegExp ? options.regex : new RegExp(options.regex);
  }
  const includeMetadata = options.metadata === true;
  
  async function walk(currentPath, relPath = "") {
    const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const isDirectory = entry.isDirectory();
      const entryName = entry.name + (isDirectory ? "/" : "");
      const fullRelPath = relPath ? path.posix.join(relPath, entryName) : entryName;
      const fullAbsPath = path.join(currentPath, entry.name);
      
      if (!regex || regex.test(fullRelPath)) {
        if (includeMetadata) {
          // Get file stats for metadata
          const stats = await fsPromises.stat(fullAbsPath);
          results.push({
            path: fullRelPath,
            name: entry.name,
            type: isDirectory ? 'directory' : 'file',
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            accessed: stats.atime,
            mode: stats.mode,
            isDirectory: isDirectory,
            isFile: stats.isFile(),
            isSymbolicLink: stats.isSymbolicLink()
          });
        } else {
          results.push(fullRelPath);
        }
      }
      
      if (options.recursive && isDirectory) {
        await walk(fullAbsPath, relPath ? path.posix.join(relPath, entry.name) : entry.name);
      }
    }
  }
  await walk(dirPath, "");
  return results;
}


/**
 * Fetches HTML content from a URL and extracts data using regex groups
 * @param {string} url - The URL to fetch HTML from
 * @param {string} regexPattern - The regex pattern with capture groups
 * @param {string} regexFlags - Optional regex flags (e.g., 'gi', 'i', 'g')
 * @returns {Promise<Array>} - Array of objects containing all group matches
 */
const fnParseHtmlWithRegex = async function(url, regexPattern, regexFlags = 'g', credential = null) {
  logger.debug(`[fnParseHtmlWithRegex] Fetching HTML from: ${url}`);
  logger.debug(`[fnParseHtmlWithRegex] Using regex pattern: ${regexPattern}`);
  
  try {
    // Dynamically import axios
    const { default: axios } = await import('axios');
    
    // Setup request headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };
    
    // Add Basic Authentication if credential provided
    if (credential) {
      const creds = await fnCredentials(credential);
      if (creds && creds.user && creds.password) {
        // RFC 7617: UTF-8 encode username:password before base64 encoding
        // Handles special chars (:, @) and UTF-8 characters (é, ñ, 中文, etc.)
        headers.Authorization = "Basic " + Buffer.from(creds.user + ':' + creds.password, 'utf8').toString('base64');
        logger.debug(`[fnParseHtmlWithRegex] Using basic authentication with credential: ${credential}`);
      }
    }
    
    // Fetch HTML content
    const response = await axios.get(url, {
      timeout: 30000, // 30 second timeout
      headers: headers
    });
    
    logger.debug(`[fnParseHtmlWithRegex] Successfully fetched ${response.data.length} characters`);
    
    // Create regex object
    const regex = new RegExp(regexPattern, regexFlags);
    const matches = [];
    let match;
    
    // Extract all matches with groups
    while ((match = regex.exec(response.data)) !== null) {
      const matchResult = {
        fullMatch: match[0],
        groups: [],
        namedGroups: match.groups || {}
      };
      
      // Add numbered groups (excluding index 0 which is the full match)
      for (let i = 1; i < match.length; i++) {
        matchResult.groups.push(match[i]);
      }
      
      matches.push(matchResult);
      
      // Prevent infinite loops on global regex without 'g' flag
      if (!regexFlags.includes('g')) break;
    }
    
    logger.debug(`[fnParseHtmlWithRegex] Found ${matches.length} matches`);
    return matches;
    
  } catch (error) {
    logger.error(`[fnParseHtmlWithRegex] Error: ${error.message}`);
    throw new Error(`Failed to fetch HTML or parse regex: ${error.message}`, { cause: error });
  }
};

// etc
export default {
  fnGetNumberedName,
  fnCidr,
  fnTime,
  fnJq,
  fnCopy,
  fnSort,
  fnReadJsonFile,
  fnReadYamlFile,
  fnDnsResolve,
  fnCredentials,
  fnRestBasic,
  fnRestAdvanced,
  fnRestJwt,
  fnRestJwtSecure,
  fnSsh,
  fnLs,
  fnParseHtmlWithRegex  
};
