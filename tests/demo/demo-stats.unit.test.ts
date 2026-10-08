import test from 'node:test';
import assert from 'node:assert/strict';
import { countStderrLine, countStdoutError, countStdoutMessage, countTransportMessages, demoSucceeded, emptyStats } from '../../scripts/demo.ts';

// The demo summary ("todas JSON-RPC 2.0", "linhas de log JSON", "0 tokens expostos")
// and its exit code are only as honest as these counters: each one must flag the
// problem it reports, not merely start at zero.
const FAKE_TOKEN = `slm_abcd1234_${'A'.repeat(43)}`;

test('the stdout counters flag messages outside JSON-RPC 2.0 and unparsable output', () => {
  const stats = emptyStats();
  countStdoutMessage(stats, { jsonrpc: '2.0', id: 1, result: {} });
  assert.deepEqual([stats.stdoutMessages, stats.stdoutInvalid], [1, 0]);
  countStdoutMessage(stats, { jsonrpc: '1.0', id: 2 });
  countStdoutMessage(stats, null);
  countStdoutError(stats); // the SDK reports a line that is not JSON-RPC through onerror
  assert.deepEqual([stats.stdoutMessages, stats.stdoutInvalid], [4, 3]);
});

// The SDK parses each stdout line and hands a line that is not JSON-RPC to onerror, so
// the demo must count onerror as an invalid message, except while it closes the clients.
test('the transport hooks count every stdout message and treat onerror as invalid until closing', () => {
  const stats = emptyStats();
  let closing = false;
  const transport: Parameters<typeof countTransportMessages>[0] = {};
  countTransportMessages(transport, stats, () => closing);
  transport.onmessage!({ jsonrpc: '2.0', id: 1, result: {} });
  transport.onerror!(new Error('Unexpected token < in JSON'));
  assert.deepEqual([stats.stdoutMessages, stats.stdoutInvalid], [2, 1]);
  closing = true;
  transport.onerror!(new Error('write EPIPE'));
  assert.deepEqual([stats.stdoutMessages, stats.stdoutInvalid], [2, 1]);
});

test('the stderr counter flags lines that are not JSON and lines with a token, issued or not', () => {
  const stats = emptyStats();
  countStderrLine(stats, '{"level":"info","event":"tool_call","tokenId":"abcd1234"}', [FAKE_TOKEN]);
  countStderrLine(stats, '{"msg":"slm_abcd1234_***"}', [FAKE_TOKEN]);
  countStderrLine(stats, '', [FAKE_TOKEN]);
  assert.deepEqual([stats.stderrLines, stats.stderrNonJson, stats.tokensExposed], [2, 0, 0]);
  countStderrLine(stats, 'Error: boom', []);
  countStderrLine(stats, `{"auth":"Bearer ${FAKE_TOKEN}"}`, [FAKE_TOKEN]);
  countStderrLine(stats, `{"leak":"${FAKE_TOKEN.replace('abcd1234', 'zzzz9999')}"}`, [FAKE_TOKEN]);
  assert.deepEqual([stats.stderrLines, stats.stderrNonJson, stats.tokensExposed], [5, 1, 2]);
});

test('demoSucceeded fails the demo when any counter flags a problem', () => {
  assert.equal(demoSucceeded({ ...emptyStats(), stdoutMessages: 104, stderrLines: 106 }), true);
  for (const flag of ['stdoutInvalid', 'stderrNonJson', 'tokensExposed'] as const) {
    assert.equal(demoSucceeded({ ...emptyStats(), stdoutMessages: 104, stderrLines: 106, [flag]: 1 }), false, flag);
  }
});
