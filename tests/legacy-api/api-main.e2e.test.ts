import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { guardNodeOptions } from '../support/guard-options.ts';

const execFileP = promisify(execFile);
const MAIN = fileURLToPath(new URL('../../src/legacy-api/main.ts', import.meta.url));

// `npm run api` as a child process, with an explicit environment and a time limit.
const runApi = (env: Record<string, string>) =>
  execFileP(process.execPath, [MAIN], { env: { PATH: process.env.PATH, NODE_OPTIONS: guardNodeOptions(), DATABASE_PATH: ':memory:', LOG_LEVEL: 'error', ...env }, timeout: 15_000 })
    .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));

async function busyPort(t: TestContext): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('the API starts on PORT, answers /v1/health and exits 0 on SIGTERM', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, [MAIN], {
    env: { PATH: process.env.PATH, NODE_OPTIONS: guardNodeOptions(), DATABASE_PATH: ':memory:', LOG_LEVEL: 'info', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API did not start: ${stdout}`)), 10_000);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('Server listening at')) { clearTimeout(timer); resolve(); }
    });
  });
  const health = await fetch(`http://127.0.0.1:${port}/v1/health`);
  assert.deepEqual([health.status, await health.json()], [200, { status: 'UP' }]);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
});

test('the API on a port already in use exits 1 with one short line, without a stack trace', async (t) => {
  const port = await busyPort(t);
  const r = await runApi({ PORT: String(port) });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `port ${port} in use on 127.0.0.1; pick another one with PORT\n`);
});

test('the API with an invalid variable exits 1 naming it, without echoing the value', async () => {
  const r = await runApi({ PORT: 'secret-port-value', RATE_LIMIT_WINDOW_MS: '10' });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /PORT: /);
  assert.match(r.stderr, /RATE_LIMIT_WINDOW_MS: /);
  assert.ok(!r.stderr.includes('secret-port-value') && !/\n\s+at /.test(r.stderr), r.stderr);
});
