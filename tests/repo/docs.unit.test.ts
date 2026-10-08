import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listRepoFiles, PROJECT_ROOT, readRepoFile } from '../support/repo-files.ts';

const files = listRepoFiles();

// Spec 10.1: the title with the English summary, then 15 sections in this order.
const README_SECTIONS = [
  'Em 30 segundos',
  'Rode agora',
  'Segurança',
  'Ações de negócio, não endpoints',
  'Arquitetura',
  'Custo em tokens',
  'Usar com VS Code, Cursor, Claude Desktop e Inspector',
  'Pacote `npx`',
  'Agente LangChain (extra opcional)',
  'Testes',
  'Processo',
  'O que mudei em relação à aula',
  'Aulas do curso aplicadas',
  'Limitações honestas',
  'Licença',
];

test('the README has the 16 sections of spec 10.1, in order', () => {
  const readme = readRepoFile('README.md');
  assert.match(readme, /^# secure-legacy-mcp\n\n> \*\*English summary:\*\*/);
  const sections = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sections, README_SECTIONS);
});

test('ADRs 0001 to 0006 have Status, Contexto, Decisão, Consequências and Alternativas, in at most 40 lines', () => {
  const adrs = files.filter((f) => /^docs\/adr\/\d{4}-[^/]+\.md$/.test(f));
  assert.deepEqual(adrs.map((f) => f.slice('docs/adr/'.length, 'docs/adr/'.length + 4)), ['0001', '0002', '0003', '0004', '0005', '0006']);
  for (const f of adrs) {
    const text = readRepoFile(f);
    assert.ok(text.split('\n').length <= 40, `${f} is longer than 40 lines`);
    assert.match(text, /^- \*\*Status:\*\* \S/m, f);
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ['Contexto', 'Decisão', 'Consequências', 'Alternativas'], f);
  }
});

test('every test file cited in docs/security.md and in the specs exists', () => {
  const citing = ['docs/security.md', ...files.filter((f) => /^specs\/\d{3}-[^/]+\/spec\.md$/.test(f))];
  const cited = new Set(citing.flatMap((f) => [...readRepoFile(f).matchAll(/tests\/[\w./-]+?\.(?:test|live)\.ts/g)].map((m) => m[0])));
  assert.ok(cited.size >= 20, 'the citations were not found');
  assert.deepEqual([...cited].filter((p) => !existsSync(join(PROJECT_ROOT, p))), []);
  assert.ok(existsSync(join(PROJECT_ROOT, 'docs/incidents/README.md')));
});
