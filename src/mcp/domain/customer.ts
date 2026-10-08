// Domain schemas of the MCP server (spec 5.3). Text facing the model is in English.
import { z } from 'zod';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// True only for a real calendar date in YYYY-MM-DD (2024-02-29 yes, 2023-02-29 no).
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (m === null) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

// Brazilian phone in any common format -> E.164 (+55 + area code + number), or null.
// Drops non-digits; a leading country code 55 is removed when 12 or 13 digits remain.
export function normalizePhoneInput(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  return digits.length === 10 || digits.length === 11 ? `+55${digits}` : null;
}

// Fields with a short pattern in JSON Schema (D-25). Strong validation stays on the server.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailField = () => z.email({ pattern: EMAIL_PATTERN });
// Control characters (C0, DEL, C1) and bidirectional formatting characters (ALM, LRM,
// RLM, LRE to RLO, LRI to PDI): invisible in most interfaces, they would let an agent
// store or search a name that reads differently from what it is (MCP-18).
const UNSAFE_NAME_CHAR = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// Name input: ends trimmed before the length check, so a blank name is too short. The
// character rule is a refine, which stays out of the JSON Schema the model reads (D-25).
const nameField = (max: number) =>
  z.string().trim().min(2).max(max)
    .refine((v) => !UNSAFE_NAME_CHAR.test(v), { message: 'Must not contain control or bidirectional formatting characters' });
export const isoDateField = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate, { message: 'Invalid calendar date' })
    .describe('Date, YYYY-MM-DD');

const customerStatusSchema = z.enum(['active', 'inactive']).describe('Customer lifecycle status');
const customerSegmentSchema = z.enum(['retail', 'smb', 'enterprise']).describe('Commercial segment');
export type CustomerStatus = z.infer<typeof customerStatusSchema>;
export type CustomerSegment = z.infer<typeof customerSegmentSchema>;

// Output shape: a customer as the legacy API stores it. The legacy API checks only that
// name and email are not empty, so name, email and date carry no input rules here: a
// row inside the legacy contract is returned as stored, never refused (MCP-15). The
// strict rules live in the input schemas below.
export const customerSchema = z.object({
  id: z.number().int().positive().describe('Customer id'),
  name: z.string().describe('Full name or company name'),
  email: z.string().describe('Unique email, lowercase'),
  phone: z.string().regex(/^\+55\d{10,11}$/).describe('Brazilian phone in E.164, e.g. +5511987650012'),
  status: customerStatusSchema,
  segment: customerSegmentSchema,
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Registration date, YYYY-MM-DD'),
});
export type Customer = z.infer<typeof customerSchema>;
export type CustomerWritable = Omit<Customer, 'id' | 'createdAt'>;
export type NewCustomer = Omit<CustomerWritable, 'status'>;

const customerSummarySchema = customerSchema.pick({ id: true, name: true, email: true, status: true, segment: true });
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

const phoneInput = z.string().min(8).max(25).describe('Phone in any common format; digits are extracted');

export const getCustomerInput = z.object({
  id: z.number().int().positive().optional().describe('Exact customer id'),
  email: emailField().optional().describe('Exact email'),
  phone: phoneInput.optional(),
  name: nameField(120).optional().describe('Name or part of it; accents and case are ignored'),
}).refine((v) => [v.id, v.email, v.phone, v.name].some((x) => x !== undefined), { message: 'Provide at least one of id, email, phone or name' });

export const getCustomerOutput = z.object({
  match: z.enum(['found', 'ambiguous', 'none']).describe('found = exactly one customer; ambiguous = see candidates; none = no customer'),
  customer: customerSchema.nullable(),
  candidates: z.array(customerSummarySchema).max(5).describe('Filled only when match is ambiguous'),
});

export const searchCustomersInput = z.object({
  nameContains: nameField(60).optional(),
  status: customerStatusSchema.optional(),
  segment: customerSegmentSchema.optional(),
  createdFrom: isoDateField().optional(),
  createdTo: isoDateField().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().max(64).optional().describe('Opaque cursor from a previous nextCursor'),
}).refine((v) => !(v.createdFrom && v.createdTo) || v.createdFrom <= v.createdTo, { message: 'createdFrom must be <= createdTo' });

export const searchCustomersOutput = z.object({
  items: z.array(customerSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const createCustomerInput = z.object({
  name: nameField(120),
  email: emailField(),
  phone: phoneInput,
  segment: customerSegmentSchema,
});
export const createCustomerOutput = z.object({ customer: customerSchema });

export const updateContactInput = z.object({
  id: z.number().int().positive(),
  email: emailField().optional(),
  phone: phoneInput.optional(),
}).refine((v) => v.email !== undefined || v.phone !== undefined, { message: 'Provide email and/or phone' });
export const updateContactOutput = z.object({
  customer: customerSchema,
  changed: z.array(z.enum(['email', 'phone'])).describe('Empty when nothing changed (idempotent)'),
});

export const deactivateInput = z.object({ id: z.number().int().positive() });
export const deactivateOutput = z.object({ customer: customerSchema, alreadyInactive: z.boolean() });

export type GetCustomerInput = z.infer<typeof getCustomerInput>;
export type GetCustomerOutput = z.infer<typeof getCustomerOutput>;
export type SearchCustomersInput = z.infer<typeof searchCustomersInput>;
export type SearchCustomersOutput = z.infer<typeof searchCustomersOutput>;
export type CreateCustomerInput = z.infer<typeof createCustomerInput>;
export type CreateCustomerOutput = z.infer<typeof createCustomerOutput>;
export type UpdateContactInput = z.infer<typeof updateContactInput>;
export type UpdateContactOutput = z.infer<typeof updateContactOutput>;
export type DeactivateInput = z.infer<typeof deactivateInput>;
export type DeactivateOutput = z.infer<typeof deactivateOutput>;
