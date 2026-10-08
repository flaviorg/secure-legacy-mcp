import test from 'node:test';
import assert from 'node:assert/strict';
import { guardNodeOptions } from '../support/guard-options.ts';
import { startStack } from '../support/mcp-harness.ts';
import { runMcpProcess } from '../support/raw-stdio.ts';

test('[MCP-01] exits 1 without SERVICE_TOKEN, names it on stderr and writes nothing to stdout', async () => {
  const r = await runMcpProcess({ PATH: process.env.PATH!, NODE_OPTIONS: guardNodeOptions(), LEGACY_API_URL: 'http://127.0.0.1:9' });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  const last = JSON.parse(r.stderr.trim().split('\n').at(-1)!);
  assert.equal(last.level, 'fatal'); assert.equal(last.event, 'config_invalid');
  assert.ok(r.stderr.includes('SERVICE_TOKEN'));
});

test('[MCP-01] exits 1 with a malformed token and never echoes it', async () => {
  const bad = 'slm_short_not-a-real-token';
  const r = await runMcpProcess({ PATH: process.env.PATH!, NODE_OPTIONS: guardNodeOptions(), SERVICE_TOKEN: bad });
  assert.equal(r.code, 1); assert.equal(r.stdout, ''); assert.ok(!r.stderr.includes(bad));
});

// fetch refuses URLs with credentials, so such a URL could never work; failing at
// startup also keeps the password out of the startup log line.
test('[MCP-01] exits 1 when LEGACY_API_URL carries credentials and never logs them', async () => {
  const token = 'slm_k3x9q2ab_' + 'A'.repeat(43);
  const r = await runMcpProcess({ PATH: process.env.PATH!, NODE_OPTIONS: guardNodeOptions(), SERVICE_TOKEN: token, LEGACY_API_URL: 'http://svc:SuperSecret@127.0.0.1:9' });
  assert.equal(r.code, 1); assert.equal(r.stdout, '');
  assert.ok(r.stderr.includes('LEGACY_API_URL') && !r.stderr.includes('SuperSecret'), r.stderr);
});

test('starts with a valid token even when the API is down and answers initialize', async (t) => {
  const { client } = await startStack(t, { legacyApiUrl: 'http://127.0.0.1:9' });
  assert.equal(client.getServerVersion()?.name, 'secure-legacy-mcp');
});
