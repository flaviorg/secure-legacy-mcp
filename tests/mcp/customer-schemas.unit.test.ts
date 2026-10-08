import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  createCustomerInput, emailField, getCustomerInput, isCalendarDate, isoDateField, normalizePhoneInput, searchCustomersInput, updateContactInput,
} from '../../src/mcp/domain/customer.ts';
import { errorMessage } from '../../src/mcp/domain/errors.ts';
import type { ErrorCode, ErrorDetails } from '../../src/mcp/domain/errors.ts';

test('[D-25] isCalendarDate rejects impossible dates', () => {
  assert.deepEqual(['2024-02-29', '2023-02-29', '2024-02-30', '2024-13-01', '2024-1-01'].map(isCalendarDate), [true, false, false, false, false]);
});

test('[D-25] isCalendarDate follows the Gregorian century rule and the month lengths', () => {
  assert.deepEqual(['1900-02-29', '2100-02-29', '2000-02-29', '2400-02-29'].map(isCalendarDate), [false, false, true, true]);
  assert.deepEqual(['2024-04-31', '2024-06-30', '2024-12-31', '2024-00-10', '2024-05-00'].map(isCalendarDate), [false, true, true, false, false]);
});

test('normalizePhoneInput accepts common formats and rejects wrong digit counts', () => {
  for (const s of ['11 98765-0012', '(11) 98765-0012', '+55 11 98765-0012', '5511987650012']) assert.equal(normalizePhoneInput(s), '+5511987650012', s);
  assert.equal(normalizePhoneInput('11 3333-4444'), '+551133334444');
  for (const s of ['98765-0012', '123456789012345', 'abc']) assert.equal(normalizePhoneInput(s), null, s);
});

test('[D-25] email and date fields keep a short pattern in JSON Schema', () => {
  const js = z.toJSONSchema(z.object({ e: emailField(), d: isoDateField() }), { target: 'draft-7', io: 'input' }) as any;
  assert.equal(js.properties.e.format, 'email');
  assert.ok(JSON.stringify(js.properties.e).length < 100);
  assert.ok(JSON.stringify(js.properties.d).length < 100);
});

test('input schemas enforce the business rules', () => {
  assert.equal(getCustomerInput.safeParse({}).success, false);
  assert.equal(searchCustomersInput.safeParse({ createdFrom: '2024-12-31', createdTo: '2024-01-01' }).success, false);
  assert.equal(searchCustomersInput.parse({}).limit, 10);
  assert.equal(updateContactInput.safeParse({ id: 1 }).success, false);
});

// The three name fields an agent can send: createCustomer.name, getCustomer.name and
// searchCustomers.nameContains. Each case is read back from the parsed value.
const NAME_FIELDS = [
  ['createCustomer.name', (v: string) => createCustomerInput.safeParse({ name: v, email: 'a@b.co', phone: '11 98888-7777', segment: 'smb' }), (d: any) => d.name],
  ['getCustomer.name', (v: string) => getCustomerInput.safeParse({ name: v }), (d: any) => d.name],
  ['searchCustomers.nameContains', (v: string) => searchCustomersInput.safeParse({ nameContains: v }), (d: any) => d.nameContains],
] as const;

test('[MCP-18] name fields refuse blank names and control or bidirectional formatting characters', () => {
  const refused = ['   ', ' a ', '\t\n', 'Ab\u0000Cd', 'Ab\nCd', 'Ab\tCd', 'Ab\rCd', 'Ab\u007fCd', 'Ab\u0085Cd', 'Ab\u202eCd', 'Ab\u202aCd', 'Ab\u2066Cd', 'Ab\u2069Cd', 'Ab\u200fCd', 'Ab\u061cCd'];
  for (const [label, parse] of NAME_FIELDS) {
    for (const value of refused) assert.equal(parse(value).success, false, `${label} ${JSON.stringify(value)}`);
  }
});

test('[MCP-18] name fields trim the ends and keep accents, apostrophes and inner spaces', () => {
  for (const [label, parse, read] of NAME_FIELDS) {
    for (const [value, expected] of [['  Ana Souza  ', 'Ana Souza'], ["José d'Ávila", "José d'Ávila"], ['Ab', 'Ab'], ['\u00a0Bia\u00a0', 'Bia']] as const) {
      const parsed = parse(value);
      assert.ok(parsed.success, `${label} ${JSON.stringify(value)}`);
      assert.equal(read(parsed.data), expected, label);
    }
  }
});

test('[MCP-18] the name rules add nothing to the JSON Schema the model reads (D-25)', () => {
  const js = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as any;
  assert.deepEqual(js(createCustomerInput).properties.name, { type: 'string', minLength: 2, maxLength: 120 });
  assert.deepEqual(js(searchCustomersInput).properties.nameContains, { type: 'string', minLength: 2, maxLength: 60 });
  assert.deepEqual(js(getCustomerInput).properties.name, { type: 'string', minLength: 2, maxLength: 120, description: 'Name or part of it; accents and case are ignored' });
});

test('[MCP-08] errorMessage renders the exact catalog text', () => {
  const r = 'r-1';
  const expected: Record<ErrorCode, [ErrorDetails, string]> = {
    INVALID_INPUT: [{ rule: 'x is wrong' }, 'Invalid input: x is wrong'],
    NOT_FOUND: [{ id: 7 }, 'Customer 7 was not found.'],
    CONFLICT: [{}, 'Another customer already uses this email.'],
    AUTH_INVALID: [{}, 'The configured service token is invalid, expired or revoked. Ask an administrator for a new token.'],
    FORBIDDEN: [{}, 'This action requires the admin role; the configured token does not have it.'],
    RATE_LIMITED: [{ limit: 90, retryAfterSeconds: 58 }, 'Rate limit reached (90 requests/minute). Retry in 58 seconds.'],
    UPSTREAM_UNAVAILABLE: [{}, 'The customers API is unavailable right now. Try again shortly.'],
    UPSTREAM_ERROR: [{}, 'The customers API failed to process the request (requestId r-1). Details were logged.'],
    UPSTREAM_CONTRACT: [{}, 'The customers API returned an unexpected response (requestId r-1).'],
    READBACK_FAILED: [{ id: 31 }, 'The write to customer 31 was applied, but reading it back failed (requestId r-1). Do not repeat it; use getCustomer with id 31.'],
    INTERNAL: [{}, 'Unexpected error (requestId r-1).'],
  };
  for (const [code, [details, text]] of Object.entries(expected)) assert.equal(errorMessage(code as ErrorCode, details, r), `[${code}] ${text}`);
});
