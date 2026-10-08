import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT, readRepoFile } from '../support/repo-files.ts';

const pkg = JSON.parse(readRepoFile('package.json'));

test('[PKG-01] the tarball contains only the allowed paths', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' } });
  const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
  for (const f of files) assert.ok(['package.json', 'README.md', 'LICENSE'].includes(f) || /^(bin|src\/mcp|src\/shared)\//.test(f), f);
  assert.ok(files.includes('bin/secure-legacy-mcp.js'));
  assert.ok(files.includes('src/mcp/main.ts'));
  assert.ok(!files.some((f) => f.startsWith('src/legacy-api/') || f.startsWith('tests/') || f.startsWith('scripts/')));
  assert.equal(pkg.bin['secure-legacy-mcp'], 'bin/secure-legacy-mcp.js');
});

test('[PKG-01] dependencies are exactly the three runtime packages with exact versions', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@modelcontextprotocol/sdk', 'tsx', 'zod']);
  for (const v of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)] as string[]) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.scripts.postinstall, undefined);
});

test('[PKG-01] the binary is executable and loads main.ts through tsx', () => {
  assert.equal(readRepoFile('bin/secure-legacy-mcp.js'),
    "#!/usr/bin/env node\nimport { register } from 'tsx/esm/api';\n\nregister();\nawait import('../src/mcp/main.ts');\n");
  assert.ok((statSync(join(PROJECT_ROOT, 'bin/secure-legacy-mcp.js')).mode & 0o111) !== 0);
});
