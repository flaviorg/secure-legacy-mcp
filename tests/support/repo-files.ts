// Repository listing and pure source scanners used by tests/repo/conventions.unit.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'data', 'coverage']);
const TEXT_EXTENSIONS = ['.ts', '.js', '.json', '.md', '.yml', '.yaml'];
const TEXT_NAMES = new Set(['.env.example', '.npmrc', '.nvmrc', '.gitignore', 'LICENSE']);

function isTextFile(rel: string, name: string): boolean {
  if (name.endsWith('.tgz')) return false;
  if (rel.startsWith('.githooks/')) return true;
  return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// Relative POSIX paths of the text files that would be versioned, sorted.
export function listRepoFiles(): string[] {
  const found: string[] = [];
  const visit = (relDir: string) => {
    for (const entry of readdirSync(join(PROJECT_ROOT, relDir), { withFileTypes: true })) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(rel);
      } else if (entry.isFile() && isTextFile(rel, entry.name)) {
        found.push(rel);
      }
    }
  };
  visit('');
  return found.sort();
}

export function readRepoFile(rel: string): string {
  return readFileSync(join(PROJECT_ROOT, rel), 'utf8');
}

// Static `import ... from 'x'` / `export ... from 'x'`, side-effect `import 'x'`
// and dynamic `import('x')`, in source order.
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;

export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map((m) => m[2]!);
}

const STDOUT_WRITE = /\bconsole\.(?:log|info|debug)\s*\(|\bprocess\.stdout\.write\b/;

// 1-based line numbers that write to stdout.
export function stdoutWriteLines(source: string): number[] {
  return source.split('\n').flatMap((line, i) => (STDOUT_WRITE.test(line) ? [i + 1] : []));
}

// Resolves a relative specifier against the importing file; result is relative to the root.
export function resolveImport(fromRel: string, specifier: string): string {
  if (!specifier.startsWith('.')) throw new Error(`resolveImport only handles relative specifiers: ${specifier}`);
  return posix.normalize(posix.join(posix.dirname(fromRel), specifier));
}
