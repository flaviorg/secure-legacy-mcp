import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTokenStore } from '../../src/legacy-api/auth/token-store.ts';
import { openDatabase } from '../../src/legacy-api/db/database.ts';
import { fixedClock } from '../../src/shared/clock.ts';
import { TOKEN_REGEX, tokenIdOf } from '../../src/shared/token-pattern.ts';

function setup() {
  const db = openDatabase(':memory:');
  const clock = fixedClock('2026-10-04T12:00:00.000Z');
  return { db, clock, store: createTokenStore(db, clock) };
}

test('[SEC-01] issue stores only the SHA-256 of the token and returns the token once', () => {
  const { db, store } = setup();
  const { token, record } = store.issue({ name: 'ci', role: 'admin' });
  assert.match(token, TOKEN_REGEX);
  assert.equal(tokenIdOf(token), record.id);
  const row = db.prepare('SELECT * FROM service_tokens WHERE id = ?').get(record.id) as Record<string, string>;
  assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.ok(!Object.values(row).includes(token));
});

test('[SEC-08] list never exposes hashes or tokens', () => {
  const { store } = setup();
  const { token } = store.issue({ name: 'a', role: 'member' });
  const listed = JSON.stringify(store.list());
  assert.ok(!listed.includes(token) && !/[0-9a-f]{64}/.test(listed));
  assert.deepEqual(Object.keys(store.list()[0]!).sort(), ['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'revokedAt', 'role']);
});

test('[SEC-07] revoked tokens stop verifying and revoke reports each outcome', () => {
  const { store } = setup();
  const { token, record } = store.issue({ name: 'a', role: 'member' });
  assert.equal(store.verify(token)?.role, 'member');
  assert.equal(store.revoke(record.id), 'revoked');
  assert.equal(store.verify(token), null);
  assert.equal(store.revoke(record.id), 'already_revoked');
  assert.equal(store.revoke('zzzzzzzz'), 'not_found');
});

test('[SEC-10] tokens past expires_at are invalid', () => {
  const { store, clock } = setup();
  const { token } = store.issue({ name: 'a', role: 'admin', expiresAt: new Date('2026-10-05T12:00:00.000Z') });
  assert.ok(store.verify(token));
  clock.advance(24 * 3600 * 1000 + 1);
  assert.equal(store.verify(token), null);
});

test('verify rejects malformed, unknown and tampered tokens and records last use', () => {
  const { store, clock } = setup();
  const { token, record } = store.issue({ name: 'a', role: 'admin' });
  for (const bad of ['', 'Bearer x', token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), 'slm_zzzzzzzz_' + 'A'.repeat(43)]) assert.equal(store.verify(bad), null);
  clock.advance(1000);
  store.verify(token);
  assert.equal(store.list().find((r) => r.id === record.id)?.lastUsedAt, '2026-10-04T12:00:01.000Z');
});
