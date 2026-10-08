import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTokenStore } from '../../src/legacy-api/auth/token-store.ts';
import { startLegacyApi } from '../../src/legacy-api/start-in-process.ts';
import { fixedClock } from '../../src/shared/clock.ts';
import { createLegacyTestApp } from '../support/legacy-app.ts';

test('[SEC-02] 401 with the same generic body for missing, malformed, unknown, revoked and expired tokens', async () => {
  const clock = fixedClock('2026-10-04T12:00:00.000Z');
  const { app, db } = await createLegacyTestApp({ clock });
  const store = createTokenStore(db, clock);
  const revoked = store.issue({ name: 'r', role: 'admin' }); store.revoke(revoked.record.id);
  const expiring = store.issue({ name: 'e', role: 'admin', expiresAt: new Date('2026-10-04T12:00:01.000Z') });
  clock.advance(2000);
  const cases: Record<string, string | undefined> = {
    missing: undefined, malformed: 'Bearer abc', unknown: 'Bearer slm_zzzzzzzz_' + 'A'.repeat(43),
    revoked: `Bearer ${revoked.token}`, expired: `Bearer ${expiring.token}` };
  for (const [label, authorization] of Object.entries(cases)) {
    const res = await app.inject({ method: 'GET', url: '/v1/customers/1', headers: authorization ? { authorization } : {} });
    assert.equal(res.statusCode, 401, label);
    assert.deepEqual(res.json(), { erro: 'nao autorizado' }, label);
  }
});

test('[SEC-03] member tokens read but get 403 on POST, PUT and DELETE', async () => {
  const { app, memberHeaders } = await createLegacyTestApp();
  assert.equal((await app.inject({ method: 'GET', url: '/v1/customers/1', headers: memberHeaders })).statusCode, 200);
  for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    const url = method === 'POST' ? '/v1/customers' : '/v1/customers/1';
    const res = await app.inject({ method, url, headers: memberHeaders, payload: {} });
    assert.equal(res.statusCode, 403, method);
    assert.deepEqual(res.json(), { erro: 'proibido', papel_necessario: 'admin' });
  }
});

test('[SEC-04] the role comes only from the token record', async () => {
  const { app, memberHeaders } = await createLegacyTestApp();
  const res = await app.inject({ method: 'POST', url: '/v1/customers', headers: { ...memberHeaders, 'x-role': 'admin', role: 'admin' },
    payload: { cst_nm: 'X Y', cst_phn: '11911112222', cst_eml: 'x.y@example.com', cst_seg: 1, role: 'admin' } });
  assert.equal(res.statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/auth/whoami', headers: memberHeaders })).json().role, 'member');
});

test('[SEC-09] API logs never contain the Authorization value and writes are audited', async () => {
  const lines: string[] = [];
  // Fastify's default request serializer does not log headers, which would let this
  // test pass without the redaction. This serializer logs them on purpose, so the test
  // proves that buildApp redacts req.headers.authorization.
  const serializers = { req: (r: { method: string; url: string; headers: Record<string, unknown> }) => ({ method: r.method, url: r.url, headers: r.headers }) };
  const { app, adminHeaders } = await createLegacyTestApp({ logger: { level: 'info', serializers, stream: { write: (l: string) => lines.push(l) } } });
  await app.inject({ method: 'POST', url: '/v1/customers', headers: adminHeaders, payload: { cst_nm: 'X Y', cst_phn: '11911112222', cst_eml: 'x.y@example.com', cst_seg: 1 } });
  const token = adminHeaders.authorization!.slice('Bearer '.length);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes(token) && !l.includes('Bearer ')));
  assert.ok(lines.some((l) => JSON.parse(l).req?.headers?.authorization === '[Redacted]'), 'the Authorization header is logged, redacted');
  assert.ok(lines.some((l) => { const e = JSON.parse(l); return e.audit === true && e.role === 'admin' && e.status === 201; }));
});

