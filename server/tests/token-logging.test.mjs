import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// A refresh token is a credential : it must never reach the log, which is shown in the
// web interface, downloaded for support and shipped to syslog. Deleting one (on every
// refresh and on logout) used to log the token itself.

vi.mock('../src/models/db.model.js', () => ({ default: { do: vi.fn(async () => ({ affectedRows: 1 })) } }));
// the models import '../lib/logger.js', which vitest.config.js points at this shared mock
vi.mock('./__mocks__/logger.js', () => ({
  default: {
    debug: vi.fn(), info: vi.fn(), notice: vi.fn(),
    warning: vi.fn(), error: vi.fn(), warn: vi.fn(),
  },
}));

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-payload.signature';

let Token;
let logger;
beforeAll(async () => {
  Token = (await import('../src/models/token.model.js')).default;
  logger = (await import('./__mocks__/logger.js')).default;
});

// every argument of every logger call, as one string per call
function loggedLines() {
  return Object.values(logger).flatMap((fn) => fn.mock.calls.map((args) => args.map(String).join(' ')));
}

describe('Token logging', () => {
  beforeEach(() => {
    Object.values(logger).forEach((fn) => fn.mockClear());
  });

  it('does not log the refresh token when deleting it', async () => {
    await Token.delete('admin', 'local', TOKEN);
    const lines = loggedLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });

  it('still logs who the deleted token belonged to', async () => {
    await Token.delete('admin', 'local', TOKEN);
    expect(loggedLines().join('\n')).toContain('admin (local)');
  });

  it('does not log the refresh token when storing it', async () => {
    await Token.store('admin', 'local', TOKEN);
    for (const line of loggedLines()) expect(line).not.toContain(TOKEN);
  });
});
