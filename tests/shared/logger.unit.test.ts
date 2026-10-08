import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/shared/logger.ts';
import type { ConfigLevel } from '../../src/shared/logger.ts';
import { fixedClock } from '../../src/shared/clock.ts';

const at = '2026-10-04T12:00:00.000Z';
function capture(level: ConfigLevel) {
  const lines: string[] = [];
  const log = createLogger({ component: 'mcp', level, write: (l) => lines.push(l), clock: fixedClock(at) });
  return { log, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test('[MCP-03] each event is one JSON line with ts, level, component and event', () => {
  const { log, lines, parsed } = capture('info');
  log.info('tool_call', { tool: 'getCustomer' });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.endsWith('\n'));
  assert.deepEqual(parsed()[0], { ts: at, level: 'info', component: 'mcp', event: 'tool_call', tool: 'getCustomer' });
});

test('[MCP-03] events below the level are dropped and fatal is always written', () => {
  const { log, parsed } = capture('error');
  log.debug('a'); log.info('b'); log.warn('c'); log.error('d'); log.fatal('e');
  assert.deepEqual(parsed().map((e) => e.event), ['d', 'e']);
});

test('[MCP-03] child loggers merge fields and redact tokens', () => {
  const { log, parsed } = capture('debug');
  log.child({ requestId: 'r1' }).warn('x', { authorization: 'Bearer abc' });
  assert.deepEqual(parsed()[0], { ts: at, level: 'warn', component: 'mcp', event: 'x', requestId: 'r1', authorization: '[REDACTED]' });
});