// A client may paste the token into the URL by mistake. The request is refused (only
// the Bearer header authenticates), and the URL that Fastify logs must not carry the
// secret, with the default request serializer or with a custom one.
test('[SEC-09] a token sent in the query string is masked in the API logs', async () => {
  const custom = { req: (r: { method: string; url: string }) => ({ method: r.method, url: r.url }) };
  for (const serializers of [undefined, custom]) {
    const lines: string[] = [];
    const { app, adminHeaders } = await createLegacyTestApp({ logger: { level: 'info', serializers, stream: { write: (l: string) => lines.push(l) } } });
    const token = adminHeaders.authorization!.slice('Bearer '.length);
    const id = token.split('_')[1]!;
    assert.equal((await app.inject({ method: 'GET', url: `/v1/auth/whoami?token=${token}` })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: `/v1/customers?nm=teo&access_token=${token}`, headers: adminHeaders })).statusCode, 200);
    const label = serializers === undefined ? 'default serializer' : 'custom serializer';
    assert.ok(lines.length > 0, label);
    assert.ok(lines.every((l) => !l.includes(token)), label);
    const urls = lines.map((l) => JSON.parse(l).req?.url).filter((u): u is string => typeof u === 'string');
    assert.deepEqual(urls, [`/v1/auth/whoami?token=slm_${id}_***`, `/v1/customers?nm=teo&access_token=slm_${id}_***`], label);
  }
});

// Only the PUT trap (API-04) answers with a raw SQLite message, on purpose. Any other
// failure, in a route or in a hook, gets a generic 500 and the detail stays in the log.
test('[SEC-14] an unexpected failure answers 500 with a generic body and logs the detail', async () => {
  for (const [table, url] of [['customers', '/v1/customers/1'], ['service_tokens', '/v1/auth/whoami']] as const) {
    const lines: string[] = [];
    const { app, db, adminHeaders } = await createLegacyTestApp({ logger: { level: 'info', stream: { write: (l: string) => lines.push(l) } } });
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_gone`);
    const res = await app.inject({ method: 'GET', url, headers: adminHeaders });
    assert.equal(res.statusCode, 500, table);
    assert.deepEqual(res.json(), { erro: 'erro interno' }, table);
    assert.ok(!/SQLITE|no such table|statusCode/i.test(res.body), res.body);
    assert.ok(lines.some((l) => { const e = JSON.parse(l); return e.level === 50 && e.err?.message === `no such table: ${table}`; }), table);
  }
  const { app, adminHeaders } = await createLegacyTestApp();
  const invalid = await app.inject({ method: 'POST', url: '/v1/customers', headers: adminHeaders, payload: {} });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json().message, /cst_nm/);
});

test('[SEC-13] x-request-id is adopted when it is a UUID and replaced otherwise', async () => {
  const { app, adminHeaders } = await createLegacyTestApp();
  const uuid = randomUUID();
  const ok = await app.inject({ method: 'GET', url: '/v1/auth/whoami', headers: { ...adminHeaders, 'x-request-id': uuid } });
  assert.equal(ok.headers['x-request-id'], uuid);
  const bad = await app.inject({ method: 'GET', url: '/v1/auth/whoami', headers: { ...adminHeaders, 'x-request-id': 'evil value' } });
  assert.notEqual(bad.headers['x-request-id'], 'evil value');
  assert.match(String(bad.headers['x-request-id']), /^[0-9a-f-]{36}$/);
});

test('health stays public and whoami returns tokenId, name and role', async () => {
  const { app, db, adminHeaders } = await createLegacyTestApp();
  const health = await app.inject({ method: 'GET', url: '/v1/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'UP' });
  const whoami = await app.inject({ method: 'GET', url: '/v1/auth/whoami', headers: adminHeaders });
  assert.equal(whoami.statusCode, 200);
  const admin = createTokenStore(db, fixedClock('2026-10-04T12:00:00.000Z')).list().find((r) => r.role === 'admin')!;
  assert.deepEqual(whoami.json(), { tokenId: admin.id, name: admin.name, role: 'admin' });
  assert.equal((await app.inject({ method: 'GET', url: '/v1/auth/whoami' })).statusCode, 401);
});

test('startLegacyApi serves real HTTP on 127.0.0.1 with tokens from api.tokens', async (t) => {
  const api = await startLegacyApi(); t.after(() => api.close());
  const { token } = api.tokens.issue({ name: 't', role: 'member' });
  const res = await fetch(`${api.url}/v1/auth/whoami`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(api.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});
