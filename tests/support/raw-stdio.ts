// Spawns the MCP server by hand to inspect stdout and stderr exactly as written,
// without the SDK client in between.
import { spawn } from 'node:child_process';
import { collectLines, MAIN_PATH, waitUntil } from './mcp-harness.ts';

// Runs the server with stdin already closed and waits for it to exit. Used for the
// fail-early cases; a process still running after timeoutMs is killed (code null).
export function runMcpProcess(env: Record<string, string>, opts: { timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { stderr += c; });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 10_000);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end();
  });
}

export type RawMcp = {
  send(msg: object): void;
  waitForId(id: number): Promise<object>;
  stdoutLines: string[];
  stderrLines: string[];
  close(): Promise<void>;
};

export function spawnMcpRaw(env: Record<string, string>): RawMcp {
  const child = spawn(process.execPath, [MAIN_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  collectLines(child.stdout, stdoutLines);
  collectLines(child.stderr, stderrLines);
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));

  const findId = (id: number): object | undefined => {
    for (const line of stdoutLines) {
      try {
        const msg = JSON.parse(line) as { id?: unknown };
        if (msg.id === id) return msg;
      } catch {
        // not JSON: the stdout test reports it; keep looking here
      }
    }
    return undefined;
  };

  return {
    stdoutLines,
    stderrLines,
    send(msg) { child.stdin.write(JSON.stringify(msg) + '\n'); },
    async waitForId(id) {
      await waitUntil(() => findId(id) !== undefined, 10_000);
      return findId(id)!;
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end();
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        await exited;
        clearTimeout(timer);
      }
    },
  };
}
