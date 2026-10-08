// In-memory CustomerGateway for the service unit tests. Filters, sorts and pages like
// the legacy API, and records every call so tests can assert what reached "upstream".
import { normalizeName } from '../../src/legacy-api/db/normalize.ts';
import type { Customer } from '../../src/mcp/domain/customer.ts';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import type { Caller, CustomerFilter, CustomerGateway } from '../../src/mcp/domain/ports.ts';

export type GatewayCall = { method: keyof CustomerGateway; args: unknown[] };

const DEFAULT_CALLER: Caller = { tokenId: 'test0001', name: 'test-admin', role: 'admin' };
const CREATED_AT = '2026-10-04';

function matches(c: Customer, f: CustomerFilter): boolean {
  if (f.nameContains !== undefined && !normalizeName(c.name).includes(normalizeName(f.nameContains))) return false;
  if (f.email !== undefined && c.email.toLowerCase() !== f.email.toLowerCase()) return false;
  if (f.phoneDigits !== undefined && c.phone.slice(3) !== f.phoneDigits) return false;
  if (f.status !== undefined && c.status !== f.status) return false;
  if (f.segment !== undefined && c.segment !== f.segment) return false;
  if (f.createdFrom !== undefined && c.createdAt < f.createdFrom) return false;
  if (f.createdTo !== undefined && c.createdAt > f.createdTo) return false;
  return true;
}

const byNameThenId = (a: Customer, b: Customer) => {
  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  return na < nb ? -1 : na > nb ? 1 : a.id - b.id;
};

export function createInMemoryGateway(
  customers: Customer[],
  opts: { caller?: Caller; whoamiError?: DomainError } = {},
): CustomerGateway & { calls: GatewayCall[] } {
  const rows = new Map(customers.map((c) => [c.id, { ...c }]));
  const calls: GatewayCall[] = [];
  const record = (method: keyof CustomerGateway, args: unknown[]) => { calls.push({ method, args: structuredClone(args) }); };
  const emailTaken = (email: string, exceptId?: number) =>
    [...rows.values()].some((c) => c.id !== exceptId && c.email.toLowerCase() === email.toLowerCase());

  return {
    calls,
    async getById(id, ctx) {
      record('getById', [id, ctx]);
      const row = rows.get(id);
      return row === undefined ? null : { ...row };
    },
    async search(filter, page, ctx) {
      record('search', [filter, page, ctx]);
      const found = [...rows.values()].filter((c) => matches(c, filter)).sort(byNameThenId);
      return { items: found.slice(page.offset, page.offset + page.limit).map((c) => ({ ...c })), total: found.length };
    },
    async create(input, ctx) {
      record('create', [input, ctx]);
      if (emailTaken(input.email)) throw new DomainError('CONFLICT', { upstreamStatus: 409 });
      const id = Math.max(0, ...rows.keys()) + 1;
      rows.set(id, { id, ...input, email: input.email.toLowerCase(), status: 'active', createdAt: CREATED_AT });
      return { id };
    },
    async replace(id, data, ctx) {
      record('replace', [id, data, ctx]);
      const row = rows.get(id);
      if (row === undefined) throw new DomainError('NOT_FOUND', { id, upstreamStatus: 404 });
      if (emailTaken(data.email, id)) throw new DomainError('CONFLICT', { upstreamStatus: 409 });
      rows.set(id, { ...row, ...data, email: data.email.toLowerCase() });
    },
    async whoami(ctx) {
      record('whoami', [ctx]);
      if (opts.whoamiError) throw opts.whoamiError;
      return { ...(opts.caller ?? DEFAULT_CALLER) };
    },
  };
}
