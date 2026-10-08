import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../support/repo-files.ts';

const HOOK = join(PROJECT_ROOT, '.githooks/pre-commit');

// Runs the real hook with a stub `npm` first on the PATH: the stub records each call and
// fails the one named in STUB_FAIL. Nothing from the project runs.
function runHook(t: TestContext, fail: string) {
  const dir = mkdtempSync(join(tmpdir(), 'slm-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.log');
  const stub = join(dir, 'npm');
  writeFileSync(stub, '#!/bin/sh\necho "$*" >> "$STUB_LOG"\n[ "$*" = "$STUB_FAIL" ] && exit 1\nexit 0\n');
  chmodSync(stub, 0o755);
  writeFileSync(log, '');
  const r = spawnSync('/bin/sh', [HOOK], { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin`, STUB_LOG: log, STUB_FAIL: fail }, encoding: 'utf8' });
  return { status: r.status, calls: readFileSync(log, 'utf8').trim().split('\n').filter((l) => l !== '') };
}

test('[REP-04] the pre-commit hook runs typecheck, then tests, and lets the commit through when both pass', (t) => {
  assert.deepEqual(runHook(t, 'none'), { status: 0, calls: ['run typecheck', 'test'] });
});

test('[REP-04] the pre-commit hook aborts the commit when typecheck fails, without running the tests', (t) => {
  const r = runHook(t, 'run typecheck');
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls, ['run typecheck']);
});

test('[REP-04] the pre-commit hook aborts the commit when the tests fail', (t) => {
  const r = runHook(t, 'test');
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls, ['run typecheck', 'test']);
});
