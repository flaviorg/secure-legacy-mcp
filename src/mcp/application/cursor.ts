// Opaque pagination cursor of searchCustomers (spec 5.4, MCP-16):
// base64url(JSON.stringify({ o: offset, h: filterHash })). The hash ties the cursor to
// the filters it was issued for. It is not signed: it prevents accidental reuse with
// other filters, it is not access control (any offset is reachable by the search itself).
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain/errors.ts';
import type { CustomerFilter } from '../domain/ports.ts';

const MISMATCH = 'cursor does not match the current filters';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const payloadSchema = z.object({ o: z.number().int().nonnegative(), h: z.string().regex(/^[0-9a-f]{8}$/) });

// Present filter fields, keys in alphabetical order, nameContains trimmed and lower case.
function filterHash(filter: CustomerFilter): string {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(filter).sort() as (keyof CustomerFilter)[]) {
    const value = filter[key];
    if (value === undefined) continue;
    normalized[key] = key === 'nameContains' ? value.trim().toLowerCase() : value;
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 8);
}

export function encodeCursor(offset: number, filter: CustomerFilter): string {
  return Buffer.from(JSON.stringify({ o: offset, h: filterHash(filter) })).toString('base64url');
}

export function decodeCursor(cursor: string, filter: CustomerFilter): { offset: number } {
  const fail = (cause?: unknown) => new DomainError('INVALID_INPUT', { rule: MISMATCH }, { cause });
  if (!BASE64URL.test(cursor)) throw fail();
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (err) {
    throw fail(err);
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) throw fail(parsed.error);
  if (parsed.data.h !== filterHash(filter)) throw fail();
  return { offset: parsed.data.o };
}
