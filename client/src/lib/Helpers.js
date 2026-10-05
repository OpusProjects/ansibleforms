import { copyText } from 'vue3-clipboard';
import { buildFormOutput as engineBuildFormOutput } from '@engine/output.js';
import { getFieldValue as engineGetFieldValue } from '@engine/placeholders.js';

const Helpers = {
  // Turns help.yaml's `allowed` text into select options when - and only when - it really
  // is a short enum. 'true, false' and '1, 2' become dropdowns ; 'a valid Vault token' and
  // 'a url subpath, for example /ansibleforms' stay free text.
  //
  // This matters beyond tidiness: the server tests a boolean like VAULT_SKIP_VERIFY against
  // the literals it knows, so 'yes' or 'on' silently do nothing. A
  // dropdown that can only emit the documented literals removes that whole class of typo.
  envAllowedOptions(allowed) {
    if (!allowed) return null;
    const parts = String(allowed).split(',').map(p => p.trim());
    // 12, not 6 : the syslog levels are an eight-value enum and winston-syslog accepts
    // eleven protocol strings. Both are real enums a dropdown should offer in full.
    if (parts.length < 2 || parts.length > 12) return null;
    if (!parts.every(p => /^[\w.:-]{1,12}$/.test(p))) return null;
    // A documented `0, 1` enum is a boolean: show it as such and keep submitting 0/1,
    // because the code tests these with `== 1` (SHOW_DESIGNER, USE_YTT, ENABLE_*). Only an
    // exact 0/1 pair is treated this way - VAULT_KV_VERSION is also two numbers, but 1 and
    // 2 are versions, not a truth value.
    const isBoolean = parts.length === 2 && parts[0] === '0' && parts[1] === '1';
    return parts.map(p => ({ value: p, label: isBoolean ? (p === '1' ? 'true' : 'false') : p }));
  },

  findDuplicates(arry) {
    return arry.filter((item, index) => arry.indexOf(item) !== index);
  },
  htmlEncode(v){
    return v.toString().replace(/[\u00A0-\u9999<>\&]/g, function(i) { //eslint-disable-line
      return '&#'+i.charCodeAt(0)+';';
    });
  },  
  parseAxiosResponseError(err, custom="An error occurred") {
    // Parse Axios error
    if (err.response) {
      // The request was made and the server responded with a status
      const message = err.response.data?.message || err.response.data?.error || custom;
      const details = err.response.data?.details;
      return details ? `${message}: ${details}` : message;
    } else{
      return err.message || custom;
    }
  },
  // Cookie helpers for simple client-side persistence
  setCookie(name, value, days = 365) {
    try{
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      const expires = "expires=" + d.toUTCString();
      document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
    }catch(e){
      console.error('setCookie failed', e)
    }
  },
  getCookie(name) {
    try{
      const cname = encodeURIComponent(name) + "=";
      const decoded = decodeURIComponent(document.cookie || "");
      const parts = decoded.split('; ');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].indexOf(cname) === 0) return parts[i].substring(cname.length);
      }
      return null;
    }catch(e){
      return null
    }
  },
  deleteCookie(name){
    try{
      document.cookie = encodeURIComponent(name) + "=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/";
    }catch(e){
      console.error('deleteCookie failed', e)
    }
  },
  // Normalize a string to a safe form: remove accents, lowercase, replace non-alphanumerics with
  // underscores, collapse multiple underscores and trim leading/trailing underscores.
  cleanupString(v){
    if (v === undefined || v === null) return '';
    try{
      // normalize and remove diacritics
      let s = String(v).normalize('NFKD').replace(/\p{M}/gu, '');
      s = s.toLowerCase();
      // replace any non-alphanumeric characters with underscore
      s = s.replace(/[^a-z0-9]+/g, '_');
      // collapse multiple underscores
      s = s.replace(/_+/g, '_');
      // trim leading/trailing underscores
      s = s.replace(/^_+|_+$/g, '');
      return s;
    }catch(e){
      return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
    }
  },
  getJobMessageByStatus(status) {
    // get the message by status
    // used in the job list
    switch (status) {
      case "running":
        return "Job is running";
      case "success":
        return "Job completed successfully";
      case "failed":
        return "Job failed";
      case "approve":
        return "Job is waiting for approval";
      case "warning":
        return "Job completed with warnings";
      case "aborted":
        return "Job was aborted";
      case "rejected":
        return "Job was rejected";
      case "abandoned":
        return "Job was abandoned";
      default:
        return "Unknown job status";
    }
  },
  getColorClassByStatus(status, prefix = "text") {
    // get the color class by status
    // used in the job list
    switch (status) {
      case "running":
        return prefix + "-info";
      case "success":
        return prefix + "-success";
      case "failed":
        return prefix + "-danger";
      case "approve":
      case "warning":
      case "aborted":
      case "rejected":
      case "abandoned":
        return prefix + "-warning";
      default:
        return "body";
    }
  },
  // Show a server timestamp in the timezone the SERVER already put it in.
  //
  // Some endpoints deliberately convert to the application timezone before sending
  // (backup dates come from Helpers.dateFromBackupFolder on the server, which parses
  // the UTC folder name and applies LOG_TZ). Passing that through dayjs() converts it
  // a second time, into the browser's zone - which is why a backup folder named
  // ...20260726002146 displayed as 02:21 in a +02:00 browser, disagreeing with its own
  // folder name. Read the wall clock straight out of the ISO string instead.
  // Returns ONLY a `YYYY-MM-DD HH:MM:SS` string or ''. It never echoes its input back,
  // because BsDataTable treats a column `render()` result as trusted HTML (cellHtml does
  // not escape it) - a pass-through formatter in that slot would be an injection sink.
  formatServerDate(value) {
    if (!value) return '';
    const text = typeof value === 'string'
      ? value
      // a Date or a number would otherwise render as 'Sun Jul 26 2026 …' or an epoch
      : (value instanceof Date ? value.toISOString() : String(value));
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(text);
    return m ? `${m[1]} ${m[2]}` : '';
  },
  humanFileSize(size) {
    if(size==undefined)return "Not a number"
    var i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
  },  
  deepClone(o){
    if(o===undefined){
      return o
    }
    try{
      return (JSON.parse(JSON.stringify(o)))
    }catch(e){
      console.error("Failed deepcloning - ",e)
      return undefined
    }
    
  },
  // avoid circular references and skip cloning __user__ and window properties which can cause issues
  safeDeepClone(obj, visited = new Map()) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Cirkel gedetecteerd? Geef de al gemaakte kopie terug.
    if (visited.has(obj)) {
      return visited.get(obj);
    }

    if (Array.isArray(obj)) {
      const arrClone = [];
      visited.set(obj, arrClone);
      for (const item of obj) {
        arrClone.push(this.safeDeepClone(item, visited));
      }
      return arrClone;
    }

    const objClone = {};
    visited.set(obj, objClone);

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (key === '__user__' || key === 'window') continue;
        objClone[key] = this.safeDeepClone(obj[key], visited);
      }
    }

    return objClone;
  },
  // Build a field-driven output object (the same shape used for main-form
  // extravars). Honours `output`, `outputObject`, `valueColumn`, dotted
  // `model` paths (including array indexes like `a.b[0].c`) and the datetime
  // month fix (0-11 -> 1-12). Pure function - returns a new object.
  //
  //   fields      : array of formfield definitions
  //   raw         : a flat { fieldName: value } source (e.g. form.value or a
  //                 subform draft)
  //   opts.isVisible : optional (item) => boolean; fields that are not
  //                 visible are skipped (used by the main form)
  //   opts.overrides : optional { fieldName: value } map - when a name is
  //                 present here it is used instead of `raw[name]` (used by
  //                 the main form to inject uploaded file metadata)
  //   opts.subforms : optional array of subform definitions; used to resolve
  //                 `field.subform` (string name) to the subform object so
  //                 list rows are rebuilt recursively through the subform's
  //                 fields (honours model/output/outputObject per row)
  // the form engine shared with the server (@engine/output.js) - the server builds the
  // same extravars from the same code (MCP, LAUNCH_VALIDATION=enforce)
  buildFormOutput(fields, raw, opts = {}){
    return engineBuildFormOutput(fields, raw, opts);
  },

  // Build the output for a single wizard step. Same rules as buildFormOutput,
  // but with `defaultModel` (a dotted prefix declared on the wizard step)
  // applied as a wrapper around each field's `model` (or `name` when no
  // explicit model is set).
  //
  //   - fields without a `model` -> wrapped under `<defaultModel>.<name>`
  //   - fields with a relative `model` -> wrapped under `<defaultModel>.<model>`
  //   - fields with an absolute `model` (leading "/") -> escape the prefix
  //     and write at the wizard root (the leading slash is stripped)
  //
  // The original field definitions are not mutated; we shallow-clone each
  // field to override `model` before delegating to buildFormOutput.
  buildWizardStepOutput(fields, raw, defaultModel, opts = {}) {
    const prefix = (typeof defaultModel === 'string' && defaultModel.trim())
      ? defaultModel.trim().replace(/^\.+|\.+$/g, '')
      : '';
    const wrapped = (fields || []).map((item) => {
      if (!item || !item.name) return item;
      // honour absolute models with leading "/" -> root, strip the slash
      const rawModel = item.model;
      const apply = (m) => {
        if (typeof m !== 'string') return m;
        if (m.startsWith('/')) return m.slice(1);            // escape prefix
        return prefix ? `${prefix}.${m}` : m;
      };
      let nextModel;
      if (Array.isArray(rawModel)) {
        nextModel = rawModel.map(apply);
      } else if (typeof rawModel === 'string') {
        nextModel = apply(rawModel);
      } else {
        // no model declared -> synthesise from field name
        nextModel = prefix ? `${prefix}.${item.name}` : item.name;
      }
      return { ...item, model: nextModel };
    });
    return this.buildFormOutput(wrapped, raw, opts);
  },

  // Deep-merge `src` into `dst` (mutates dst, returns it). Plain objects
  // recurse; arrays / scalars overwrite. Used by the wizard to combine
  // per-step outputs into a single extravars object.
  deepMerge(dst, src) {
    if (src == null || typeof src !== 'object' || Array.isArray(src)) return src;
    if (dst == null || typeof dst !== 'object' || Array.isArray(dst)) dst = {};
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v)
          && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) {
        dst[k] = this.deepMerge(dst[k], v);
      } else {
        dst[k] = this.deepClone(v);
      }
    }
    return dst;
  },
  
  // Recursively strip internal fields from objects/arrays (for YAML downloads).
  // Removes __output__, __user__, __parent__ and any additional fields specified.
  stripInternalFields(obj, additionalFieldsToStrip = []) {
    if (Array.isArray(obj)) {
      return obj.map(item => this.stripInternalFields(item, additionalFieldsToStrip));
    } else if (obj && typeof obj === 'object') {
      const cleaned = {};
      const internalFields = ['__output__', '__user__', '__parent__', ...additionalFieldsToStrip];
      for (const [key, value] of Object.entries(obj)) {
        // Skip internal fields and any additional fields to strip
        if (internalFields.includes(key) || key.startsWith('__')) {
          continue;
        }
        cleaned[key] = this.stripInternalFields(value, additionalFieldsToStrip);
      }
      return cleaned;
    }
    return obj;
  },

  // Return a deep clone of `data` with values for password-typed fields
  // replaced by a fixed bullet mask. Intended ONLY for display (read-only
  // YAML previews, the extravars panel). The original object is never
  // mutated, so anything sent on submit / copied / downloaded keeps the
  // real value.
  //
  //   data     : an output-shaped object/array (typically the result of
  //              buildFormOutput, or a saved __output__ blob)
  //   fields   : field definitions whose `model` (or `name`) describes
  //              where each value lives in `data`
  //   subforms : optional subform list, used to recurse through `list`
  //              rows and `yaml`-with-subform fields
  maskPasswordsForDisplay(data, fields, subforms = []) {
    if (data == null || !Array.isArray(fields)) return data;
    const cloned = this.deepClone(data);
    if (cloned == null) return data;
    const subformByName = Object.fromEntries((subforms || []).map(s => [s.name, s]));
    const MASK = '••••••••';

    const setAtPath = (target, path, value) => {
      if (!target || typeof target !== 'object') return;
      const parts = String(path).split('.');
      let cur = target;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur == null || typeof cur !== 'object') return;
        cur = cur[parts[i]];
      }
      if (cur && typeof cur === 'object') {
        const last = parts[parts.length - 1];
        if (last in cur && cur[last] != null && cur[last] !== '') {
          cur[last] = value;
        }
      }
    };

    const getAtPath = (target, path) => {
      if (!target || typeof target !== 'object') return undefined;
      const parts = String(path).split('.');
      let cur = target;
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
      }
      return cur;
    };

    const walk = (target, fieldDefs) => {
      if (!target || typeof target !== 'object' || !Array.isArray(fieldDefs)) return;
      for (const f of fieldDefs) {
        if (!f || !f.name) continue;
        if (f.output === false) continue;
        const paths = [].concat(f.model || f.name);
        if (f.type === 'password') {
          for (const p of paths) setAtPath(target, p, MASK);
        } else if (f.type === 'list') {
          const sub = (typeof f.subform === 'string') ? subformByName[f.subform] : f.subform;
          if (sub && Array.isArray(sub.fields)) {
            for (const p of paths) {
              const arr = getAtPath(target, p);
              if (Array.isArray(arr)) {
                for (const row of arr) {
                  if (row && typeof row === 'object') walk(row, sub.fields);
                }
              }
            }
          }
        } else if (f.type === 'yaml' && f.subform) {
          const sub = (typeof f.subform === 'string') ? subformByName[f.subform] : f.subform;
          if (sub && Array.isArray(sub.fields)) {
            for (const p of paths) {
              const obj = getAtPath(target, p);
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) walk(obj, sub.fields);
            }
          }
        }
      }
    };

    walk(cloned, fields);
    return cloned;
  },
  
  // Resolve placeholders in title strings (titleAdd, titleEdit) with __parent__ context.
  // Used by subform editors to show dynamic titles based on parent form data.
  resolveTitlePlaceholders(str, contextData) {
    if (!str || typeof str !== 'string') return str;
    
    return str.replace(/\$\(([^)]+)\)/g, (_, match) => {
      try {
        // Build context with __parent__ so titles can use $(__parent__.fieldname)
        const context = {
          ...(contextData || {}),
          __parent__: contextData || {}
        };
        const val = this.replacePlaceholders(match, context);
        return val !== undefined ? val : `$(${match})`;
      } catch (e) {
        // If placeholder resolution fails, keep the original
        return `$(${match})`;
      }
    });
  },
  
  // Apply subform modeling transformation to raw data after loading from YAML.
  // Builds __output__ property so modeled structure is immediately visible.
  // Handles both single objects (yaml+subform) and arrays (list fields).
  applySubformModeling(rawData, subformFields, subforms = []) {
    if (!subformFields || !rawData) return rawData;
    
    // Handle array of rows (list fields)
    if (Array.isArray(rawData)) {
      return rawData.map(rawRow => {
        if (typeof rawRow === 'object' && !Array.isArray(rawRow)) {
          const built = this.buildFormOutput(subformFields, rawRow, { subforms });
          return { ...rawRow, __output__: built };
        }
        return rawRow;
      });
    }
    
    // Handle single object (yaml+subform fields)
    if (typeof rawData === 'object' && !Array.isArray(rawData)) {
      const built = this.buildFormOutput(subformFields, rawData, { subforms });
      return { ...rawData, __output__: built };
    }
    
    return rawData;
  },
  
  // the form engine shared with the server (@engine/placeholders.js)
  getFieldValue(field, column, keepArray) {
    return engineGetFieldValue(field, column, keepArray);
  },
  replacePlaceholders(match,object){
    if(match.match(/^[a-zA-Z0-9_\-\[\]\.]*$/)){ /* eslint-disable-line */
      // Walk the path, a.b[0].c, one key at a time. This used to build "object['a']['b'][0]"
      // and eval it; a missing step still throws the same TypeError, which callers catch.
      const keys=match.replaceAll("[",".").replaceAll("]",".").split(".").filter(x=>!(x===""))
      let value=object
      for(const key of keys){
        value=value[/^-?\d+$/.test(key)?Number(key):key]
      }
      return value
    } else{
      return `$(${match})` // return original
    }
  },  
  /**
   * Splice a resolved value into an expression, at the FIRST occurrence of its placeholder.
   *
   * An expression is JS source, so where the placeholder sits decides how the value has to
   * be written - and getting that wrong is silent, because the result is still valid JS:
   *
   *   fn.fnLs('$(dir)')            the quotes wrap the placeholder -> they are replaced
   *                                together with it by a JS literal, so a value carrying an
   *                                apostrophe ("O'Brien") cannot break out of the string
   *   fn.fnLs('$(dir)/vars')       the placeholder is INSIDE a longer string -> the value is
   *                                escaped for that quote character and spliced in as text.
   *                                A JS literal here injected its own quotes into the middle
   *                                of the string : '$(dir)/vars' with /app/persistent became
   *                                '"/app/persistent"/vars', which is what ENOENT'd on every
   *                                path and url built this way (the documented AWX examples
   *                                in https://ansibleforms.com/faq are all of this shape).
   *   $(count) + 1                 no string at all -> a JS literal, so a number stays a
   *                                number and still adds instead of concatenating.
   *
   * @param {string} expression   the expression still holding the placeholder
   * @param {string} placeholder  the literal placeholder text, e.g. "$(dir)"
   * @param {*} value             the resolved value, or its JS source when isSource is set
   * @param {boolean} isSource    value is already JS/JSON source (an array/object literal)
   *                              and must be spliced in as-is rather than stringified
   * @returns {string} the expression with that one occurrence substituted
   */
  substituteExpressionPlaceholder(expression, placeholder, value, isSource = false) {
    // A prior placeholder in the same expression can still be unresolved (the loop that
    // calls this keeps going to later matches regardless), leaving expression undefined -
    // mirror the old `value?.replace(...)` safety instead of throwing on .indexOf.
    if (expression == null) return expression;
    const at = expression.indexOf(placeholder);
    if (at < 0) return expression;
    const end = at + placeholder.length;
    const quote = this.quoteContextAt(expression, at);
    // Everything below concatenates slices : a value containing $& or $1 must never be read
    // as a replacement pattern, which is what String.replace with a string replacement does.
    if (!quote) {
      const literal = isSource ? value : JSON.stringify(value);
      return expression.slice(0, at) + literal + expression.slice(end);
    }
    if (expression[at - 1] === quote && expression[end] === quote) {
      const literal = isSource ? value : JSON.stringify(value);
      return expression.slice(0, at - 1) + literal + expression.slice(end + 1);
    }
    // JSON escapes \ , " and the control characters ; the enclosing quote is added on top,
    // and a real newline becoming \n also keeps the expression on one line, which the
    // server refuses outright.
    // isSource : the value is JS/JSON source, and inside a string only the TEXT it denotes
    // belongs there. For an ARRAY or OBJECT that is the JSON text itself, escaped for the
    // string it lands in so it reads back identically. For a STRING it is the string
    // WITHOUT the quotes JSON put around it : a dotted read such as
    // $(ANSIBLE_FORMS.persistent_path) takes the object-reference branch in AppForm and so
    // arrives here as source, yet resolves to a plain path. Escaping those quotes and
    // splicing them in rebuilt the very bug this function exists to fix, only spelled
    // '\"/app/persistent\"/playbooks/...' instead of '"/app/persistent"/playbooks/...'.
    let raw = value;
    if (isSource) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') raw = parsed;
      } catch { /* not JSON after all - splice the source in as text, unchanged */ }
    }
    const body = JSON.stringify(String(raw)).slice(1, -1);
    const text = quote === "'" ? body.replace(/'/g, "\\'") : body;
    return expression.slice(0, at) + text + expression.slice(end);
  },

  /**
   * Which quote character, if any, encloses position `index` of a JS expression.
   *
   * Only ' and " are string delimiters here : a backtick is refused outright by the server
   * expression sanitizer, so a template literal never reaches evaluation anyway.
   *
   * @param {string} expression
   * @param {number} index
   * @returns {string|null} the enclosing quote character, or null outside any string
   */
  quoteContextAt(expression, index) {
    let quote = null;
    for (let i = 0; i < index; i++) {
      const c = expression[i];
      if (quote) {
        if (c === '\\') { i++; continue; }   // an escaped character, quote included
        if (c === quote) quote = null;
      } else if (c === "'" || c === '"') {
        quote = c;
      }
    }
    return quote;
  },

  forceFileDownload(response) {
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    let filename = response.headers['content-disposition'].split('filename=')[1].replace(/"/g, '')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
  },
  diff(arrA, arrB) {
    let diff = [];
    function isEq(a, b) {
      // Handle null/undefined cases
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (typeof a !== 'object' || typeof b !== 'object') return a === b;
      
      var aProps = Object.getOwnPropertyNames(a);
      var bProps = Object.getOwnPropertyNames(b);
      if (aProps.length != bProps.length) {
        return false;
      }
      for (var i = 0; i < aProps.length; i++) {
        var propName = aProps[i];
        if (a[propName] !== b[propName]) {
          return false;
        }
      }
      return true;
    }      
    arrA.forEach(itemA => {
      if (!arrB.some(itemB => isEq(itemA, itemB))) {
        diff.push(itemA);
      }
    })
    arrB.forEach(itemB => {
      if (!diff.some(p => isEq(itemB, p)) && !arrA.some(itemA => isEq(itemA, itemB))) {
        diff.push(itemB);
      }
    })
    return diff;
  },
  evalSandbox(expression){
    function fnToTable(data, {
          tableClass = '',
          escapeHtml = true,
          emptyCell = '',
          includeHeader = true
        } = {}){
      if (!Array.isArray(data) || data.length === 0) {
        return '<table' + (tableClass ? ` class="${tableClass}"` : '') + '></table>';
      }
      const escape = escapeHtml
        ? (s) => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
        : (s) => String(s);
      const columns = [...new Set(data.flatMap(obj => Object.keys(obj)))];
      const thead = includeHeader
        ? '<thead><tr>' + columns.map(col => `<th>${escape(col)}</th>`).join('') + '</tr></thead>'
        : '';
      const tbody = '<tbody>' + data.map(row =>
        '<tr>' + columns.map(col =>
          `<td>${row[col] === undefined || row[col] === null ? emptyCell : escape(row[col])}</td>`
        ).join('') + '</tr>'
      ).join('') + '</tbody>';
      return `<table${tableClass ? ` class="${tableClass}"` : ''}>${thead}${tbody}</table>`;
    }    
    // local autonumbering
    function fnGetNumberedName(names,pattern,value,fillgap=false){
      var nr=null
      var nrsequence
      var regex
      var nrs
      var re=new RegExp("[^\#]*(\#+)[^\#]*") // eslint-disable-line
      var patternmatch=re.exec(pattern)
      if(!names || !Array.isArray(names)){
        // console.log("fnGetNumberedName, No input or no array")
        return value
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
          // console.log("fnGetNumberedName, no pattern matches found in the list")
          return value
        }
      }else{
        // console.log("fnGetNumberedName, no pattern found, use ### for numbers")
        return value
      }
    }    
    function matchRuleShort(str, rule) {
      var escapeRegex = (str) => str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1"); // eslint-disable-line
      return new RegExp("^" + rule.split("*").map(escapeRegex).join(".*") + "$").test(str);
    }

    function compareProps(x1,x2,p){
      for(let i=0;i<p.length;i++){
        const x=p[i]

        if(!matchRuleShort(x1[x],x2[x])){
          return false
        }
      }
      return true
    }

    function comparePropsRegex(x1,x2,p){
      for(let i=0;i<p.length;i++){
        const x=p[i]

        if(!x1[x].match(x2[x])){
          return false
        }
      }
      return true
    }

    function dynamicSort(property) {
        var sortOrder = 1;
        if(property[0] === "-") {
            sortOrder = -1;
            property = property.substr(1);
        }
        return function (a,b) {
            /* next line works with strings and numbers,
             * and you may want to customize it to your needs
             */
            var result = (a[property] < b[property]) ? -1 : (a[property] > b[property]) ? 1 : 0;
            return result * sortOrder;
        }
    }

    function dynamicSortMultiple() {
        /*
         * save the arguments object as it will be overwritten
         * note that arguments object is an array-like object
         * consisting of the names of the properties to sort by
         */
        var props = arguments;
        return function (obj1, obj2) {
            var i = 0, result = 0, numberOfProperties = props.length;
            /* try getting a different result from 0 (equal)
             * as long as we have extra properties to compare
             */
            while(result === 0 && i < numberOfProperties) {
                result = dynamicSort(props[i])(obj1, obj2);
                i++;
            }
            return result;
        }
    }


    class fnArray extends Array {
        sortBy(...args) {
            return this.sort(dynamicSortMultiple(...args));
        }
        distinctBy(...props) {
          return this.filter((item, index, arr) =>
            index === arr.findIndex(other =>
              props.every(prop => item[prop] === other[prop])
            )
          );
        }
        filterBy(...args) {
          let props=Object.keys(args[0])
          return this.filter((x)=>{
            return compareProps(x,args[0],props)
          })
        }
        regexBy(...args) {
          let props=Object.keys(args[0])
          return this.filter((x)=>{
            return comparePropsRegex(x,args[0],props)
          })
        }
        selectAttr(...args) {
          let props=Object.keys(args[0])

          return this.map((x)=>{
            let o = {}
            for(let i=0;i<props.length;i++){
              o[props[i]]=x[args[0][props[i]]]
            }
            return o
          })
        }
    }   
    fnArray.from([]) // to make it available
    fnGetNumberedName([], "###", "") // to make it available
    fnToTable([]) // to make it available
    // The expression runs with the helpers above in scope, as it always has. It is evaluated
    // inside a Function built from a string rather than by a direct eval here: that keeps
    // eval's semantics (the value of the last statement, var declarations, `this`) while the
    // bundler no longer sees a direct eval in this module, which it warns about because it
    // forces every local in scope to be kept unminified.
    if(expression)
    return new Function(
      "fnArray", "fnGetNumberedName", "fnToTable", "matchRuleShort",
      "compareProps", "comparePropsRegex", "dynamicSort", "dynamicSortMultiple",
      "__expression__", "return eval(__expression__)"
    ).call(this, fnArray, fnGetNumberedName, fnToTable, matchRuleShort,
      compareProps, comparePropsRegex, dynamicSort, dynamicSortMultiple, expression)
  },

  /**
   * Copy text to the clipboard, resolving only when it actually happened.
   *
   * vue3-clipboard's signature is copyText(text, container, callback) and it invokes that
   * callback UNGUARDED from inside the synthetic click handler it dispatches. Every call
   * site here passed only the text, so `callback(...)` threw a TypeError - and because
   * that happens inside a DOM event dispatch the exception never reaches the caller's
   * try/catch. So each copy logged an uncaught error, and the success toast fired even
   * when execCommand('copy') had returned false and nothing had been copied at all
   * (a page served over plain http, or a browser that refuses the synthetic copy).
   *
   * @param {string} text
   * @returns {Promise<void>} rejects with the clipboard error when the copy failed
   */
  copyToClipboard(text) {
    return new Promise((resolve, reject) => {
      try {
        copyText(String(text ?? ''), undefined, (err) => (err ? reject(err) : resolve()));
      } catch (e) {
        // a synchronous throw (no document, no selection) still has to reject
        reject(e);
      }
    });
  }

};

export default Helpers;
