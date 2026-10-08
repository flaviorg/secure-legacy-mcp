import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApi } from '../support/api-harness.ts';
import { mcpEnv, startStack } from '../support/mcp-harness.ts';
import { spawnMcpRaw } from '../support/raw-stdio.ts';

const toolCalls = (events: Record<string, unknown>[]) => events.filter((e) => e.event === 'tool_call');

test('[MCP-02] every stdout line is a JSON-RPC 2.0 message', async (t) => {
  const api = await startTestApi(t);
  const raw = spawnMcpRaw(mcpEnv(api.issueToken('admin'), api.url)); t.after(() => raw.close());
  raw.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  await raw.waitForId(1);
  raw.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  raw.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  raw.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'getCustomer', arguments: { name: 'teodoro' } } });
  raw.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'getCustomer', arguments: {} } });
  raw.send({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'customers://service-info' } });
  await Promise.all([2, 3, 4, 5].map((id) => raw.waitForId(id)));
  assert.ok(raw.stdoutLines.length >= 5);
  assert.match((await raw.waitForId(5) as { result: { contents: { text: string }[] } }).result.contents[0]!.text, /role: admin/);
  for (const line of raw.stdoutLines) assert.equal(JSON.parse(line).jsonrpc, '2.0', line);
});

test('[MCP-03] every stderr line is a JSON log with ts, level, component, event and no full token', async (t) => {
  const { client, token, stderrLines, waitForStderr } = await startStack(t, { role: 'admin' });
  await client.callTool({ name: 'getCustomer', arguments: { name: 'teodoro' } });
  await client.callTool({ name: 'getCustomer', arguments: { id: 99999 } });
  await waitForStderr((events) => toolCalls(events).length >= 2);
  assert.ok(stderrLines.length > 0);
  for (const line of stderrLines) {
    const e = JSON.parse(line);
    for (const k of ['ts', 'level', 'component', 'event']) assert.ok(k in e, `${k} in ${line}`);
    assert.ok(!line.includes(token));
  }
});

test('parallel tool calls on one process all answer with distinct requestIds', async (t) => {
  const { client, stderrLines, waitForStderr } = await startStack(t, { role: 'member' });
  const results = await Promise.all([1, 2, 3, 4, 5].map((id) => client.callTool({ name: 'getCustomer', arguments: { id } })));
  assert.ok(results.every((r) => !r.isError));
  await waitForStderr((events) => toolCalls(events).length >= 5);
  const ids = stderrLines.map((l) => JSON.parse(l)).filter((e) => e.event === 'tool_call').map((e) => e.requestId);
  assert.equal(new Set(ids).size, 5);
});
