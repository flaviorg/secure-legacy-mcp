import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApiConfig } from '../../src/legacy-api/config.ts';
import { readRepoFile } from '../support/repo-files.ts';

// Where `npm run api` listens without a .env (spec 5.8): every client config points there.
const DEFAULT_API = (() => {
  const { host, port } = loadApiConfig({});
  return `http://${host}:${port}`;
})();
const pkg = JSON.parse(readRepoFile('package.json')) as { name: string; bin: Record<string, string> };

test('.vscode/mcp.json runs node on src/mcp/main.ts with the two variables and the default API address', () => {
  const server = JSON.parse(readRepoFile('.vscode/mcp.json')).servers['secure-legacy-mcp'];
  assert.equal(server.command, 'node'); // never npm: its banner reaches stdout before the JSON-RPC
  assert.deepEqual(server.args, ['${workspaceFolder}/src/mcp/main.ts']);
  assert.deepEqual(server.env, { SERVICE_TOKEN: '${input:slm-service-token}', LEGACY_API_URL: DEFAULT_API });
});

// People paste these snippets into Cursor and Claude Desktop config files as they are.
test('the client snippets in docs/clients/README.md are valid JSON that start the server with the placeholder token', () => {
  const blocks = [...readRepoFile('docs/clients/README.md').matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
  assert.equal(blocks.length, 3, 'Cursor, Claude Desktop from the clone, Claude Desktop through npx');
  for (const block of blocks) {
    const servers = JSON.parse(block).mcpServers as Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    assert.deepEqual(Object.keys(servers), ['secure-legacy-mcp']);
    const server = servers['secure-legacy-mcp']!;
    assert.deepEqual(server.env, { SERVICE_TOKEN: 'slm_<id>_<segredo>', LEGACY_API_URL: DEFAULT_API });
    const fromClone = server.args.length === 1 && server.args[0]!.startsWith('/') && server.args[0]!.endsWith('/src/mcp/main.ts');
    const fromPackage = server.command === 'npx' && pkg.name in pkg.bin && JSON.stringify(server.args) === JSON.stringify(['-y', pkg.name]);
    assert.ok(fromClone || fromPackage, block);
  }
});
