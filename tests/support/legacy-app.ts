// In-process legacy API for the `int` tests: fresh :memory: database with the seed,
// Fastify app driven by app.inject (no port), and one admin and one member token
// issued in the same database with the same clock.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp, DEFAULT_LIMITS } from '../../src/legacy-api/app.ts';
import type { Limits } from '../../src/legacy-api/app.ts';
import { createTokenStore } from '../../src/legacy-api/auth/token-store.ts';
import { openDatabase } from '../../src/legacy-api/db/database.ts';
import { seedIfEmpty } from '../../src/legacy-api/db/seed.ts';
import { systemClock } from '../../src/shared/clock.ts';
import type { Clock } from '../../src/shared/clock.ts';

export type LegacyTestApp = {
  app: FastifyInstance;
  db: DatabaseSync;
  adminHeaders: Record<string, string>;
  memberHeaders: Record<string, string>;
};

export async function createLegacyTestApp(opts: { clock?: Clock; limits?: Partial<Limits>; logger?: boolean | object } = {}): Promise<LegacyTestApp> {
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(':memory:');
  seedIfEmpty(db);
  const app = await buildApp({
    db,
    clock,
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    logger: opts.logger ?? false,
  });
  const tokens = createTokenStore(db, clock);
  const bearer = (role: 'admin' | 'member') => ({ authorization: `Bearer ${tokens.issue({ name: `test-${role}`, role }).token}` });
  return { app, db, adminHeaders: bearer('admin'), memberHeaders: bearer('member') };
}
