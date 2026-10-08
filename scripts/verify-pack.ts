// `npm run test:pack` (criterion PKG-02, outside `npm test`): packs the project, runs
// the `secure-legacy-mcp` binary from the tarball through `npx --package`, and checks
// with a real SDK Client that tools/list answers with the 5 business actions.
// Uses the npm cache (--prefer-offline); the API runs in this process on 127.0.0.1.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startLegacyApi } from '../src/legacy-api/start-in-process.ts';
import type { RunningApi } from '../src/legacy-api/start-in-process.ts';
import { maskTokens } from '../src/shared/token-pattern.ts';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const EXPECTED_TOOLS = ['createCustomer', 'deactivateCustomer', 'getCustomer', 'searchCustomers', 'updateCustomerContact'];

type PackResult = { filename: string; size: number; entryCount: number };

const out = (line: string) => { process.stdout.write(`${line}\n`); };
const kB = (bytes: number) => (bytes / 1000).toFixed(1).replace('.', ',');

async function verifyPack(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'slm-pack-'));
  let api: RunningApi | undefined;
  let client: Client | undefined;
  const stderr: string[] = [];
  try {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--pack-destination', tmp, '--json'], {
      cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' },
    })) as PackResult[];
    const tarball = packed[0];
    if (tarball === undefined) throw new Error('npm pack produced no tarball');
    out(`npm pack -> ${tarball.filename} (${tarball.entryCount} arquivos, ${kB(tarball.size)} kB)`);

    api = await startLegacyApi();
    const token = api.tokens.issue({ name: 'verify-pack', role: 'admin' }).token;
    out(`diretório temporário: ${tmp} | API em ${api.url}`);

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? homedir(),
      SERVICE_TOKEN: token,
      LEGACY_API_URL: api.url,
      npm_config_update_notifier: 'false',
    };
    // Lets the run happen under the network guard (only the npm cache is then usable).
    if (process.env.NODE_OPTIONS) env.NODE_OPTIONS = process.env.NODE_OPTIONS;
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['--yes', '--prefer-offline', '--package', join(tmp, tarball.filename), 'secure-legacy-mcp'],
      env,
      cwd: tmp,
      stderr: 'pipe',
    });
    (transport.stderr as Readable).setEncoding('utf8').on('data', (chunk: string) => { stderr.push(chunk); });
    client = new Client({ name: 'secure-legacy-mcp-verify-pack', version: '0.0.0' });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    if (JSON.stringify([...names].sort()) !== JSON.stringify(EXPECTED_TOOLS)) throw new Error(`unexpected tools: ${names.join(', ')}`);
    out(`npx --package ${tarball.filename} secure-legacy-mcp -> tools/list: ${names.length} tools`);
  } catch (err) {
    const tail = maskTokens(stderr.join('')).split('\n').slice(-20).join('\n');
    if (tail.trim() !== '') process.stderr.write(`stderr do servidor (fim):\n${tail}\n`);
    throw err;
  } finally {
    await client?.close();
    await api?.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  await verifyPack();
  out('ok [PKG-02]');
} catch (err) {
  process.stderr.write(`falhou [PKG-02]: ${maskTokens(String((err as Error)?.message ?? err))}\n`);
  process.exitCode = 1;
}
