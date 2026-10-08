import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SEED_CUSTOMERS } from '../../src/legacy-api/db/seed-data.ts';
import { tokenIdOf } from '../../src/shared/token-pattern.ts';
import { startTestApi } from '../support/api-harness.ts';
import { startStack } from '../support/mcp-harness.ts';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;
type ErrorMeta = { code: string; retryable: boolean; requestId: string; retryAfterSeconds?: number; scope?: string };

const LEAK = /stack|SQLITE|Error:|slm_[a-z0-9]{8}_/;

// Shape of every tool error (spec 5.6, MCP-08): isError, no structuredContent, the
// catalog text and _meta; never a stack, SQLite text, "Error:" or the token.
function expectError(r: ToolResult, code: string, token: string, retryable = false): ErrorMeta & { text: string } {
  assert.equal(r.isError, true);
  assert.equal('structuredContent' in r && r.structuredContent !== undefined, false);
  const text = (r.content as { text: string }[])[0]!.text;
  assert.ok(text.startsWith(`[${code}] `), text);
  assert.ok(!LEAK.test(text) && !text.includes(token), text);
  const meta = (r._meta as Record<string, ErrorMeta>)['secure-legacy-mcp/error']!;
  assert.equal(meta.code, code);
  assert.equal(meta.retryable, retryable);
  assert.match(meta.requestId, /^[0-9a-f-]{36}$/);
  return { ...meta, text };
}

const teodoroId = SEED_CUSTOMERS.findIndex((c) => c.cst_nm === 'Teodoro Escarlate') + 1;
const getTeodoro = (client: Client) => client.callTool({ name: 'getCustomer', arguments: { id: teodoroId } });
const ANA = { name: 'Ana Souza', email: 'ana.souza@example.com', phone: '11 98888-7777', segment: 'smb' };

test('[MCP-08] a revoked token gives AUTH_INVALID', async (t) => {
  const { client, api, token } = await startStack(t, { role: 'member' });
  api.tokens.revoke(tokenIdOf(token)!);
  const e = expectError(await client.callTool({ name: 'getCustomer', arguments: { id: 1 } }), 'AUTH_INVALID', token);
  assert.equal(e.text, '[AUTH_INVALID] The configured service token is invalid, expired or revoked. Ask an administrator for a new token.');
});

test('[MCP-08] a member token gives FORBIDDEN on createCustomer', async (t) => {
  const { client, api, token } = await startStack(t, { role: 'member' });
  const e = expectError(await client.callTool({ name: 'createCustomer', arguments: ANA }), 'FORBIDDEN', token);
  assert.equal(e.text, '[FORBIDDEN] This action requires the admin role; the configured token does not have it.');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM customers WHERE cst_eml = ?').get(ANA.email)!.n, 0);
});

test('[MCP-08] an unknown id gives NOT_FOUND on updateCustomerContact', async (t) => {
  const { client, token } = await startStack(t, { role: 'admin' });
  const e = expectError(await client.callTool({ name: 'updateCustomerContact', arguments: { id: 99999, phone: '11 97777-6666' } }), 'NOT_FOUND', token);
  assert.equal(e.text, '[NOT_FOUND] Customer 99999 was not found.');
});

test('[MCP-08] a duplicate email gives CONFLICT', async (t) => {
  const { client, token } = await startStack(t, { role: 'admin' });
  const seedEmail = SEED_CUSTOMERS[0]!.cst_eml;
  const e = expectError(await client.callTool({ name: 'createCustomer', arguments: { ...ANA, email: seedEmail.toUpperCase() } }), 'CONFLICT', token);
  assert.equal(e.text, '[CONFLICT] Another customer already uses this email.');
});

test('[MCP-08] the third call with a per-token limit of 2 gives RATE_LIMITED with retry metadata', async (t) => {
  const { client, token } = await startStack(t, { role: 'member', limits: { perToken: 2 } });
  for (let i = 0; i < 2; i++) assert.equal((await client.callTool({ name: 'getCustomer', arguments: { id: 1 } })).isError, undefined);
  const e = expectError(await client.callTool({ name: 'getCustomer', arguments: { id: 1 } }), 'RATE_LIMITED', token, true);
  assert.ok(e.retryAfterSeconds! > 0);
  assert.equal(e.scope, 'token');
  assert.equal(e.text, `[RATE_LIMITED] Rate limit reached (2 requests/minute). Retry in ${e.retryAfterSeconds} seconds.`);
});

test('[MCP-08] the API being down gives UPSTREAM_UNAVAILABLE', async (t) => {
  const { client, api, token } = await startStack(t, { role: 'member' });
  await api.close();
  const e = expectError(await client.callTool({ name: 'getCustomer', arguments: { id: 1 } }), 'UPSTREAM_UNAVAILABLE', token, true);
  assert.equal(e.text, '[UPSTREAM_UNAVAILABLE] The customers API is unavailable right now. Try again shortly.');
});

