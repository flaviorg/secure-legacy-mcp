import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { guardNodeOptions } from '../support/guard-options.ts';

const execFileP = promisify(execFile);
const DEMO = fileURLToPath(new URL('../../examples/agent/demo.ts', import.meta.url));

test('[AGT-01] agent:demo shows the real id with memory and the ifUnresolved text without it, using the fake by default', async () => {
  // No OPENROUTER_API_KEY in this environment: the demo must pick the fake.
  const r = await execFileP(process.execPath, [DEMO], { env: { PATH: process.env.PATH!, NODE_OPTIONS: guardNodeOptions() }, timeout: 60_000 });
  const lines = r.stdout.split('\n');
  const at = (line: string) => lines.indexOf(line);
  const on = at('LLM: fake (script create-then-ask-id) | memory: on');
  const off = at('LLM: fake (script create-then-ask-id) | memory: off');
  const withMemory = at('  < The id of Ana Souza is 31.');
  const withoutMemory = at('  < I do not know which customer you mean. Can you tell me the name or the email?');
  assert.ok(on !== -1 && off !== -1 && withMemory !== -1 && withoutMemory !== -1, r.stdout);
  // Memory on first, with the real id; then memory off, with the ifUnresolved text.
  assert.ok(on < withMemory && withMemory < off && off < withoutMemory, r.stdout);
  assert.equal(lines.filter((l) => l === '  tool createCustomer -> #31').length, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /slm_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/);
});
