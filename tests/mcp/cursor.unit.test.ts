import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCursor, encodeCursor } from '../../src/mcp/application/cursor.ts';
import { DomainError } from '../../src/mcp/domain/errors.ts';

const filter = { nameContains: 'Silv', status: 'active' } as const;
const invalid = (e: unknown) => e instanceof DomainError && e.code === 'INVALID_INPUT' && e.details.rule === 'cursor does not match the current filters';

test('[MCP-16] round-trips the offset for equivalent filters and stays within 64 characters', () => {
  const cursor = encodeCursor(20, filter);
  assert.ok(cursor.length <= 64);
  assert.deepEqual(decodeCursor(cursor, { status: 'active', nameContains: ' silv ' }), { offset: 20 });
});

test('[MCP-16] rejects cursors issued for other filters and malformed cursors', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  for (const bad of [encodeCursor(10, { status: 'inactive' }), 'not-base64!', b64('{"o":-1,"h":"abcd1234"}'), b64('[]'), b64('{"o":1}')]) {
    assert.throws(() => decodeCursor(bad, filter), invalid, bad);
  }
});

test('[MCP-16] a cursor with the right filter hash but an invalid offset is rejected', () => {
  // The malformed cursors above carry a foreign hash, which fails first; here only the offset is wrong.
  const withOffset = (o: unknown) => {
    const payload = JSON.parse(Buffer.from(encodeCursor(20, filter), 'base64url').toString('utf8')) as Record<string, unknown>;
    return Buffer.from(JSON.stringify({ ...payload, o })).toString('base64url');
  };
  assert.deepEqual(decodeCursor(withOffset(5), filter), { offset: 5 });
  for (const o of [-1, 1.5, '5', null]) assert.throws(() => decodeCursor(withOffset(o), filter), invalid, String(o));
});
