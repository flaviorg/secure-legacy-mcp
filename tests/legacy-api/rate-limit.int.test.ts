import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createTokenStore } from '../../src/legacy-api/auth/token-store.ts';
import { fixedClock, systemClock } from '../../src/shared/clock.ts';
import { createLegacyTestApp } from '../support/legacy-app.ts';

const hit = (app: FastifyInstance, headers: Record<string, string>, remoteAddress = '127.0.0.1', url = '/v1/customers/1') =>
  app.inject({ method: 'GET', url, headers, remoteAddress });

test('[SEC-05] the 91st request of one token within 60 s gets 429 with the token headers', async () => {
  // Fixed clock: retry-after stays exactly 60 however long the 91 requests take.
  const { app, adminHeaders } = await createLegacyTestApp({ clock: fixedClock('2026-10-04T12:00:00.000Z') });
  for (let i = 1; i <= 90; i++) assert.equal((await hit(app, adminHeaders)).statusCode, 200);
  const res = await hit(app, adminHeaders);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { erro: 'limite excedido' });
  assert.equal(res.headers['retry-after'], '60');
  assert.equal(res.headers['x-ratelimit-limit'], '90');
  assert.equal(res.headers['x-ratelimit-remaining'], '0');
  assert.equal(res.headers['x-ratelimit-scope'], 'token');
});

test('[SEC-06] three tokens on the same IP are blocked at the 181st request', async () => {
  const { app, db } = await createLegacyTestApp();
  const store = createTokenStore(db, systemClock);
  const headers = [1, 2, 3].map((i) => ({ authorization: `Bearer ${store.issue({ name: `t${i}`, role: 'member' }).token}` }));
  for (let i = 0; i < 180; i++) assert.equal((await hit(app, headers[i % 3]!)).statusCode, 200);
  const res = await hit(app, headers[0]!);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['x-ratelimit-scope'], 'ip');
  assert.equal(res.headers['x-ratelimit-limit'], '180');
});

test('[SEC-06] different IPs have independent buckets', async () => {
  const { app, adminHeaders } = await createLegacyTestApp({ limits: { perIp: 2 } });
  assert.equal((await hit(app, adminHeaders, '10.0.0.1')).statusCode, 200);
  assert.equal((await hit(app, adminHeaders, '10.0.0.1')).statusCode, 200);
  assert.equal((await hit(app, adminHeaders, '10.0.0.1')).statusCode, 429);
  assert.equal((await hit(app, adminHeaders, '10.0.0.2')).statusCode, 200);
});

test('[SEC-12] 401 carries IP headers, health consumes nothing, 2xx carries token headers', async () => {
  const { app, adminHeaders } = await createLegacyTestApp({ limits: { perIp: 3 } });
  const unauth = await hit(app, {});
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.headers['x-ratelimit-scope'], 'ip');
  for (let i = 0; i < 5; i++) {
    const health = await hit(app, {}, '127.0.0.1', '/v1/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers['x-ratelimit-scope'], undefined);
  }
  const ok = await hit(app, adminHeaders);
  assert.equal(ok.headers['x-ratelimit-scope'], 'token');
  assert.equal(ok.headers['x-ratelimit-limit'], '90');
});
