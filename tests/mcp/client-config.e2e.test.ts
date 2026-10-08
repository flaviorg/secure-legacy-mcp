import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startTestApi } from '../support/api-harness.ts';
import { guardNodeOptions } from '../support/guard-options.ts';
import { PROJECT_ROOT, readRepoFile } from '../support/repo-files.ts';

type ServerEntry = { type: string; command: string; args: string[]; env: Record<string, string> };

// What VS Code does with the versioned config, minus the editor: fill in
// ${workspaceFolder} and the password input, then start the stdio server. Only the API
// address changes, to the test API's ephemeral port (the config points at the default).
test('the server entry of .vscode/mcp.json, with its variables filled in, answers tools/list and getCustomer', async (t) => {
  const server = (JSON.parse(readRepoFile('.vscode/mcp.json')) as { servers: Record<string, ServerEntry> }).servers['secure-legacy-mcp']!;
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'node');
  const api = await startTestApi(t);
  const token = api.issueToken('member', 'vscode');
  const fill = (value: string) => value.replaceAll('${workspaceFolder}', PROJECT_ROOT).replaceAll('${input:slm-service-token}', token);
  const env = Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, fill(value)]));
  const transport = new StdioClientTransport({
    command: process.execPath, // the `node` of the config, pinned to the one running the tests
    args: server.args.map(fill),
    env: { ...env, LEGACY_API_URL: api.url, PATH: process.env.PATH ?? '', NODE_OPTIONS: guardNodeOptions() },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'vscode-config-check', version: '0.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(),
    ['createCustomer', 'deactivateCustomer', 'getCustomer', 'searchCustomers', 'updateCustomerContact']);
  const r = await client.callTool({ name: 'getCustomer', arguments: { name: 'teodoro' } });
  assert.equal((r.structuredContent as { match: string; customer: { name: string } }).customer.name, 'Teodoro Escarlate');
  assert.equal(env.SERVICE_TOKEN, token);
});