test('[MCP-08] a 500 with raw SQLite text gives UPSTREAM_ERROR without leaking it', async (t) => {
  const api = await startTestApi(t, { faults: [{ method: 'GET', pathPattern: /^\/v1\/customers\/\d+$/, times: 2,
    respond: { status: 500, body: '{"erro":"SQLITE_ERROR: near \\"cst_id\\": syntax error"}' } }] });
  const { client, token, waitForStderr } = await startStack(t, { role: 'admin', api });
  const e = expectError(await getTeodoro(client), 'UPSTREAM_ERROR', token);
  assert.equal(e.text, `[UPSTREAM_ERROR] The customers API failed to process the request (requestId ${e.requestId}). Details were logged.`);
  // Both attempts reached the fault, and the raw body went to stderr only.
  assert.equal(api.requests.filter((r) => r.url === `/v1/customers/${teodoroId}`).length, 2);
  await waitForStderr((events) => events.some((x) => x.event === 'upstream_failure' && String(x.upstreamBody).includes('SQLITE_ERROR') && x.requestId === e.requestId));
  // The process is still alive and the fault is used up.
  assert.equal((await getTeodoro(client)).isError, undefined);
});

test('[MCP-15] an off-schema payload gives UPSTREAM_CONTRACT and the next call works', async (t) => {
  const api = await startTestApi(t, { faults: [{ method: 'GET', pathPattern: /^\/v1\/customers\/\d+$/, times: 1, respond: { status: 200, body: '{"cst_id":"x"}' } }] });
  const { client, token } = await startStack(t, { role: 'admin', api });
  const e = expectError(await getTeodoro(client), 'UPSTREAM_CONTRACT', token);
  assert.equal(e.text, `[UPSTREAM_CONTRACT] The customers API returned an unexpected response (requestId ${e.requestId}).`);
  const next = await getTeodoro(client);
  assert.equal(next.isError, undefined);
  assert.equal((next.structuredContent as { customer: { id: number } }).customer.id, teodoroId);
});

test('[MCP-15] a non-JSON body gives UPSTREAM_CONTRACT', async (t) => {
  const api = await startTestApi(t, { faults: [{ method: 'GET', pathPattern: /^\/v1\/customers\/\d+$/, times: 1,
    respond: { status: 200, body: '<html>oops</html>', contentType: 'text/html' } }] });
  const { client, token } = await startStack(t, { role: 'admin', api });
  expectError(await getTeodoro(client), 'UPSTREAM_CONTRACT', token);
  assert.equal((await getTeodoro(client)).isError, undefined);
});

test('[MCP-17] createCustomer accepted by the API but not read back gives READBACK_FAILED, not a retry', async (t) => {
  const api = await startTestApi(t, { faults: [{ method: 'GET', pathPattern: /^\/v1\/customers\/\d+$/, times: 2, respond: { status: 500, body: '{"erro":"boom"}' } }] });
  const { client, token } = await startStack(t, { role: 'admin', api });
  const e = expectError(await client.callTool({ name: 'createCustomer', arguments: ANA }), 'READBACK_FAILED', token);
  const created = api.db.prepare('SELECT cst_id FROM customers WHERE cst_eml = ?').get(ANA.email) as { cst_id: number } | undefined;
  assert.ok(created, 'the customer was created');
  assert.equal(e.text, `[READBACK_FAILED] The write to customer ${created.cst_id} was applied, but reading it back failed (requestId ${e.requestId}). Do not repeat it; use getCustomer with id ${created.cst_id}.`);
  assert.equal(api.requests.filter((r) => r.method === 'POST').length, 1);
  // The fault is used up: the customer can be read with the id from the message.
  const next = await client.callTool({ name: 'getCustomer', arguments: { id: created.cst_id } });
  assert.equal((next.structuredContent as { customer: { email: string } }).customer.email, ANA.email);
});

test('faults match only their method and path, without the query string', async (t) => {
  const api = await startTestApi(t, { faults: [
    { method: 'GET', pathPattern: /^\/v1\/customers$/, times: 1, respond: { status: 200, body: '{"qtd":"x"}' } },
    { method: 'PUT', pathPattern: /^\/v1\/customers\/\d+$/, times: 2, respond: { status: 500, body: '{"erro":"boom"}' } },
  ] });
  const { client, token } = await startStack(t, { role: 'admin', api });
  // GET by id matches neither fault (the PUT one has the same path, another method).
  assert.equal((await getTeodoro(client)).isError, undefined);
  // The listing (with ?nm=...&lim=6) is affected once.
  expectError(await client.callTool({ name: 'getCustomer', arguments: { name: 'teodoro' } }), 'UPSTREAM_CONTRACT', token);
  assert.equal((await client.callTool({ name: 'getCustomer', arguments: { name: 'teodoro' } })).isError, undefined);
  // The PUT fault hits the write; writes are never retried (MCP-10), so one PUT only.
  expectError(await client.callTool({ name: 'deactivateCustomer', arguments: { id: teodoroId } }), 'UPSTREAM_ERROR', token);
  assert.equal(api.requests.filter((r) => r.method === 'PUT').length, 1);
  assert.equal(api.db.prepare('SELECT cst_sts FROM customers WHERE cst_id = ?').get(teodoroId)!.cst_sts, 'A');
});
