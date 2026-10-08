// CLI of the token comparison (spec 9.1): prints the report; with --write, also
// rewrites the README block and docs/token-comparison.md (npm run bench:tokens).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTokenReport, renderComparisonDoc, replaceBlock } from './token-report.ts';

const DEFAULT_PATHS = {
  readme: fileURLToPath(new URL('../../README.md', import.meta.url)),
  doc: fileURLToPath(new URL('../../docs/token-comparison.md', import.meta.url)),
};

// The --write step: the block between the README markers and the whole comparison doc.
export function writeBenchOutputs(report: string, paths: { readme: string; doc: string } = DEFAULT_PATHS): void {
  writeFileSync(paths.readme, replaceBlock(readFileSync(paths.readme, 'utf8'), report));
  writeFileSync(paths.doc, renderComparisonDoc(report));
}

if (import.meta.main) {
  const report = await buildTokenReport();
  process.stdout.write(report);
  if (process.argv.includes('--write')) {
    writeBenchOutputs(report);
    process.stdout.write('\ndocs/token-comparison.md and README.md updated.\n');
  }
}
