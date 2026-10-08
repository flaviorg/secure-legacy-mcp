// Legacy <-> domain translation (spec 5.1, "De-para"). Anything outside the legacy
// contract is UPSTREAM_CONTRACT. Every row inside it maps to a valid customer, even
// with a name or email that the input rules would refuse (MCP-15).
import type { z } from 'zod';
import { customerSchema } from '../domain/customer.ts';
import type { Customer, CustomerSegment, CustomerStatus, CustomerWritable } from '../domain/customer.ts';
import { DomainError } from '../domain/errors.ts';
import type { Caller, CustomerFilter } from '../domain/ports.ts';
import { legacyCustomerSchema, legacyListSchema, legacyMutationSchema, legacyWhoamiSchema } from './legacy-schemas.ts';
import type { LegacyCustomer, LegacyWritable } from './legacy-schemas.ts';

const STATUS_FROM_LEGACY = { A: 'active', I: 'inactive' } as const satisfies Record<'A' | 'I', CustomerStatus>;
const STATUS_TO_LEGACY = { active: 'A', inactive: 'I' } as const satisfies Record<CustomerStatus, 'A' | 'I'>;
const SEGMENT_FROM_LEGACY = { 1: 'retail', 2: 'smb', 3: 'enterprise' } as const satisfies Record<1 | 2 | 3, CustomerSegment>;
const SEGMENT_TO_LEGACY = { retail: 1, smb: 2, enterprise: 3 } as const satisfies Record<CustomerSegment, 1 | 2 | 3>;

function parseOrContract<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new DomainError('UPSTREAM_CONTRACT', {}, { cause: parsed.error });
  return parsed.data;
}

// "20240115" -> "2024-01-15" and back.
const fromLegacyDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const toLegacyDate = (d: string) => d.replaceAll('-', '');

// E.164 (+55...) -> legacy digits: drop non-digits and a leading 55 when 12 or 13 digits remain.
function toLegacyPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits;
}

function mapCustomer(row: LegacyCustomer): Customer {
  return parseOrContract(customerSchema, {
    id: row.cst_id,
    name: row.cst_nm,
    email: row.cst_eml.toLowerCase(),
    phone: `+55${row.cst_phn}`,
    status: STATUS_FROM_LEGACY[row.cst_sts],
    segment: SEGMENT_FROM_LEGACY[row.cst_seg],
    createdAt: fromLegacyDate(row.dt_cad),
  });
}

export function toCustomer(raw: unknown): Customer {
  return mapCustomer(parseOrContract(legacyCustomerSchema, raw));
}

export function toCustomerList(raw: unknown): { total: number; items: Customer[] } {
  const list = parseOrContract(legacyListSchema, raw);
  return { total: list.qtd, items: list.dados.map(mapCustomer) };
}

export function toMutationId(raw: unknown): number {
  return parseOrContract(legacyMutationSchema, raw).id;
}

export function toCaller(raw: unknown): Caller {
  const { tokenId, name, role } = parseOrContract(legacyWhoamiSchema, raw);
  return { tokenId, name, role };
}

// Full object for PUT /v1/customers/:id. Never carries cst_id (MCP-07).
export function toLegacyWritable(c: CustomerWritable): LegacyWritable {
  return {
    cst_nm: c.name,
    cst_phn: toLegacyPhone(c.phone),
    cst_eml: c.email.toLowerCase(),
    cst_sts: STATUS_TO_LEGACY[c.status],
    cst_seg: SEGMENT_TO_LEGACY[c.segment],
  };
}

// Query parameters of GET /v1/customers, only for the filters that are set.
export function toLegacyQuery(filter: CustomerFilter): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter.nameContains !== undefined) query.nm = filter.nameContains;
  if (filter.email !== undefined) query.eml = filter.email;
  if (filter.phoneDigits !== undefined) query.phn = filter.phoneDigits;
  if (filter.status !== undefined) query.sts = STATUS_TO_LEGACY[filter.status];
  if (filter.segment !== undefined) query.seg = String(SEGMENT_TO_LEGACY[filter.segment]);
  if (filter.createdFrom !== undefined) query.dt_de = toLegacyDate(filter.createdFrom);
  if (filter.createdTo !== undefined) query.dt_ate = toLegacyDate(filter.createdTo);
  return query;
}
