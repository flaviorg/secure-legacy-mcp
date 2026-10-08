import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcpConfig } from '../../src/mcp/config.ts';
import { ConfigError } from '../../src/shared/config-error.ts';

const token = 'slm_k3x9q2ab_' + 'A'.repeat(43);

test('[MCP-01] a missing SERVICE_TOKEN is reported by name', () => {
  assert.throws(() => loadMcpConfig({}), (e: unknown) => e instanceof ConfigError && e.issues.some((i) => i.path === 'SERVICE_TOKEN'));
});

test('[MCP-01] a malformed token is rejected without echoing the value', () => {
  const bad = 'slm_short_secret-value';
  assert.throws(() => loadMcpConfig({ SERVICE_TOKEN: bad }), (e: unknown) =>
    e instanceof ConfigError && !e.message.includes(bad) && !JSON.stringify(e.issues).includes(bad));
});

test('[MCP-01] surrounding whitespace in SERVICE_TOKEN is trimmed', () => {
  assert.equal(loadMcpConfig({ SERVICE_TOKEN: `  ${token}\n` }).serviceToken, token);
});

test('applies defaults and validates ranges', () => {
  assert.deepEqual(loadMcpConfig({ SERVICE_TOKEN: token }), { serviceToken: token, legacyApiUrl: 'http://127.0.0.1:9999', timeoutMs: 5000, logLevel: 'info' });
  for (const v of ['100', '30001', 'abc']) assert.throws(() => loadMcpConfig({ SERVICE_TOKEN: token, LEGACY_API_TIMEOUT_MS: v }), ConfigError);
  assert.throws(() => loadMcpConfig({ SERVICE_TOKEN: token, LEGACY_API_URL: 'not a url' }), ConfigError);
});

test('[MCP-01] credentials in LEGACY_API_URL are rejected by name, without echoing them', () => {
  for (const url of ['http://svc:SuperSecret@127.0.0.1:9999', 'http://SuperSecret@127.0.0.1:9999']) {
    assert.throws(() => loadMcpConfig({ SERVICE_TOKEN: token, LEGACY_API_URL: url }), (e: unknown) =>
      e instanceof ConfigError && e.issues.some((i) => i.path === 'LEGACY_API_URL') && !JSON.stringify(e.issues).includes('SuperSecret') && !e.message.includes('SuperSecret'));
  }
});
