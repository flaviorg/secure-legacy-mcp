import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { guardNodeOptions } from '../support/guard-options.ts';

const isGuardError = (err: any) => (err?.cause?.code ?? err?.code) === 'NO_NETWORK';

test('[REP-03] fetch to an external host fails with the guard error', async () => {
  await assert.rejects(fetch('https://example.com'), isGuardError);
});

test('[REP-03] http.get to an external host fails with the guard error', async () => {
  const err = await new Promise((resolve) => {
    http.get('http://example.org/', (res) => { res.resume(); resolve(null); }).on('error', resolve);
  });
  assert.ok(isGuardError(err));
});

for (const host of ['127.0.0.1', '::1']) {
  test(`[REP-03] loopback ${host} is allowed`, async (t) => {
    const srv = http.createServer((_q, r) => r.end('ok')).listen(0, host);
    await once(srv, 'listening');
    t.after(() => srv.close());
    const { port } = srv.address() as AddressInfo;
    const url = host.includes(':') ? `http://[${host}]:${port}/` : `http://${host}:${port}/`;
    const res = await fetch(url, { headers: { connection: 'close' } });
    assert.equal(await res.text(), 'ok');
  });
}

test('[REP-03] child processes started with guardNodeOptions() are guarded', () => {
  const r = spawnSync(process.execPath, ['-e',
    "fetch('https://example.com').then(() => console.log('open'), (e) => console.log(e.cause?.code))"],
    { env: { PATH: process.env.PATH, NODE_OPTIONS: guardNodeOptions() }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'NO_NETWORK');
});
