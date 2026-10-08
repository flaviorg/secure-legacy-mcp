// Legacy API inside the current process, on an ephemeral port of 127.0.0.1. Used by
// the demo, the token meter, verify-pack and the test harnesses.
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { systemClock } from '../shared/clock.ts';
import type { Clock } from '../shared/clock.ts';
import { buildApp, DEFAULT_LIMITS } from './app.ts';
import type { Limits } from './app.ts';
import { createTokenStore } from './auth/token-store.ts';
import type { TokenStore } from './auth/token-store.ts';
import { openDatabase } from './db/database.ts';
import { seedIfEmpty } from './db/seed.ts';

export type RunningApi = { url: string; db: DatabaseSync; tokens: TokenStore; close(): Promise<void> };

export async function startLegacyApi(opts: {
  databasePath?: string;                         // default ':memory:'
  limits?: Partial<Limits>;
  clock?: Clock;
  beforeListen?: (app: FastifyInstance) => void; // lets a harness register extra hooks
} = {}): Promise<RunningApi> {
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(opts.databasePath ?? ':memory:');
  let app: FastifyInstance | undefined;
  try {
    seedIfEmpty(db);
    app = await buildApp({ db, clock, limits: { ...DEFAULT_LIMITS, ...opts.limits }, logger: false });
    opts.beforeListen?.(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
  } catch (err) {
    await app?.close();
    db.close();
    throw err;
  }
  const { port } = app.server.address() as AddressInfo;
  const running = app;
  let closed: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    tokens: createTokenStore(db, clock),
    close() {
      closed ??= running.close().then(() => db.close());
      return closed;
    },
  };
}
