// Business rules of the MCP server (spec 4.4 and 5.4). Knows only the CustomerGateway
// port; never HTTP. Read path: multi-criteria resolution, search with a cursor and
// the caller description. Write path: normalize, read the current customer, write
// only when something changes (idempotent) and re-read to return the full object.
import { normalizePhoneInput } from '../domain/customer.ts';
import type {
  CreateCustomerInput, CreateCustomerOutput, Customer, CustomerSummary, CustomerWritable, DeactivateInput, DeactivateOutput,
  GetCustomerInput, GetCustomerOutput, SearchCustomersInput, SearchCustomersOutput, UpdateContactInput, UpdateContactOutput,
} from '../domain/customer.ts';
import { DomainError } from '../domain/errors.ts';
import type { CallContext, Caller, CustomerFilter, CustomerGateway } from '../domain/ports.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

const RESOLVE_PAGE = { limit: 6, offset: 0 } as const; // 6 tells "more than 5" apart
const MAX_CANDIDATES = 5;
const INVALID_PHONE = 'phone must have 10 or 11 digits (area code + number)';

// Same folding as the legacy search: no accents (composed or decomposed), lower case,
// single spaces.
const foldName = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Phone in any common format -> E.164 (+55 + area code + number), or INVALID_INPUT.
function e164Of(phone: string): string {
  const e164 = normalizePhoneInput(phone);
  if (e164 === null) throw new DomainError('INVALID_INPUT', { rule: INVALID_PHONE });
  return e164;
}

// Phone in any common format -> legacy digits (area code + number), or INVALID_INPUT.
const phoneDigitsOf = (phone: string): string => e164Of(phone).slice(3);

const writableOf = ({ name, email, phone, status, segment }: Customer): CustomerWritable => ({ name, email, phone, status, segment });

// Keeps only the keys that are set, so the gateway never sees `undefined` filters.
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const toSummary = ({ id, name, email, status, segment }: Customer): CustomerSummary => ({ id, name, email, status, segment });

const none = (): GetCustomerOutput => ({ match: 'none', customer: null, candidates: [] });
const found = (customer: Customer): GetCustomerOutput => ({ match: 'found', customer, candidates: [] });

