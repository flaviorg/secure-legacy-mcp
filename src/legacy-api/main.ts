// Entrypoint of the legacy API: `npm run api`.
import { mkdirSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigError } from '../shared/config-error.ts';
import { systemClock } from '../shared/clock.ts';
import { buildApp } from './app.ts';
import { loadApiConfig } from './config.ts';
import type { ApiConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { seedIfEmpty } from './db/seed.ts';

// Expected startup failures end with a short message and code 1, never a stack trace.
// The write is synchronous: on macOS, process.exit can cut an async write to a pipe.
function fail(text: string): never {
  writeSync(2, `${text}\n`);
  process.exit(1);
}

let config: ApiConfig;
try {
  config = loadApiConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  fail(`${err.message}\n${err.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
}

if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
const db = openDatabase(config.databasePath);
seedIfEmpty(db);

const app = await buildApp({ db, clock: systemClock, limits: config.limits, logger: { level: config.logLevel } });

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  db.close();
  fail(`porta ${config.port} em uso em ${config.host}; escolha outra com PORT`);
}
