import test from 'node:test';
import assert from 'node:assert/strict';
import { maskTokens, tokenIdOf } from '../../src/shared/token-pattern.ts';
import { redact, REDACTED } from '../../src/shared/redact.ts';

const token = 'slm_k3x9q2ab_' + 'A'.repeat(43);

test('[MCP-03] tokenIdOf extracts the public id only from well-formed tokens', () => {
  assert.equal(tokenIdOf(token), 'k3x9q2ab');
  assert.equal(tokenIdOf(token + 'x'), null);
  assert.equal(tokenIdOf('slm_<id>_<segredo>'), null);
});

test('[MCP-03] redact masks sensitive field names at any depth', () => {
  assert.deepEqual(
    redact({ a: { Authorization: 'Bearer x', serviceToken: 'y', SERVICE_TOKEN: 'z', token: 1, keep: 2 } }),
    { a: { Authorization: REDACTED, serviceToken: REDACTED, SERVICE_TOKEN: REDACTED, token: REDACTED, keep: 2 } });
});

test('[SEC-09] redact masks token-shaped substrings inside strings and arrays', () => {
  assert.equal(redact(`url=http://x?t=${token} end`), 'url=http://x?t=slm_k3x9q2ab_*** end');
  assert.deepEqual(redact(['Bearer ' + token]), ['Bearer slm_k3x9q2ab_***']);
});

test('[SEC-09] a truncated or padded token is masked as well, never partially echoed', () => {
  for (const pasted of [token.slice(0, 55), token.slice(0, 14), token + 'x', token + '-extra']) {
    assert.equal(maskTokens(`Token ${pasted} end`), 'Token slm_k3x9q2ab_*** end', pasted);
  }
  assert.equal(maskTokens('slm_<id>_<segredo>'), 'slm_<id>_<segredo>'); // placeholders in docs stay readable
  assert.equal(maskTokens('slm_k3x9q2ab_***'), 'slm_k3x9q2ab_***');     // already masked
});

test('[MCP-03] redact keeps Error messages readable and masked', () => {
  const out = redact({ err: new Error(`boom ${token}`) }) as { err: { message: string } };
  assert.equal(out.err.message, 'boom slm_k3x9q2ab_***');
});
