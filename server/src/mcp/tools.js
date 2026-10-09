'use strict';
import { z } from 'zod';
import { resolveForm, normalizeFields, isDynamicField } from '../lib/formEngine/resolve.js';
import { scanDependencies } from '../lib/formEngine/placeholders.js';
import { buildLaunchPayload, filterRawFormData, maskPasswords } from '../lib/formEngine/output.js';
import { sha256 } from '../lib/formEngine/node/hash.js';
import { createFormServices } from '../lib/formServices.js';
import { describeRowErrors } from '../lib/launchValidation.js';

/**
 * The MCP tools. Deliberately technical : they expose the form flow a browser goes through
 * - list, open, fill in, launch, follow - as the authenticated AnsibleForms user, and add no
 * policy of their own. Confirmation, approval UX and which forms an agent may use belong to
 * the MCP client (the chat backend). What stays here is what AnsibleForms already enforces
 * for the browser : RBAC on forms and jobs, expressions and queries only as the form
 * defines them, reserved extravars stripped, credentials never returned.
 *
 * `createHandlers` takes its models as `deps`, so the tests can drive every tool without a
 * database ; mcp/router.js passes the real ones.
 */

/**
 * A refusal the caller can act on. `code` and `details` are returned as structured content
 * next to the text, so a client does not have to parse the message.
 */
