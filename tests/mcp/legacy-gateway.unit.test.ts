import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import type { ErrorCode } from '../../src/mcp/domain/errors.ts';
import type { CustomerGateway } from '../../src/mcp/domain/ports.ts';
import { createLegacyCustomerGateway } from '../../src/mcp/infrastructure/legacy-customer-gateway.ts';
import { createLogger } from '../../src/shared/logger.ts';
import { createFakeFetch } from '../support/fake-fetch.ts';
import type { FakeReply } from '../support/fake-fetch.ts';

const TOKEN = 'slm_k3x9q2ab_' + 'A'.repeat(43);
const ctx = { requestId: '5b2e8f3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b' };
const row = { cst_id: 12, cst_nm: 'Teodoro Escarlate', cst_phn: '11900000012', cst_eml: 'teodoro.escarlate@example.com', cst_sts: 'A', cst_seg: 3, dt_cad: '20240115' };
function gw(replies: FakeReply[], timeoutMs = 50) {
  const lines: string[] = [];
  const fetch = createFakeFetch(replies);
  const gateway = createLegacyCustomerGateway({ baseUrl: 'http://127.0.0.1:9', token: TOKEN, timeoutMs, fetch,
    logger: createLogger({ component: 'mcp', level: 'debug', write: (l) => lines.push(l) }), userAgent: 'secure-legacy-mcp/0.1.0' });
  return { gateway, fetch, lines };
}
const code = (c: ErrorCode) => (e: unknown) => e instanceof DomainError && e.code === c;

test('[MCP-06] search always sends lim (at most 50), off and the mapped filters', async () => {
  const { gateway, fetch } = gw([{ status: 200, body: { qtd: 0, dados: [] } }]);
  await gateway.search({ nameContains: 'teo', status: 'active' }, { limit: 500, offset: 0 }, ctx);
  const q = fetch.calls[0]!.url.searchParams;
  assert.deepEqual([q.get('lim'), q.get('off'), q.get('nm'), q.get('sts')], ['50', '0', 'teo', 'A']);
});

test('sends bearer, x-request-id, accept and user-agent', async () => {
  const { gateway, fetch } = gw([{ status: 200, body: row }]);
  await gateway.getById(12, ctx);
  const h = fetch.calls[0]!.headers;
  assert.deepEqual([h.get('authorization'), h.get('x-request-id'), h.get('accept'), h.get('user-agent')],
    [`Bearer ${TOKEN}`, ctx.requestId, 'application/json', 'secure-legacy-mcp/0.1.0']);
});

test('[MCP-07] replace sends the full writable object and never cst_id', async () => {
  const { gateway, fetch } = gw([{ status: 200, body: { id: 12, msg: 'atualizado' } }]);
  await gateway.replace(12, { name: 'Teodoro Escarlate', email: 'teodoro.escarlate@example.com', phone: '+5511900000012', status: 'inactive', segment: 'enterprise' }, ctx);
  assert.equal(fetch.calls[0]!.method, 'PUT');
  assert.equal(fetch.calls[0]!.url.pathname, '/v1/customers/12');
  assert.deepEqual(Object.keys(fetch.calls[0]!.body as object).sort(), ['cst_eml', 'cst_nm', 'cst_phn', 'cst_seg', 'cst_sts']);
});

test('[MCP-10] GET is retried once on 5xx and on network errors', async () => {
  const a = gw([{ status: 500, text: 'x' }, { status: 500, text: 'x' }]);
  await assert.rejects(a.gateway.getById(12, ctx), code('UPSTREAM_ERROR'));
  assert.equal(a.fetch.calls.length, 2);
  const b = gw([{ error: new TypeError('fetch failed') }, { status: 200, body: row }]);
  assert.equal((await b.gateway.getById(12, ctx))?.id, 12);
});

test('[MCP-10] writes, 4xx, 429 and invalid payloads are never retried', async () => {
  const cases: [FakeReply, (g: CustomerGateway) => Promise<unknown>, ErrorCode | null][] = [
    [{ status: 500, text: 'x' }, (g) => g.create({ name: 'Ana Souza', email: 'a@b.co', phone: '+5511988887777', segment: 'smb' }, ctx), 'UPSTREAM_ERROR'],
    [{ status: 404, body: { msg: 'nao encontrado' } }, (g) => g.getById(1, ctx), null],
    [{ status: 429, body: { erro: 'limite excedido' }, headers: { 'retry-after': '58' } }, (g) => g.getById(1, ctx), 'RATE_LIMITED'],
    [{ status: 200, body: { cst_id: 'x' } }, (g) => g.getById(1, ctx), 'UPSTREAM_CONTRACT'],
  ];
  for (const [reply, call, expected] of cases) {
    const { gateway, fetch } = gw([reply, reply]);
    if (expected) await assert.rejects(call(gateway), code(expected)); else assert.equal(await call(gateway), null);
    assert.equal(fetch.calls.length, 1);
  }
});

