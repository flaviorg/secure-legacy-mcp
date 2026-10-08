import test from 'node:test';
import assert from 'node:assert/strict';
import { API_ENV_KEYS, loadApiConfig } from '../../src/legacy-api/config.ts';
import { ConfigError } from '../../src/shared/config-error.ts';

test('loadApiConfig applies the documented defaults', () => {
  assert.deepEqual(loadApiConfig({}), {
    port: 9999, host: '127.0.0.1', databasePath: './data/legacy.db',
    limits: { perToken: 90, perIp: 180, windowMs: 60000 }, logLevel: 'info' });
});

test('loadApiConfig names invalid variables without echoing values', () => {
  assert.throws(() => loadApiConfig({ PORT: '70000', LOG_LEVEL: 'fatal', RATE_LIMIT_WINDOW_MS: '10' }), (err: unknown) =>
    err instanceof ConfigError
    && JSON.stringify(err.issues.map((i) => i.path).sort()) === JSON.stringify(['LOG_LEVEL', 'PORT', 'RATE_LIMIT_WINDOW_MS'])
    && !err.message.includes('70000') && !JSON.stringify(err.issues).includes('70000'));
});

test('loadApiConfig reads every documented variable and rejects non-integers', () => {
  assert.deepEqual([...API_ENV_KEYS].sort(),
    ['DATABASE_PATH', 'HOST', 'LOG_LEVEL', 'PORT', 'RATE_LIMIT_PER_IP', 'RATE_LIMIT_PER_TOKEN', 'RATE_LIMIT_WINDOW_MS']);
  assert.deepEqual(loadApiConfig({ PORT: '9998', HOST: '0.0.0.0', DATABASE_PATH: ':memory:', RATE_LIMIT_PER_TOKEN: '5',
    RATE_LIMIT_PER_IP: '7', RATE_LIMIT_WINDOW_MS: '1000', LOG_LEVEL: 'debug' }), {
    port: 9998, host: '0.0.0.0', databasePath: ':memory:', limits: { perToken: 5, perIp: 7, windowMs: 1000 }, logLevel: 'debug' });
  for (const value of ['1.5', '1e3', 'abc', '-1', '0']) {
    assert.throws(() => loadApiConfig({ RATE_LIMIT_PER_IP: value }), (err: unknown) =>
      err instanceof ConfigError && err.message === 'Invalid configuration: RATE_LIMIT_PER_IP', value);
  }
});
