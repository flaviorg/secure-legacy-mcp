import { maskTokens } from './token-pattern.ts';

export const REDACTED = '[REDACTED]';

const TRUNCATED = '[Truncated]';
const MAX_DEPTH = 8;
const SENSITIVE_KEYS = new Set(['token', 'authorization', 'servicetoken', 'service_token']);

function walk(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return maskTokens(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value instanceof Error) {
    return { name: maskTokens(value.name), message: maskTokens(value.message), stack: value.stack === undefined ? undefined : maskTokens(value.stack) };
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') return walk(toJSON.call(value), depth);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : walk(item, depth + 1);
  }
  return out;
}

// Returns a copy safe to log: sensitive field names become [REDACTED] at any depth,
// token-shaped substrings become `slm_<id>_***`, and Errors become plain objects.
export function redact(value: unknown): unknown {
  return walk(value, 1);
}
