// Full stack for the MCP e2e tests: real legacy API, a token issued in its database
// and the MCP server as a child process driven by a real SDK Client over stdio.
import type { Readable } from 'node:stream';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Limits } from '../../src/legacy-api/app.ts';
import type { Role } from '../../src/legacy-api/auth/token-store.ts';
import { startTestApi } from './api-harness.ts';
import type { TestApi } from './api-harness.ts';
import { guardNodeOptions } from './guard-options.ts';

export const MAIN_PATH = fileURLToPath(new URL('../../src/mcp/main.ts', import.meta.url));

// Minimal, explicit environment for the child: nothing inherited from the shell
// except PATH, plus the network guard (spec 5.8).
export function mcpEnv(token: string, apiUrl: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    SERVICE_TOKEN: token,
    LEGACY_API_URL: apiUrl,
    LOG_LEVEL: 'debug',
    NODE_OPTIONS: guardNodeOptions(),
    ...extra,
  };
}

// Splits a byte stream into complete lines, keeping a partial last line until it ends.
export function collectLines(stream: Readable, into: string[]): void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) if (line !== '') into.push(line);
  });
}

// Polls until `predicate` holds. Stdout and stderr are separate pipes, so a log line
// written before a response can still be read after it.
export async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil: condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export type Stack = {
  api: TestApi;
  client: Client;
  token: string;
  stderrLines: string[];
  // Waits until the parsed stderr events satisfy `predicate`.
  waitForStderr(predicate: (events: Record<string, unknown>[]) => boolean, timeoutMs?: number): Promise<void>;
};

export async function startStack(t: TestContext, opts: { role?: Role; api?: TestApi; limits?: Partial<Limits>; legacyApiUrl?: string } = {}): Promise<Stack> {
  const api = opts.api ?? await startTestApi(t, { limits: opts.limits });
  const token = api.issueToken(opts.role ?? 'admin');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MAIN_PATH],
    env: mcpEnv(token, opts.legacyApiUrl ?? api.url),
    stderr: 'pipe',
  });
  const stderrLines: string[] = [];
  collectLines(transport.stderr as Readable, stderrLines); // a PassThrough when stderr is 'pipe'
  const client = new Client({ name: 'secure-legacy-mcp-tests', version: '0.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const events = () => stderrLines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return {
    api,
    client,
    token,
    stderrLines,
    waitForStderr: (predicate, timeoutMs) => waitUntil(() => predicate(events()), timeoutMs),
  };
}
