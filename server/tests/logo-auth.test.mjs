// GET /api/v2/logo is public : the login page shows the custom logo before anyone signs in.
// Uploading or removing a logo still needs an authenticated user with settings access.
import { test, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import jwt from 'jsonwebtoken';

// the routes must be reachable without a database : mock the controller they run
const update = vi.fn((req, res) => res.json({ ok: 'update' }));
const remove = vi.fn((req, res) => res.json({ ok: 'remove' }));

vi.mock('../src/controllers/v2/logo.controller.js', () => ({
  default: {
    get: (req, res) => res.json({ logo: 'data:image/png;base64,x', isDefault: false }),
    update: (...a) => update(...a),
    remove: (...a) => remove(...a)
  }
}));
vi.mock('../src/lib/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), notice: vi.fn(), warning: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

let server;
let baseUrl;
let secret;

beforeAll(async () => {
  process.env.ACCESS_TOKEN_SECRET = 'logo-route-test-secret';
  const express = (await import('express')).default;
  const passport = (await import('passport')).default;
  await import('../src/auth/auth_jwt.js');
  secret = (await import('../config/auth.config.js')).default.secret;
  const logoRoutes = (await import('../src/routes/v2/logo.routes.js')).default;

  const app = express();
  app.use(passport.initialize());
  app.use('/api/v2/logo', logoRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v2/logo`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

const token = (options) => jwt.sign({ access: true, user: { username: 'x', type: 'local', roles: ['public'], options } }, secret);

test('reading the logo needs no login : the login page shows it', async () => {
  const res = await fetch(baseUrl);
  expect(res.status).toBe(200);
  expect((await res.json()).logo).toMatch(/^data:image\/png/);
});

test('uploading or removing a logo without a login is refused', async () => {
  for (const method of ['POST', 'DELETE']) {
    expect((await fetch(baseUrl, { method })).status).toBe(401);
  }
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('uploading or removing a logo needs settings access', async () => {
  const user = { Authorization: `Bearer ${token({ showSettings: false })}` };
  expect((await fetch(baseUrl, { method: 'POST', headers: user })).status).toBe(403);
  expect((await fetch(baseUrl, { method: 'DELETE', headers: user })).status).toBe(403);
  expect(update).not.toHaveBeenCalled();

  const admin = { Authorization: `Bearer ${token({ showSettings: true })}` };
  expect((await fetch(baseUrl, { method: 'POST', headers: admin })).status).toBe(200);
  expect((await fetch(baseUrl, { method: 'DELETE', headers: admin })).status).toBe(200);
  expect(update).toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
});