export class ToolError extends Error {
  constructor(message, code = 'invalid_request', details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// model errors, by name, and the code a caller gets for them
const KNOWN_ERRORS = {
  AccessDeniedError: 'access_denied',
  ForbiddenError: 'access_denied',
  NotFoundError: 'not_found',
  ConflictError: 'conflict',
  BadRequestError: 'invalid_request',
  ValidationError: 'form_incomplete',
};

function lastLines(text, n) {
  if (!n || n <= 0) return text;
  const lines = String(text || '').split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function parseJson(s, fallback) {
  if (s && typeof s === 'object') return s;
  try {
    return JSON.parse(s || '');
  } catch {
    return fallback;
  }
}

// the internal keys resolveForm hands back for the launch - never sent to a caller, they
// hold the raw values including passwords
function publicResolution(res) {
  const { _values, _visibility, _fields, ...rest } = res; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * @param {object} args
 * @param {object} args.user  req.user.user
 * @param {object} args.deps  { Form, Job, Expression, Query, resolveFormQuery }
 * @param {object} [args.policy]  the MCP settings, from the MCP router only (the chat
 *   assistant has its own rules) : `readOnly` refuses launch_job and relaunch_job,
 *   `chatFormsOnly` offers only the forms offered in the chat (enableForChat)
 */
export function createHandlers({ user, deps, policy = {} }) {
  const { Form, Job, Expression, Query, resolveFormQuery } = deps;
  const roles = user?.roles || [];

  // a form MCP may offer : any the user may open, or with chatFormsOnly those offered in the
  // chat as well - a form left out is not found, as one the user may not open
  const offered = (f) => !policy.chatFormsOnly || f?.enableForChat === true;

  async function loadForm(name) {
    const formConfig = await Form.load(roles, name);
    const formObj = formConfig?.forms?.[0];
    if (!formObj || !offered(formObj)) throw new ToolError(`Form '${name}' not found or you do not have access to it`, 'not_found');
    return { formConfig, formObj };
  }

  function refuseWhenReadOnly() {
    if (policy.readOnly) {
      throw new ToolError('This MCP server is read only : jobs cannot be launched or relaunched through it', 'access_denied');
    }
  }

  function servicesFor(formConfig, formObj, subformName) {
    return createFormServices({ user, formConfig, formObj, subformName, deps: { Expression, Query, resolveFormQuery } });
  }

  async function resolveFor({ form, values, field, subform, parent, maxOptions }) {
    const { formConfig, formObj } = await loadForm(form);
    let target = formObj;
    let parentData;
    // a wizard keeps its fields in its steps : resolving the empty root would report a
    // "complete" form that is nothing of the sort
    if (!subform && Array.isArray(formObj.wizard) && formObj.wizard.length > 0) {
      throw new ToolError(`'${formObj.name}' is a wizard form ; its fields live in its steps `
        + `(${formObj.wizard.map((s) => s?.subform).filter(Boolean).join(', ')}). Resolve a step with \`subform\`. `
        + 'Wizard forms cannot be launched through MCP yet.', 'unsupported',
        { steps: formObj.wizard.map((s) => s?.subform).filter(Boolean) });
    }
    if (subform) {
      target = (formObj.subforms || []).find((s) => s?.name === subform);
      if (!target) throw new ToolError(`Subform '${subform}' is not part of form '${formObj.name}'`, 'not_found');
      // a subform sees its parent form's values (and through them the constants and
      // varsFiles data) as __parent__, as a list row or wizard step does in the browser
      parentData = { ...(formConfig.constants || {}), ...(formObj.vars || {}), ...(parent || {}) };
    }
    const res = await resolveForm({
      form: target,
      constants: formConfig.constants || {},
      vars: target.vars || {},
      user,
      parent: parentData,
      values: values || {},
      only: field,
      maxOptions,
      services: servicesFor(formConfig, formObj, subform),
      subforms: formObj.subforms || [],
      // an agent's rows never went through the browser's row editor : resolve them all
      allRows: true,
    });
    return { res, formConfig, formObj };
  }

  /**
   * What launch_job submits for a complete resolution, and its hash. The hash covers the
   * form name, the modelled extravars and the credential names, computed over the REAL
   * values (passwords included) ; the preview a caller sees has the passwords masked.
   * Job.launch adds ansibleforms_user and __jobid__ afterwards, and `verbose` adds
   * __verbose__ - none of those are part of the hash.
   */
  function launchPayload(res, formObj) {
    const { extravars, credentials } = buildLaunchPayload(res, formObj.subforms || []);
    return {
      extravars,
      credentials,
      preview: maskPasswords(extravars, res._fields, formObj.subforms || []),
      payloadHash: sha256({ form: formObj.name, extravars, credentials }),
    };
  }

  return {
    async listForms() {
      const cfg = await Form.load(roles);
      return {
        forms: (cfg?.forms || []).filter(offered).map((f) => ({
          name: f.name,
          description: f.description || '',
          categories: f.categories || [],
          // the chat assistant's allowlist and its button (Approve for change, Launch for read)
          enableForChat: f.enableForChat === true,
        })),
      };
    },

    async getForm({ name }) {
      const { formConfig, formObj } = await loadForm(name);
      const fields = normalizeFields(formObj.fields);
      const known = [...Object.keys(formConfig.constants || {}), ...Object.keys(formObj.vars || {}), '__user__'];
      const graph = scanDependencies(fields, known);
      const wizard = Array.isArray(formObj.wizard) && formObj.wizard.length > 0;
      return {
        ...formObj,
        fields: fields.map((f) => ({ ...f, dynamic: isDynamicField(f), dependsOn: graph.dependsOn[f.name] || [] })),
        constants: formConfig.constants || {},
        supported: !wizard,
        ...(wizard ? { unsupportedReason: 'wizard forms cannot be launched through MCP yet' } : {}),
        errors: formConfig.errors || [],
        warnings: [...(formConfig.warnings || []), ...graph.warnings],
      };
    },

    async resolveField(args) {
      const { res, formObj } = await resolveFor(args);
      const out = publicResolution(res);
      // the exact launch payload, only where it is one : a whole root form, resolved
      out.formFingerprint = sha256(formObj);
      if (res.complete && !args.subform && !args.field) {
        const payload = launchPayload(res, formObj);
        out.modeledExtravars = payload.preview;
        out.credentials = payload.credentials;
        out.payloadHash = payload.payloadHash;
      }
      return out;
    },

    async launchJob({ form, values, verbose, expectedPayloadHash }) {
      refuseWhenReadOnly();
      const { formConfig, formObj } = await loadForm(form);
      if (formObj.type === 'subform') {
        throw new ToolError(`'${formObj.name}' is a subform and cannot be launched on its own`, 'unsupported');
      }
      if (Array.isArray(formObj.wizard) && formObj.wizard.length > 0) {
        throw new ToolError(`'${formObj.name}' is a wizard form ; wizard forms cannot be launched through MCP yet`, 'unsupported');
      }
      if (verbose && !user?.options?.allowVerboseMode) {
        throw new ToolError('You do not have permission to run jobs in verbose mode', 'access_denied');
      }
      const res = await resolveForm({
        form: formObj,
        constants: formConfig.constants || {},
        vars: formObj.vars || {},
        user,
        values: values || {},
        services: servicesFor(formConfig, formObj),
        allRows: true,
      });
      if (!res.complete) {
        const parts = [];
        const notAnOption = res.fields.filter((f) => f.notInOptions && res.invalid.includes(f.name)).map((f) => f.name);
        const failing = Object.entries(res.validationErrors)
          .map(([name, errs]) => `${name} (${errs.map((e) => e.description ? `${e.type}: ${e.description}` : e.type).join(', ')})`);
        if (res.missing.length) parts.push(`missing input for : ${res.missing.join(', ')}`);
        if (notAnOption.length) parts.push(`not one of the options : ${notAnOption.join(', ')}`);
        if (failing.length) parts.push(`validation failed : ${failing.join(' ; ')}`);
        const rows = describeRowErrors(res.rowErrors);
        if (rows.length) parts.push(`list rows failing : ${rows.join(', ')}`);
        if (res.waiting.length) parts.push(`not resolvable yet : ${res.waiting.join(', ')}`);
        throw new ToolError(`The form is not complete - ${parts.join(' ; ')}. Call resolve_field to see what is needed.`,
          'form_incomplete', {
            missing: res.missing, invalid: res.invalid, waiting: res.waiting, validationErrors: res.validationErrors,
            rowErrors: res.rowErrors,
          });
      }
      const files = res._fields.filter((f) => f.type === 'file' && res._visibility[f.name]
        && res._values[f.name] !== undefined && res._values[f.name] !== null && res._values[f.name] !== '');
      if (files.length) {
        throw new ToolError(`File fields cannot be filled through MCP (${files.map((f) => f.name).join(', ')})`,
          'unsupported', { fields: files.map((f) => f.name) });
      }
      const { extravars, credentials, payloadHash } = launchPayload(res, formObj);
      // the resolution changed since it was approved : a query answered differently, the
      // form was edited, or other values were sent
      if (expectedPayloadHash && expectedPayloadHash !== payloadHash) {
        throw new ToolError('The payload differs from the one that was resolved - resolve the form again and have it confirmed.',
          'payload_mismatch', { expectedPayloadHash, payloadHash });
      }
      if (verbose) extravars.__verbose__ = true;
      const rawFormData = filterRawFormData(res._fields, res._values);
      const job = await Job.launch({
        form: formObj.name,
        user,
        credentials,
        extravars,
        rawFormData,
        fromClient: true,
        // resolved and validated above ; the REST launch guard need not do it again
        validated: true,
      });
      return { id: job?.id, form: formObj.name, payloadHash, warnings: res.warnings };
    },

    async relaunchJob({ id, values, verbose, preview, expectedPayloadHash }) {
      if (!preview) refuseWhenReadOnly();
      // the job's form must be one MCP offers
      if (policy.chatFormsOnly) {
        const job = await Job.findById(user, id, true, true);
        await loadForm(job.form);
      }
      if (verbose && !user?.options?.allowVerboseMode) {
        throw new ToolError('You do not have permission to run jobs in verbose mode', 'access_denied');
      }
      const out = await Job.relaunchWithValues({ user, id, values: values || {}, verbose: !!verbose, preview: !!preview, expectedPayloadHash });
      if (preview) {
        const { extravars, ...rest } = out;
        return { job: id, ...rest, modeledExtravars: extravars };
      }
      return { id: out?.id, relaunchOf: id, payloadHash: out?.payloadHash, warnings: out?.warnings || [] };
    },

    async getJob({ id, tail }) {
      const job = await Job.findById(user, id, true, true);
      // a job of a form MCP does not offer is not found either
      if (policy.chatFormsOnly) await loadForm(job.form).catch(() => {
        throw new ToolError(`Job ${id} not found or you do not have access to it`, 'not_found');
      });
      return {
        id: job.id,
        form: job.form,
        status: job.status,
        step: job.step,
        start: job.start,
        end: job.end,
        user: job.user,
        job_type: job.job_type,
        parent_id: job.parent_id,
        subjobs: String(job.subjobs || '').split(',').filter((x) => x !== '').map((x) => parseInt(x, 10)),
        // masked by findById(logSafe) ; credentials are never part of the answer
        extravars: parseJson(job.extravars, {}),
        output: lastLines(job.output || '', tail),
      };
    },
  };
}

const valuesSchema = z.record(z.string(), z.any())
  .describe('Raw field values keyed by field name. A choice field takes the selected option record, a partial record or its valueColumn value (an array of those when multiple).');

/**
 * Wrap a handler : the result as JSON text and as structured content, a refusal as a tool
 * error carrying `{ code, message, ...details }`, no stack traces.
 */
/**
 * A handler's refusal as `{ code, message, ...details }` - the MCP tool error, and what the
 * chat assistant hands its model. One mapping, so both speak the same codes.
 */
export function describeError(err) {
  if (err instanceof ToolError) {
    return { code: err.code, message: err.message, ...err.details };
  }
  if (typeof err?.code === 'string' && /^[a-z_]+$/.test(err.code) && KNOWN_ERRORS[err?.name]) {
    // a model error that names its own tool code (Job.relaunchWithValues)
    return { code: err.code, message: err.message, ...(err.details || {}) };
  }
  if (KNOWN_ERRORS[err?.name]) {
    return { code: KNOWN_ERRORS[err.name], message: err.message };
  }
  if (err?.statusCode) {
    return { code: err.statusCode === 403 ? 'access_denied' : err.statusCode === 404 ? 'not_found' : 'invalid_request', message: err.message };
  }
  return { code: 'internal_error', message: `Internal error : ${err?.message || err}` };
}

function wrap(fn) {
  return async (args) => {
    try {
      const result = await fn(args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      const error = describeError(err);
      return { isError: true, content: [{ type: 'text', text: error.message }], structuredContent: error };
    }
  };
}

/**
 * Register every tool on an McpServer, bound to one user's handlers. Read only (the MCP
 * settings), the tools that launch are not offered at all - the handlers refuse them too.
 */
export function registerTools(server, handlers, policy = {}) {
  server.registerTool('list_forms', {
    title: 'List forms',
    description: 'The forms the authenticated user may use, with their description and categories.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, wrap(() => handlers.listForms()));

  server.registerTool('get_form', {
    title: 'Get form',
    description: 'The full definition of one form : its fields (type, label, required, regex, default, '
      + 'dependencies, and per field `dynamic` and `dependsOn`), subforms, constants and varsFiles data. '
      + 'Use it to understand the form ; use resolve_field to evaluate it.',
    inputSchema: { name: z.string().describe('Form name, as returned by list_forms') },
    annotations: { readOnlyHint: true },
  }, wrap((a) => handlers.getForm(a)));

  server.registerTool('resolve_field', {
    title: 'Resolve form fields',
    description: 'Evaluate a form for the values filled in so far, in dependency order : which fields are '
      + 'visible, their defaults, computed expression and query values, and the options of every choice '
      + 'field. Fields whose inputs are not there yet come back as `waiting` with `waitingFor`. '
      + '`missing` lists fields that need a value from you ; `invalid` lists choices that are not among the '
      + 'options and fields that fail a validation rule of the form (regex, minValue/maxValue, '
      + 'minLength/maxLength, sameAs, in/notIn, validIf/validIfNot, ...), each described in `validationErrors` '
      + 'with the message the browser shows ; `complete` is true when the form can be launched. A choice may be sent as the option '
      + 'record, a partial record or its valueColumn value - it is replaced by the full option. When '
      + 'complete, the answer holds `modeledExtravars` (passwords masked) and `credentials` exactly as '
      + 'launch_job will submit them, and a `payloadHash` to pass to launch_job. Pass `field` to resolve '
      + 'only that field and what it depends on. Call it again after every answer.',
    inputSchema: {
      form: z.string().describe('Form name'),
      values: valuesSchema.optional(),
      field: z.string().optional().describe('Resolve only this field (and its dependencies)'),
      subform: z.string().optional().describe('Resolve a subform of the form (a list row or wizard step)'),
      parent: valuesSchema.optional().describe('Parent form values, available to a subform as __parent__'),
      maxOptions: z.number().int().positive().max(5000).optional().describe('Cap on options returned per field (default 200)'),
    },
    annotations: { readOnlyHint: true },
  }, wrap((a) => handlers.resolveField(a)));

  if (!policy.readOnly) server.registerTool('launch_job', {
    title: 'Launch job',
    description: 'Launch the form with the given values, exactly as a browser submission would : the form '
      + 'is resolved and validated first and the launch is refused while fields are missing, invalid, fail '
      + 'validation or are unresolved '
      + '(code `form_incomplete`), or when `expectedPayloadHash` no longer matches (code '
      + '`payload_mismatch`). Returns the job id. Runs the automation behind the form - confirm the '
      + 'modeledExtravars from resolve_field with the user before calling it.',
    inputSchema: {
      form: z.string().describe('Form name'),
      values: valuesSchema,
      verbose: z.boolean().optional().describe('Verbose ansible output (needs the allowVerboseMode role option)'),
      expectedPayloadHash: z.string().optional().describe('The payloadHash resolve_field returned for the approved values ; the launch is refused when the payload differs'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, wrap((a) => handlers.launchJob(a)));

  if (!policy.readOnly) server.registerTool('relaunch_job', {
    title: 'Relaunch job with changes',
    description: 'Launch a job again with some fields changed : the values the job was launched with, '
      + 'with `values` laid over them, are resolved and validated like launch_job and launched as a new '
      + 'job by you. Uploads of the original are reused. Without `values` it replays the job as it ran '
      + '(unless the form is under launch validation enforce). A relaunch through the check is refused '
      + 'for a password field the form shows - passwords are never stored with the values. Call it with `preview: true` '
      + 'first : that returns `modeledExtravars` (passwords masked), `credentials` and a `payloadHash` '
      + 'without launching - confirm them with the user, then call again with `expectedPayloadHash`. '
      + 'Refused while fields are missing, invalid or fail validation (code `form_incomplete`), for a '
      + 'wizard form or a shown password field (`unsupported`), or when the payload changed (`payload_mismatch`).',
    inputSchema: {
      id: z.number().int().positive().describe('Id of the job to relaunch'),
      values: valuesSchema.optional().describe('Only the fields to change, as raw values ; the rest is taken from the job'),
      verbose: z.boolean().optional().describe('Verbose ansible output (needs the allowVerboseMode role option)'),
      preview: z.boolean().optional().describe('Resolve and build the payload only, do not launch'),
      expectedPayloadHash: z.string().optional().describe('The payloadHash of the confirmed preview ; the relaunch is refused when the payload differs'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, wrap((a) => handlers.relaunchJob(a)));

  server.registerTool('get_job', {
    title: 'Get job',
    description: 'Status and output of a job. Secret-looking extravars are masked ; credentials are never returned.',
    inputSchema: {
      id: z.number().int().positive().describe('Job id'),
      tail: z.number().int().positive().optional().describe('Only the last N lines of output'),
    },
    annotations: { readOnlyHint: true },
  }, wrap((a) => handlers.getJob(a)));
}

export default { createHandlers, registerTools, describeError, ToolError };