// The timeout of each attempt is read from the AbortSignal.timeout calls, not from the
// wall clock, so a slow CI runner cannot make the test flaky. The elapsed time is only
// a coarse check that both attempts were really aborted (2 x 50 ms, far from 2 s).
test('[MCP-10] each attempt is aborted at timeoutMs', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout');
  const { gateway, fetch } = gw(['hang', 'hang'], 50);
  const started = performance.now();
  await assert.rejects(gateway.getById(12, ctx), code('UPSTREAM_UNAVAILABLE'));
  const elapsed = performance.now() - started;
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(timeout.mock.calls.map((c) => c.arguments), [[50], [50]]);
  for (const call of fetch.calls) assert.equal((call.signal?.reason as Error | undefined)?.name, 'TimeoutError');
  assert.ok(elapsed < 2_000, `${elapsed} ms`);
});

test('[MCP-08] status codes map to the error catalog with details', async () => {
  for (const [status, expected] of [[401, 'AUTH_INVALID'], [403, 'FORBIDDEN'], [409, 'CONFLICT'], [400, 'INVALID_INPUT']] as const) {
    await assert.rejects(gw([{ status, body: {} }]).gateway.getById(1, ctx), code(expected));
  }
  await assert.rejects(gw([{ status: 429, body: {}, headers: { 'retry-after': '58', 'x-ratelimit-limit': '90', 'x-ratelimit-scope': 'token' } }]).gateway.getById(1, ctx),
    (e: unknown) => e instanceof DomainError && JSON.stringify(e.details) === JSON.stringify({ retryAfterSeconds: 58, limit: 90, scope: 'token', upstreamStatus: 429 }));
  await assert.rejects(gw([{ status: 404, body: {} }]).gateway.replace(9, { name: 'Ab', email: 'a@b.co', phone: '+5511988887777', status: 'active', segment: 'smb' }, ctx),
    (e: unknown) => e instanceof DomainError && e.code === 'NOT_FOUND' && e.details.id === 9);
});

test('logs the raw upstream body truncated and masked, never in the error', async () => {
  const raw = 'SQLITE_ERROR ' + 'x'.repeat(1000) + ' ' + TOKEN;
  const { gateway, lines } = gw([{ status: 500, text: raw }, { status: 500, text: raw }]);
  await assert.rejects(gateway.getById(12, ctx), (e: unknown) => e instanceof DomainError && !e.message.includes('SQLITE'));
  const logged = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'upstream_failure');
  assert.ok(logged.upstreamBody.length <= 500);
  assert.ok(!lines.join('').includes(TOKEN));
});

// Spec 6.1: one new signal per attempt. A signal shared by both attempts would already
// be aborted when the retry starts, so the retry would never really run.
test('[MCP-10] every attempt gets its own timeout signal', async () => {
  const { gateway, fetch } = gw(['hang', 'hang'], 50);
  await assert.rejects(gateway.getById(12, ctx), code('UPSTREAM_UNAVAILABLE'));
  const [first, second] = fetch.calls.map((c) => c.signal);
  assert.ok(first instanceof AbortSignal && second instanceof AbortSignal);
  assert.notEqual(first, second);
});

// The body is masked before it is cut: truncating first would leave a token prefix
// plus part of the secret, which the mask no longer recognizes.
test('masks a token that crosses the 500-character cut of the logged body', async () => {
  const raw = 'x'.repeat(470) + TOKEN + ' ' + 'y'.repeat(100); // the secret is only "A"s
  const { gateway, lines } = gw([{ status: 500, text: raw }, { status: 500, text: raw }]);
  await assert.rejects(gateway.getById(12, ctx), code('UPSTREAM_ERROR'));
  const bodies = lines.map((l) => JSON.parse(l)).filter((e) => e.event === 'upstream_failure').map((e) => e.upstreamBody as string);
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.ok(body.length <= 500);
    assert.ok(body.includes('slm_k3x9q2ab_***'), body.slice(460));
    assert.ok(!body.includes('A'), body.slice(460));
  }
});
