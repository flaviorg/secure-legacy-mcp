import { fileURLToPath, pathToFileURL } from 'node:url';

// NODE_OPTIONS value that loads the network guard in a child process.
// The project path contains a space, so the guard is passed as an absolute
// file:// URL (spaces percent-encoded), never as a raw path (spec 6.2, item 9).
const GUARD_PATH = fileURLToPath(new URL('./no-network.ts', import.meta.url));

export function guardNodeOptions(): string {
  return `--import ${pathToFileURL(GUARD_PATH).href}`;
}
