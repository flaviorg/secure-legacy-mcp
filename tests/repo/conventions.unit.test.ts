import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ENV_KEYS } from '../../src/legacy-api/config.ts';
import { MCP_ENV_KEYS } from '../../src/mcp/config.ts';
import { VERSION } from '../../src/mcp/version.ts';
import { importSpecifiers, listRepoFiles, PROJECT_ROOT, readRepoFile, resolveImport, stdoutWriteLines } from '../support/repo-files.ts';

const TOKEN_ANYWHERE = /slm_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/;
const PENDING_MARKER = new RegExp('\\b(' + ['TO', 'DO'].join('') + '|' + ['TB', 'D'].join('') + ')\\b');
const files = listRepoFiles();
const under = (dir: string) => files.filter((f) => f.startsWith(dir) && f.endsWith('.ts'));

test('[PKG-04] scanners detect imports and stdout writes', () => {
  assert.deepEqual(importSpecifiers("import { x } from '../legacy-api/app.ts';\nexport * from './a.ts';\nawait import('./b.ts');"),
    ['../legacy-api/app.ts', './a.ts', './b.ts']);
  assert.deepEqual(stdoutWriteLines("a\nconsole.log(1)\nconsole.error(2)\nprocess.stdout.write('x')"), [2, 4]);
});

test('[PKG-04] src/mcp never imports src/legacy-api', () => {
  const bad = under('src/mcp/').flatMap((f) => importSpecifiers(readRepoFile(f))
    .filter((s) => s.startsWith('.') && resolveImport(f, s).startsWith('src/legacy-api/')).map((s) => `${f} -> ${s}`));
  assert.deepEqual(bad, []);
});

test('[PKG-04] src/mcp never writes to stdout', () => {
  assert.deepEqual(under('src/mcp/').filter((f) => stdoutWriteLines(readRepoFile(f)).length > 0), []);
});

