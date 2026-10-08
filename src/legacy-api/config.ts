import { z } from 'zod';
import { ConfigError } from '../shared/config-error.ts';
import type { ConfigIssue } from '../shared/config-error.ts';
import type { ConfigLevel } from '../shared/logger.ts';
import type { Limits } from './app.ts';

export type ApiConfig = { port: number; host: string; databasePath: string; limits: Limits; logLevel: ConfigLevel };

// The API variables of the environment contract (spec 5.8).
export const API_ENV_KEYS = ['PORT', 'HOST', 'DATABASE_PATH', 'RATE_LIMIT_PER_TOKEN', 'RATE_LIMIT_PER_IP', 'RATE_LIMIT_WINDOW_MS', 'LOG_LEVEL'] as const;

const integer = (min: number, max: number, fallback: number) =>
  z.string()
    .regex(/^\d+$/, { error: 'Expected an integer' })
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(fallback);

const schema = z.object({
  PORT: integer(1, 65535, 9999),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).default('./data/legacy.db'),
  RATE_LIMIT_PER_TOKEN: integer(1, Number.MAX_SAFE_INTEGER, 90),
  RATE_LIMIT_PER_IP: integer(1, Number.MAX_SAFE_INTEGER, 180),
  RATE_LIMIT_WINDOW_MS: integer(1000, Number.MAX_SAFE_INTEGER, 60_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// Reads only the API keys; an empty value counts as unset. Throws ConfigError with
// one issue per invalid variable, built from Zod messages that never include the input.
export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const input = Object.fromEntries(API_ENV_KEYS.map((key) => [key, env[key] === '' ? undefined : env[key]]));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = new Map<string, ConfigIssue>();
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0] ?? '(root)');
      if (!issues.has(path)) issues.set(path, { path, message: issue.message });
    }
    throw new ConfigError([...issues.values()]);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    host: e.HOST,
    databasePath: e.DATABASE_PATH,
    limits: { perToken: e.RATE_LIMIT_PER_TOKEN, perIp: e.RATE_LIMIT_PER_IP, windowMs: e.RATE_LIMIT_WINDOW_MS },
    logLevel: e.LOG_LEVEL,
  };
}
