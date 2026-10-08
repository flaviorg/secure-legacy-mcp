import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SEED_CUSTOMERS } from '../../src/legacy-api/db/seed-data.ts';
import type { TestApi } from '../support/api-harness.ts';
import { startStack } from '../support/mcp-harness.ts';

const call = (client: Client, name: string, args: object) => client.callTool({ name, arguments: args as Record<string, unknown> });
const row = (api: TestApi, email: string) => api.db.prepare('SELECT * FROM customers WHERE cst_eml = ?').get(email) as Record<string, unknown> | undefined;
const textOf = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text: string }[])[0]!.text;
const puts = (api: TestApi, id: number) => api.requests.filter((r) => r.method === 'PUT' && r.url === `/v1/customers/${id}`).length;
const seedId = (name: string) => SEED_CUSTOMERS.findIndex((c) => c.cst_nm === name) + 1;

test('[MCP-07] create, update contact and deactivate change the database', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  const created = (await call(client, 'createCustomer', { name: 'Ana Souza', email: 'ana.souza@example.com', phone: '11 98888-7777', segment: 'smb' })).structuredContent as any;
  assert.equal(created.customer.status, 'active');
  assert.equal(created.customer.phone, '+5511988887777');
  assert.equal(row(api, 'ana.souza@example.com')?.cst_phn, '11988887777');
  const updated = (await call(client, 'updateCustomerContact', { id: created.customer.id, phone: '11 97777-6666' })).structuredContent as any;
  assert.deepEqual(updated.changed, ['phone']);
  assert.equal(row(api, 'ana.souza@example.com')?.cst_phn, '11977776666');
  const deactivated = (await call(client, 'deactivateCustomer', { id: created.customer.id })).structuredContent as any;
  assert.equal(deactivated.alreadyInactive, false);
  assert.equal(deactivated.customer.status, 'inactive');
  const final = row(api, 'ana.souza@example.com')!;
  assert.deepEqual([final.cst_sts, final.cst_nm, final.cst_seg, final.cst_phn], ['I', 'Ana Souza', 2, '11977776666']);
});

test('[MCP-09] deactivating twice is idempotent and sends a single PUT', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  const id = seedId('Teodoro Escarlate');
  const first = (await call(client, 'deactivateCustomer', { id })).structuredContent as any;
  assert.equal(first.alreadyInactive, false);
  const second = (await call(client, 'deactivateCustomer', { id })).structuredContent as any;
  assert.equal(second.alreadyInactive, true);
  assert.equal(second.customer.status, 'inactive');
  assert.equal(puts(api, id), 1);
});

test('[MCP-09] updating to the same values sends no PUT', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  const id = seedId('Teodoro Escarlate');
  const seed = SEED_CUSTOMERS[id - 1]!;
  const out = (await call(client, 'updateCustomerContact', { id, email: seed.cst_eml.toUpperCase(), phone: `+55 ${seed.cst_phn}` })).structuredContent as any;
  assert.deepEqual(out.changed, []);
  assert.equal(out.customer.email, seed.cst_eml);
  assert.equal(puts(api, id), 0);
});

test('emails are case-insensitive across create and conflict, including updates', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  await call(client, 'createCustomer', { name: 'Bia Lopes', email: 'Bia.Lopes@Example.com', phone: '11 95555-4444', segment: 'retail' });
  assert.ok(row(api, 'bia.lopes@example.com'));
  const dup = await call(client, 'createCustomer', { name: 'Bia L', email: 'BIA.LOPES@example.com', phone: '11 95555-4443', segment: 'retail' });
  assert.equal(dup.isError, true);
  assert.match(textOf(dup), /^\[CONFLICT\]/);
  const upd = await call(client, 'updateCustomerContact', { id: 1, email: 'bia.lopes@EXAMPLE.com' });
  assert.equal(upd.isError, true);
  assert.match(textOf(upd), /^\[CONFLICT\]/);
  assert.equal(row(api, SEED_CUSTOMERS[0]!.cst_eml)?.cst_id, 1); // id 1 kept its own email
});

test('write tool inputs are validated by the server before any request', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  const noContact = await call(client, 'updateCustomerContact', { id: 1 });
  assert.equal(noContact.isError, true);
  assert.match(textOf(noContact), /Provide email and\/or phone/);
  const badPhone = await call(client, 'createCustomer', { name: 'Caio Prado', email: 'caio.prado@example.com', phone: '123-4567-89', segment: 'smb' });
  assert.match(textOf(badPhone), /^\[INVALID_INPUT\] Invalid input: phone must have 10 or 11 digits/);
  assert.equal(api.requests.filter((r) => r.method !== 'GET').length, 0);
});

test('[MCP-18] blank names and names with control characters are refused before any request', async (t) => {
  const { client, api } = await startStack(t, { role: 'admin' });
  const contact = { email: 'caio.prado@example.com', phone: '11 95555-4444', segment: 'smb' };
  for (const name of ['   ', 'Ab\nCd\u0000', 'Caio‮Prado']) {
    const r = await call(client, 'createCustomer', { name, ...contact });
    assert.equal(r.isError, true, JSON.stringify(name));
    assert.match(textOf(r), /name/, JSON.stringify(name));
  }
  for (const [tool, args] of [['searchCustomers', { nameContains: '  ' }], ['getCustomer', { name: '  ' }], ['getCustomer', { name: 'Ana\tSouza' }]] as const) {
    const r = await call(client, tool, args);
    assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)}`);
  }
  assert.equal(api.requests.length, 0);
  assert.equal((api.db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n, SEED_CUSTOMERS.length);
  const padded = (await call(client, 'createCustomer', { name: '  Caio Prado  ', ...contact })).structuredContent as any;
  assert.equal(padded.customer.name, 'Caio Prado');
  assert.equal(row(api, 'caio.prado@example.com')?.cst_nm, 'Caio Prado');
});
