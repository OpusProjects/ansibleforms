'use strict';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import logger from '../lib/logger.js';
import Form from '../models/form.model.js';
import Job from '../models/job.model.js';
import Expression from '../models/expression.model.js';
import Query from '../models/query.model.js';
import { resolveFormQuery } from '../lib/queryPolicy.js';
import { createHandlers, registerTools } from './tools.js';
import appConfig from '../../config/app.config.js';

/**
 * POST /api/v2/mcp - the AnsibleForms MCP server (Streamable HTTP, stateless).
 *
 * Mounted behind the same JWT middleware as every other api route, so each request is
 * authenticated on its own and runs as that user : a fresh McpServer per request, bound to
 * req.user.user, and no session state kept between requests. That also means GET (the
 * server-to-client SSE stream) and DELETE (session end) have nothing to serve - they
 * answer 405, as the protocol prescribes for a server without sessions.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const version = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

const deps = { Form, Job, Expression, Query, resolveFormQuery };

function jsonRpcError(res, status, code, message) {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

const router = express.Router();

router.post('/', async (req, res) => {
  const user = req?.user?.user;
  if (!user?.username) {
    return jsonRpcError(res, 401, -32001, 'Unauthorized');
  }
  const server = new McpServer({ name: 'ansibleforms', version });
  // the MCP settings, read per request so a change applies at once : read only, and which
  // forms are offered (the chat assistant shares the handlers, without this policy)
  const policy = { readOnly: appConfig.mcpReadOnly, chatFormsOnly: appConfig.mcpChatFormsOnly };
  registerTools(server, createHandlers({ user, deps, policy }), policy);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // plain JSON responses : every tool answers in one piece, and a JSON body is easier on
    // clients (and proxies) than an SSE stream
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error(`MCP request failed : ${err?.message || err}`);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
});

// every other method, GET and DELETE included
router.all('/', (req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed : this MCP server is stateless, use POST'));

export default router;
