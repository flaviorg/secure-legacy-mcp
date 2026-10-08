import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createTokenStore } from '../../src/legacy-api/auth/token-store.ts';
import { openDatabase } from '../../src/legacy-api/db/database.ts';
import { startLegacyApi } from '../../src/legacy-api/start-in-process.ts';
import { fixedClock } from '../../src/shared/clock.ts';
import { tokenIdOf } from '../../src/shared/token-pattern.ts';

const execFileP = promisify(execFile);
const CLI = fileURLToPath(new URL('../../src/legacy-api/cli/tokens.ts', import.meta.url));
// Asynchronous on purpose: the API of the same process needs a free event loop.
const run = (args: string[]) => execFileP(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH } })
  .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));
const tokensIn = (text: string) => text.match(/slm_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/g) ?? [];
const HEADER = /^ID\s+NOME\s+PAPEL\s+CRIADO\s+ÚLTIMO USO\s+EXPIRA\s+STATUS$/m;

async function withDb(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'slm-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'legacy.db');
}

test('[SEC-01] issue prints the token once with the copy-now warning', async (t) => {
  const db = await withDb(t);
  const r = await run(['issue', '--name', 'vscode', '--role', 'member', '--expires-in', '30d', '--db', db]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Copie agora/);
  assert.equal(tokensIn(r.stdout).length, 1);
  assert.match(r.stdout, /id: [a-z0-9]{8} \| nome: vscode \| papel: member \| expira: \d{4}-\d{2}-\d{2}/);
  assert.equal((await run(['issue', '--name', 'x', '--role', 'root', '--db', db])).code, 1);
});

test('[SEC-07] revoke takes effect on the next API request without restarting the API', async (t) => {
  const db = await withDb(t);
  openDatabase(db).close();
  const api = await startLegacyApi({ databasePath: db }); t.after(() => api.close());
  const token = tokensIn((await run(['issue', '--name', 'ci', '--role', 'admin', '--db', db])).stdout)[0]!;
  const whoami = () => fetch(`${api.url}/v1/auth/whoami`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);
  assert.equal(await whoami(), 200);
  assert.equal((await run(['revoke', tokenIdOf(token)!, '--db', db])).code, 0);
  assert.equal(await whoami(), 401);
});

test('[SEC-08] list and list --json never print hashes or tokens', async (t) => {
  const db = await withDb(t);
  const issued = [
    await run(['issue', '--name', 'vscode', '--role', 'member', '--db', db]),
    await run(['issue', '--name', 'ci-admin', '--role', 'admin', '--db', db]),
  ].flatMap((r) => tokensIn(r.stdout));
  assert.equal(issued.length, 2);
  const table = await run(['list', '--db', db]);
  assert.equal(table.code, 0);
  assert.match(table.stdout, HEADER);
  assert.deepEqual(tokensIn(table.stdout), []);
  assert.doesNotMatch(table.stdout, /[0-9a-f]{64}/);
  assert.ok(issued.every((token) => table.stdout.includes(tokenIdOf(token)!)));
  const json = await run(['list', '--json', '--db', db]);
  assert.equal(json.code, 0);
  assert.deepEqual(tokensIn(json.stdout), []);
  assert.doesNotMatch(json.stdout, /[0-9a-f]{64}/);
  const records = JSON.parse(json.stdout) as Record<string, unknown>[];
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'revokedAt', 'role']);
  }
});

test('[SEC-11] revoke of an unknown id exits with code 2 and a clear message', async (t) => {
  const r = await run(['revoke', 'zzzzzzzz', '--db', await withDb(t)]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /zzzzzzzz/);
});

test('[SEC-08] revoke never echoes a token pasted with a missing or an extra character', async (t) => {
  const db = await withDb(t);
  const token = tokensIn((await run(['issue', '--name', 'typo', '--role', 'member', '--db', db])).stdout)[0]!;
  const id = tokenIdOf(token)!;
  const secret = token.slice(`slm_${id}_`.length);
  for (const pasted of [token.slice(0, -1), `${token}x`]) {
    const r = await run(['revoke', pasted, '--db', db]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), `Token slm_${id}_*** não encontrado.`);
    assert.ok(!r.stderr.includes(secret.slice(0, 8)) && !r.stdout.includes(secret.slice(0, 8)));
  }
});

test('list shows dates, "-" for never used, "nunca" without expiry and the ativo, revogado and expirado statuses', async (t) => {
  const db = await withDb(t);
  const before = new Date().toISOString().slice(0, 10);
  const active = tokenIdOf(tokensIn((await run(['issue', '--name', 'ativo-1', '--role', 'member', '--expires-in', '12h', '--db', db])).stdout)[0]!)!;
  const revoked = tokenIdOf(tokensIn((await run(['issue', '--name', 'revogado-1', '--role', 'admin', '--db', db])).stdout)[0]!)!;
  assert.equal((await run(['revoke', revoked, '--db', db])).code, 0);
  const handle = openDatabase(db);
  const expired = createTokenStore(handle, fixedClock('2020-01-01T00:00:00.000Z'))
    .issue({ name: 'expirado-1', role: 'member', expiresAt: new Date('2020-01-02T00:00:00.000Z') }).record.id;
  handle.close();
  const rows = (await run(['list', '--db', db])).stdout.split('\n');
  const row = (id: string) => rows.find((line) => line.startsWith(id))!.trim().split(/\s{2,}/);
  const after = new Date().toISOString().slice(0, 10);
  assert.deepEqual(row(active).slice(1, 3), ['ativo-1', 'member']);
  assert.ok([before, after].includes(row(active)[3]!), 'created today');
  assert.equal(row(active)[4], '-');
  assert.match(row(active)[5]!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(row(active)[6], 'ativo');
  assert.deepEqual(row(revoked).slice(5), ['nunca', 'revogado']);
  assert.deepEqual(row(expired).slice(3), ['2020-01-01', '-', '2020-01-02', 'expirado']);
});

test('revoke is idempotent: a second revoke exits 0 and says it was already revoked', async (t) => {
  const db = await withDb(t);
  const id = tokenIdOf(tokensIn((await run(['issue', '--name', 'twice', '--role', 'member', '--db', db])).stdout)[0]!)!;
  const first = await run(['revoke', id, '--db', db]);
  assert.equal(first.code, 0);
  assert.match(first.stdout, new RegExp(`^Token ${id} revogado\\.$`, 'm'));
  const second = await run(['revoke', id, '--db', db]);
  assert.equal(second.code, 0);
  assert.match(second.stdout, new RegExp(`^Token ${id} já estava revogado\\.$`, 'm'));
});

test('invalid usage prints the usage on stderr and exits with code 1', async (t) => {
  const db = await withDb(t);
  const invalid = [
    [], ['rotate', '--db', db], ['issue', '--role', 'member', '--db', db], ['issue', '--name', 'x', '--db', db],
    ['issue', '--name', 'x', '--role', 'admin', '--expires-in', '30m', '--db', db],
    ['issue', '--name', 'x', '--role', 'admin', '--expires-in', '0d', '--db', db],
    ['list', '--name', 'x', '--db', db], ['revoke', '--db', db], ['issue', '--name', 'x', '--role', 'admin', '--bogus', '--db', db],
  ];
  for (const args of invalid) {
    const r = await run(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, /Uso:/, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.deepEqual(JSON.parse((await run(['list', '--json', '--db', db])).stdout), []);
});
