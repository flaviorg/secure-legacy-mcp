import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import { executeTool } from '../../src/mcp/tools/define-tool.ts';
import { createLogger } from '../../src/shared/logger.ts';

function deps() {
  const lines: string[] = [];
  return { lines, deps: { logger: createLogger({ component: 'mcp', level: 'debug', write: (l) => lines.push(l) }), newRequestId: () => 'req-1' } };
}

test('success returns compact JSON text and the same structuredContent', async () => {
  const r = await executeTool('t', deps().deps, async () => ({ a: 1, b: [2] }));
  assert.deepEqual(r, { content: [{ type: 'text', text: '{"a":1,"b":[2]}' }], structuredContent: { a: 1, b: [2] } });
});

test('[MCP-08] DomainError becomes [CODE] text with _meta and no structuredContent', async () => {
  const r = await executeTool('t', deps().deps, async () => { throw new DomainError('RATE_LIMITED', { limit: 90, retryAfterSeconds: 58, scope: 'token', upstreamStatus: 429 }); });
  assert.equal(r.isError, true);
  assert.equal('structuredContent' in r, false);
  assert.equal((r.content[0] as { text: string }).text, '[RATE_LIMITED] Rate limit reached (90 requests/minute). Retry in 58 seconds.');
  assert.deepEqual(r._meta, { 'secure-legacy-mcp/error': { code: 'RATE_LIMITED', retryable: true, requestId: 'req-1', retryAfterSeconds: 58, scope: 'token' } });
});

test('[MCP-14] unexpected exceptions become [INTERNAL] with requestId and the detail only in the log', async () => {
  const { lines, deps: d } = deps();
  const r = await executeTool('t', d, async () => { throw new Error('SQLITE_ERROR: boom'); });
  const text = (r.content[0] as { text: string }).text;
  assert.equal(text, '[INTERNAL] Unexpected error (requestId req-1).');
  assert.ok(!/SQLITE|Error:|\bat /.test(text));
  assert.ok(lines.some((l) => l.includes('SQLITE_ERROR: boom')));
});

test('every call logs tool_call with outcome and duration', async () => {
  const { lines, deps: d } = deps();
  await executeTool('getCustomer', d, async () => ({}));
  const e = lines.map((l) => JSON.parse(l)).find((x) => x.event === 'tool_call');
  assert.equal(e.tool, 'getCustomer'); assert.equal(e.outcome, 'ok'); assert.equal(e.requestId, 'req-1');
  assert.equal(typeof e.durationMs, 'number');
});
