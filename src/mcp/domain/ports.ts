// Port between the application and the legacy API (spec 4.4). Only the
// infrastructure implements it; the service knows nothing about HTTP.
import type { Customer, CustomerSegment, CustomerStatus, CustomerWritable, NewCustomer } from './customer.ts';

export type CallContext = { requestId: string };

export type CustomerFilter = {
  nameContains?: string;
  email?: string;
  phoneDigits?: string; // legacy format: area code + number, digits only
  status?: CustomerStatus;
  segment?: CustomerSegment;
  createdFrom?: string; // YYYY-MM-DD
  createdTo?: string;   // YYYY-MM-DD
};

export type Page = { limit: number; offset: number };

export type Caller = { tokenId: string; name: string; role: 'member' | 'admin' };

export interface CustomerGateway {
  getById(id: number, ctx: CallContext): Promise<Customer | null>;
  search(filter: CustomerFilter, page: Page, ctx: CallContext): Promise<{ items: Customer[]; total: number }>;
  create(input: NewCustomer, ctx: CallContext): Promise<{ id: number }>;
  replace(id: number, data: CustomerWritable, ctx: CallContext): Promise<void>;
  whoami(ctx: CallContext): Promise<Caller>;
}