export function createCustomerService(deps: { gateway: CustomerGateway }) {
  const { gateway } = deps;

  // The current customer, or NOT_FOUND with the id (update and deactivate).
  async function existing(id: number, ctx: CallContext): Promise<Customer> {
    const customer = await gateway.getById(id, ctx);
    if (customer === null) throw new DomainError('NOT_FOUND', { id });
    return customer;
  }

  // Re-read after a write the API accepted. If the read fails, the write still
  // happened: READBACK_FAILED (not retryable) says so, instead of an upstream error
  // that would invite a retry (a repeated create would hit CONFLICT). MCP-17.
  async function readBack(id: number, ctx: CallContext): Promise<Customer | null> {
    try {
      return await gateway.getById(id, ctx);
    } catch (err) {
      const upstreamStatus = err instanceof DomainError ? err.details.upstreamStatus : undefined;
      throw new DomainError('READBACK_FAILED', { id, upstreamStatus }, { cause: err });
    }
  }

  async function readBackExisting(id: number, ctx: CallContext): Promise<Customer> {
    const customer = await readBack(id, ctx);
    if (customer === null) throw new DomainError('NOT_FOUND', { id });
    return customer;
  }

  return {
    // With id: one GET by id, then every other criterion must agree (else none).
    // Without id: a single search with all criteria; 1 = found, 0 = none, more =
    // ambiguous with up to 5 candidates. Never picks one of several homonyms.
    async getCustomer(input: GetCustomerInput, ctx: CallContext): Promise<GetCustomerOutput> {
      const email = input.email?.toLowerCase();
      const phoneDigits = input.phone === undefined ? undefined : phoneDigitsOf(input.phone);
      const name = input.name;

      if (input.id !== undefined) {
        const customer = await gateway.getById(input.id, ctx);
        if (customer === null) return none();
        if (email !== undefined && customer.email !== email) return none();
        if (phoneDigits !== undefined && customer.phone.slice(3) !== phoneDigits) return none();
        if (name !== undefined && !foldName(customer.name).includes(foldName(name))) return none();
        return found(customer);
      }

      const filter: CustomerFilter = definedOnly({ nameContains: name, email, phoneDigits });
      const { items } = await gateway.search(filter, { ...RESOLVE_PAGE }, ctx);
      if (items.length === 0) return none();
      if (items.length === 1) return found(items[0]!);
      return { match: 'ambiguous', customer: null, candidates: items.slice(0, MAX_CANDIDATES).map(toSummary) };
    },

    // One listing per page; the cursor carries only the offset and is tied to the
    // filters (spec 5.4). nextCursor is null when there is nothing left.
    async searchCustomers(input: SearchCustomersInput, ctx: CallContext): Promise<SearchCustomersOutput> {
      const filter: CustomerFilter = definedOnly({
        nameContains: input.nameContains,
        status: input.status,
        segment: input.segment,
        createdFrom: input.createdFrom,
        createdTo: input.createdTo,
      });
      const offset = input.cursor === undefined ? 0 : decodeCursor(input.cursor, filter).offset;
      const { items, total } = await gateway.search(filter, { limit: input.limit, offset }, ctx);
      const nextOffset = offset + items.length;
      const nextCursor = items.length === 0 || nextOffset >= total ? null : encodeCursor(nextOffset, filter);
      return { items: items.map(toSummary), total, nextCursor };
    },

    // POST, then GET by the new id: the legacy API only returns the id. No retry
    // (writes never are); 409 arrives from the gateway as CONFLICT.
    async createCustomer(input: CreateCustomerInput, ctx: CallContext): Promise<CreateCustomerOutput> {
      const phone = e164Of(input.phone);
      const { id } = await gateway.create({ name: input.name, email: input.email.toLowerCase(), phone, segment: input.segment }, ctx);
      const customer = await readBack(id, ctx);
      if (customer === null) throw new DomainError('UPSTREAM_CONTRACT');
      return { customer };
    },

    // Compares email without case and phone in E.164; equal values send no PUT
    // (changed: []). Otherwise the full current object plus the changes, then re-read.
    async updateContact(input: UpdateContactInput, ctx: CallContext): Promise<UpdateContactOutput> {
      const email = input.email?.toLowerCase();
      const phone = input.phone === undefined ? undefined : e164Of(input.phone);
      const current = await existing(input.id, ctx);
      const changed: UpdateContactOutput['changed'] = [];
      if (email !== undefined && email !== current.email) changed.push('email');
      if (phone !== undefined && phone !== current.phone) changed.push('phone');
      if (changed.length === 0) return { customer: current, changed };
      await gateway.replace(input.id, { ...writableOf(current), email: email ?? current.email, phone: phone ?? current.phone }, ctx);
      return { customer: await readBackExisting(input.id, ctx), changed };
    },

    // An inactive customer stays as is (alreadyInactive: true, no PUT). Otherwise the
    // full object with status inactive, then re-read. There is no reactivation.
    async deactivate(input: DeactivateInput, ctx: CallContext): Promise<DeactivateOutput> {
      const current = await existing(input.id, ctx);
      if (current.status === 'inactive') return { customer: current, alreadyInactive: true };
      await gateway.replace(input.id, { ...writableOf(current), status: 'inactive' }, ctx);
      return { customer: await readBackExisting(input.id, ctx), alreadyInactive: false };
    },

    // The current token, or null when the API cannot tell (down, revoked, ...).
    async describeCaller(ctx: CallContext): Promise<Caller | null> {
      try {
        return await gateway.whoami(ctx);
      } catch (err) {
        if (err instanceof DomainError) return null;
        throw err;
      }
    },
  };
}

export type CustomerService = ReturnType<typeof createCustomerService>;
