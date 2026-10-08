import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writeBenchOutputs } from '../../scripts/bench/measure-tool-tokens.ts';
import { countTokens } from '../../scripts/bench/tokenize.ts';
import { SCENARIOS } from '../../scripts/bench/scenarios.ts';
import { buildTokenReport, relativeDifference, renderComparisonDoc, replaceBlock } from '../../scripts/bench/token-report.ts';
import { guardNodeOptions } from '../support/guard-options.ts';
import { readRepoFile } from '../support/repo-files.ts';

test('[BEN-01] two runs produce byte-identical output', async () => {
  assert.equal(await buildTokenReport(), await buildTokenReport());
});

test('[BEN-02] the README block equals the generated report', async () => {
  const readme = readRepoFile('README.md');
  const block = readme.split('<!-- token-table:start -->')[1]?.split('<!-- token-table:end -->')[0];
  assert.ok(block !== undefined, 'markers missing');
  assert.equal(block.trim(), (await buildTokenReport()).trim());
});

test('[BEN-02] replaceBlock swaps only the marked block and throws without markers', () => {
  const readme = 'a\n<!-- token-table:start -->\nold\n<!-- token-table:end -->\nb\n';
  assert.equal(replaceBlock(readme, 'new'), 'a\n<!-- token-table:start -->\nnew\n<!-- token-table:end -->\nb\n');
  assert.throws(() => replaceBlock('a\n<!-- token-table:start -->\nb\n', 'new'), /token-table:end/);
  assert.throws(() => replaceBlock('a\nb\n', 'new'), /token-table:start/);
});

test('countTokens gives the o200k count and the chars/4 estimate', () => {
  assert.deepEqual(countTokens(''), { o200k: 0, chars4: 0 });
  const r = countTokens('hello world');
  assert.equal(r.chars4, 3);
  assert.ok(r.o200k >= 1 && r.o200k <= 3);
});

test('[BEN-03] the report measures 7 mirror tools, 5 business actions and every scenario', async () => {
  const report = await buildTokenReport();
  assert.match(report, /\| Espelho REST \(gerado do OpenAPI\) \| 7 \| \d+ \| \d+ \|/);
  assert.match(report, /\| Ações de negócio \| 5 \| \d+ \| \d+ \|/);
  assert.match(report, /\| Spec OpenAPI inteira no prompt \| - \| \d+ \| \d+ \|/);
  for (const id of ['C1', 'C2a', 'C2b', 'C3']) assert.match(report, new RegExp(`\\| ${id} `), id);
  assert.match(report, /docs\/token-comparison\.md/);
});

test('[BEN-02] docs/token-comparison.md carries the methodology and the same generated block', async () => {
  const doc = readRepoFile('docs/token-comparison.md');
  assert.ok(doc.includes((await buildTokenReport()).trim()), 'docs/token-comparison.md is out of date: run npm run bench:tokens');
  // The whole file is generated: methodology and caveats included.
  assert.equal(doc, renderComparisonDoc(await buildTokenReport()), 'docs/token-comparison.md differs from the generator: run npm run bench:tokens');
  for (const s of ['o200k_base', 'C2a', 'C2b', 'D-25', 'docs/adr/0001']) assert.ok(doc.includes(s), s);
});

// Spec 9.1: the caveats go in the README and in docs/token-comparison.md.
const CAVEATS: [string, RegExp][] = [
  ['other models tokenize differently', /Outros modelos tokenizam diferente/],
  ['providers reformat the definitions', /provedores (também )?reformatam as definições/],
  ['the cost of mirror mistakes is not measured, except C2b', /não\*{0,2} entra na medição/],
  ['field helpers (D-25), with the cost of the Zod default in ADR 0001', /D-25[^\n]*docs\/adr\/0001|docs\/adr\/0001[^\n]*D-25/],
];

test('the README and docs/token-comparison.md carry the four caveats of spec 9.1', () => {
  for (const file of ['README.md', 'docs/token-comparison.md']) {
    const text = readRepoFile(file);
    for (const [caveat, pattern] of CAVEATS) assert.match(text, pattern, `${file}: ${caveat}`);
  }
});

test('the scenarios follow spec 9.1: C2a limits both sides to 10, C2b drops lim, C3 resolves before writing', () => {
  const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
  assert.deepEqual([...byId.keys()], ['C1', 'C2a', 'C2b', 'C3']);
  const c2a = byId.get('C2a')!;
  assert.equal((c2a.mirror[0]!.args as Record<string, unknown>).lim, 10);
  assert.ok(!('limit' in (c2a.business![0]!.args as Record<string, unknown>)), 'searchCustomers uses its default page of 10');
  const c2b = byId.get('C2b')!;
  assert.ok(!('lim' in (c2b.mirror[0]!.args as Record<string, unknown>)));
  assert.equal(c2b.business, null);
  assert.deepEqual(byId.get('C3')!.mirror.map((s) => s.tool), ['getV1Customers', 'putV1CustomersById']);
  assert.deepEqual(byId.get('C3')!.business!.map((s) => s.tool), ['getCustomer', 'deactivateCustomer']);
});

test('relativeDifference rounds to the nearest percent and names the direction', () => {
  assert.equal(relativeDifference(956, 859), '11% mais');
  assert.equal(relativeDifference(1116, 1000), '12% mais');
  assert.equal(relativeDifference(884, 1000), '12% menos');
  assert.equal(relativeDifference(5, 5), 'o mesmo número de');
});

test('[BEN-02] npm run bench:tokens rewrites the README block and the whole docs/token-comparison.md', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'slm-bench-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = { readme: join(dir, 'README.md'), doc: join(dir, 'token-comparison.md') };
  writeFileSync(paths.readme, 'intro\n<!-- token-table:start -->\nold\n<!-- token-table:end -->\noutro\n');
  writeFileSync(paths.doc, 'stale');
  const report = 'Tokenizador: x\n\n| a | b |\n';
  writeBenchOutputs(report, paths);
  assert.equal(readFileSync(paths.readme, 'utf8'), `intro\n<!-- token-table:start -->\n${report.trim()}\n<!-- token-table:end -->\noutro\n`);
  assert.equal(readFileSync(paths.doc, 'utf8'), renderComparisonDoc(report));
});

test('[BEN-01] the bench CLI without --write prints the report and changes no file', async () => {
  const cli = fileURLToPath(new URL('../../scripts/bench/measure-tool-tokens.ts', import.meta.url));
  const before = [readRepoFile('README.md'), readRepoFile('docs/token-comparison.md')];
  const r = await promisify(execFile)(process.execPath, [cli], { env: { PATH: process.env.PATH!, NODE_OPTIONS: guardNodeOptions() }, timeout: 60_000 });
  assert.equal(r.stdout, await buildTokenReport());
  assert.deepEqual([readRepoFile('README.md'), readRepoFile('docs/token-comparison.md')], before);
});