test('src/shared imports nothing from src/mcp or src/legacy-api', () => {
  const bad = under('src/shared/').flatMap((f) => importSpecifiers(readRepoFile(f))
    .filter((s) => s.startsWith('.') && /^src\/(mcp|legacy-api)\//.test(resolveImport(f, s))));
  assert.deepEqual(bad, []);
});

test('[PKG-03] no versioned file outside tests/ contains a token-shaped string (CS-7)', () => {
  assert.deepEqual(files.filter((f) => !f.startsWith('tests/') && TOKEN_ANYWHERE.test(readRepoFile(f))), []);
});

test('no pending markers in versioned files (CS-7)', () => {
  assert.deepEqual(files.filter((f) => f !== 'tests/repo/conventions.unit.test.ts' && PENDING_MARKER.test(readRepoFile(f))), []);
});

test('[PKG-03] .vscode/mcp.json is valid JSON and asks for the token as a password input', () => {
  const cfg = JSON.parse(readRepoFile('.vscode/mcp.json'));
  const input = cfg.inputs.find((i: { id: string }) => i.id === 'slm-service-token');
  assert.equal(input.type, 'promptString');
  assert.equal(input.password, true);
  const server = cfg.servers['secure-legacy-mcp'];
  assert.equal(server.type, 'stdio');
  assert.equal(server.env.SERVICE_TOKEN, '${input:slm-service-token}');
  assert.ok(existsSync(join(PROJECT_ROOT, 'docs/clients/README.md')));
  // Both files are covered by the token scan above (it reads .vscode/ and docs/).
  assert.ok(files.includes('.vscode/mcp.json') && files.includes('docs/clients/README.md'));
});

const EARS_OUTSIDE_NPM_TEST = { 'PKG-02': 'scripts/verify-pack.ts', 'AGT-06': 'tests/live/agent.live.ts' } as const;

test('every EARS id in specs/ has a test named with it (CS-3)', () => {
  const specFiles = files.filter((f) => /^specs\/\d{3}-[^/]+\/spec\.md$/.test(f));
  assert.equal(specFiles.length, 4);
  const ids = [...new Set(specFiles.flatMap((f) => [...readRepoFile(f).matchAll(/\*\*([A-Z]{3}-\d{2})\*\*/g)].map((m) => m[1]!)))];
  const agentExists = existsSync(join(PROJECT_ROOT, 'examples/agent'));
  const testText = files.filter((f) => f.startsWith('tests/') && f.endsWith('.test.ts')).map(readRepoFile).join('\n');
  const missing = ids.filter((id) => {
    if (id.startsWith('AGT-') && !agentExists) return false;
    const elsewhere = EARS_OUTSIDE_NPM_TEST[id as keyof typeof EARS_OUTSIDE_NPM_TEST];
    return elsewhere ? !readRepoFile(elsewhere).includes(`[${id}]`) : !testText.includes(`[${id}]`);
  });
  assert.deepEqual(missing, []);
  assert.ok(ids.length >= 50);
});

// Spec 8.3 split by feature (plus API-08, SEC-14, MCP-17 and MCP-18 from the final reviews): a criterion dropped from a
// spec would otherwise go unnoticed, since CS-3 only checks the ids that are there.
const EARS_BY_SPEC: Record<string, [string, number][]> = {
  'specs/001-legacy-api-and-security/spec.md': [['API', 8], ['SEC', 14]],
  'specs/002-mcp-business-actions/spec.md': [['MCP', 18]],
  'specs/003-packaging-clients-and-bench/spec.md': [['PKG', 4], ['BEN', 3], ['REP', 4]],
  'specs/004-langchain-agent-memory/spec.md': [['AGT', 6]],
};

test('each spec lists the complete, contiguous set of its EARS ids, and the constitution stays short (CS-3)', () => {
  for (const [file, groups] of Object.entries(EARS_BY_SPEC)) {
    const found = [...readRepoFile(file).matchAll(/^- \*\*([A-Z]{3}-\d{2})\*\*/gm)].map((m) => m[1]!);
    const expected = groups.flatMap(([prefix, n]) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual(found, expected, file);
  }
  assert.ok(readRepoFile('specs/constitution.md').split('\n').length <= 60);
});

test('[REP-01] AGENTS.md has at most 100 lines', () => {
  assert.ok(readRepoFile('AGENTS.md').split('\n').length <= 100);
});

test('AGENTS.md names the commands and the bench:tokens rule (spec 9.1)', () => {
  const text = readRepoFile('AGENTS.md');
  for (const command of ['npm test', 'npm run typecheck', 'npm run demo', 'npm run bench:tokens', 'npm run test:pack']) assert.ok(text.includes(command), command);
  assert.match(text, /schema: run `npm run bench:tokens` before committing/);
});

test('[REP-02] .env.example lists every variable read by the config schemas', async () => {
  const keys: string[] = [...API_ENV_KEYS, ...MCP_ENV_KEYS];
  const agentConfig = join(PROJECT_ROOT, 'examples/agent/config.ts');
  if (existsSync(agentConfig)) keys.push(...(await import(pathToFileURL(agentConfig).href)).AGENT_ENV_KEYS); // dynamic specifier: tsc does not require the file if M9 was cut
  const env = readRepoFile('.env.example');
  assert.deepEqual(keys.filter((k) => !new RegExp(`^${k}=`, 'm').test(env)), []);
  assert.match(env, /^SERVICE_TOKEN=$/m);
  assert.match(env, /^OPENROUTER_API_KEY=$/m);
});

test('[REP-04] .githooks/pre-commit is executable and runs typecheck and tests', () => {
  const path = join(PROJECT_ROOT, '.githooks/pre-commit');
  assert.ok((statSync(path).mode & 0o111) !== 0);
  const text = readFileSync(path, 'utf8');
  assert.ok(text.startsWith('#!/bin/sh') && text.includes('npm run typecheck') && text.includes('npm test'));
  assert.match(text, /^set -e$/m);
});

test('VERSION matches package.json', () => {
  assert.equal(VERSION, JSON.parse(readRepoFile('package.json')).version);
});

test('LICENSE is MIT', () => {
  assert.match(readRepoFile('LICENSE'), /^MIT License/);
  assert.match(readRepoFile('LICENSE'), /^Copyright \(c\) 2026 Flavio Gouveia$/m);
});

// Spec 4.3, rule 4: in src/ and examples/, only the entrypoints and the agent config read
// process.env; everything else receives configuration as a parameter. Comments are ignored.
const ENV_READERS = new Set(['src/mcp/main.ts', 'src/legacy-api/main.ts', 'src/legacy-api/cli/tokens.ts', 'examples/agent/config.ts']);

test('only the entrypoints and examples/agent/config.ts read process.env (spec 4.3)', () => {
  const readsEnv = (source: string) => source.split('\n').some((line) => /\bprocess\.env\b/.test(line.replace(/\/\/.*$/, '')));
  const offenders = files.filter((f) => /^(src|examples)\/.*\.ts$/.test(f) && !ENV_READERS.has(f) && readsEnv(readRepoFile(f)));
  assert.deepEqual(offenders, []);
  assert.ok(readsEnv('const x = process.env.X;') && !readsEnv('// main.ts reads process.env.'));
});

test('CI runs typecheck, tests with coverage and the pack check on the Node from .nvmrc (CS-8)', () => {
  const yml = readRepoFile('.github/workflows/ci.yml');
  for (const s of ['node-version-file: .nvmrc', 'npm ci', 'npm run typecheck', 'npm run test:coverage', 'npm run test:pack', 'contents: read']) assert.ok(yml.includes(s), s);
  assert.ok(!/node-version:\s*22/.test(yml));
  assert.match(yml, /OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/);
  assert.match(yml, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(yml, /^  pack:\n(?:    .*\n)*?    needs: check$/m);
});
