import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startStack } from '../support/mcp-harness.ts';

const structured = (r: Awaited<ReturnType<Client['callTool']>>) => r.structuredContent as any;

test('[MCP-04] tools/list lists exactly the 5 business actions with schemas and annotations', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  const tools = Object.fromEntries((await client.listTools()).tools.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(tools).sort(), ['createCustomer', 'deactivateCustomer', 'getCustomer', 'searchCustomers', 'updateCustomerContact']);
  for (const tool of Object.values(tools)) {
    assert.ok(tool.description && tool.description.length > 0 && tool.description.length <= 300, tool.name);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.outputSchema, tool.name);
  }
  assert.deepEqual(tools.getCustomer!.annotations, { readOnlyHint: true, openWorldHint: false });
  assert.deepEqual(tools.searchCustomers!.annotations, { readOnlyHint: true });
  assert.deepEqual(tools.createCustomer!.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  for (const n of ['updateCustomerContact', 'deactivateCustomer']) assert.deepEqual(tools[n]!.annotations, { destructiveHint: true, idempotentHint: true }, n);
  assert.equal((tools.getCustomer!.inputSchema.properties as any).email.description, 'Exact email');
  assert.deepEqual(Object.keys(tools.createCustomer!.inputSchema.properties!).sort(), ['email', 'name', 'phone', 'segment']);
  assert.deepEqual(Object.keys(tools.updateCustomerContact!.inputSchema.properties!).sort(), ['email', 'id', 'phone']);
  assert.deepEqual(Object.keys(tools.deactivateCustomer!.inputSchema.properties!), ['id']);
  assert.deepEqual(Object.keys(tools.updateCustomerContact!.outputSchema!.properties!).sort(), ['changed', 'customer']);
  assert.deepEqual(Object.keys(tools.deactivateCustomer!.outputSchema!.properties!).sort(), ['alreadyInactive', 'customer']);
});

// The read tools reach the client with their describe texts and output schemas
// (spec 5.3 and 5.4).
test('tools/list exposes the read tools with describe texts, output schemas and annotations', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const get = byName.get('getCustomer')!;
  const search = byName.get('searchCustomers')!;
  assert.ok(get && search);
  for (const tool of [get, search]) assert.ok(tool.description!.length > 0 && tool.description!.length <= 300, tool.name);
  const getProps = get.inputSchema.properties as Record<string, { description?: string }>;
  assert.deepEqual(Object.keys(getProps).sort(), ['email', 'id', 'name', 'phone']);
  assert.equal(getProps.name!.description, 'Name or part of it; accents and case are ignored');
  assert.deepEqual(Object.keys(search.inputSchema.properties!).sort(), ['createdFrom', 'createdTo', 'cursor', 'limit', 'nameContains', 'segment', 'status']);
  assert.deepEqual(Object.keys(get.outputSchema!.properties!).sort(), ['candidates', 'customer', 'match']);
  assert.deepEqual(Object.keys(search.outputSchema!.properties!).sort(), ['items', 'nextCursor', 'total']);
  assert.deepEqual(get.annotations, { readOnlyHint: true, openWorldHint: false });
  assert.deepEqual(search.annotations, { readOnlyHint: true });
});

test('[MCP-05] getCustomer returns ambiguous for "maria silva" with exactly 2 candidates', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  const out = structured(await client.callTool({ name: 'getCustomer', arguments: { name: 'maria silva' } }));
  assert.equal(out.match, 'ambiguous'); assert.equal(out.customer, null); assert.equal(out.candidates.length, 2);
});

test('[MCP-05] getCustomer ignores case and accents, in composed and decomposed forms', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  // 'João' is "João" in decomposed form (NFD), as some MCP clients send it.
  for (const name of ['TEODORO', 'joão pereira', 'João Pereira', 'joao']) {
    assert.equal(structured(await client.callTool({ name: 'getCustomer', arguments: { name } })).match, 'found', name);
  }
  assert.equal(structured(await client.callTool({ name: 'getCustomer', arguments: { name: 'zzzz' } })).match, 'none');
});

test('[MCP-06] every legacy listing request carries lim of at most 50', async (t) => {
  const { client, api } = await startStack(t, { role: 'member' });
  await client.callTool({ name: 'getCustomer', arguments: { name: 'maria' } });
  await client.callTool({ name: 'searchCustomers', arguments: { status: 'active', limit: 50 } });
  const listings = api.requests.filter((r) => r.method === 'GET' && r.url.startsWith('/v1/customers?'));
  assert.ok(listings.length >= 2);
  for (const r of listings) {
    const lim = Number(new URL(r.url, 'http://x').searchParams.get('lim'));
    assert.ok(lim >= 1 && lim <= 50, r.url);
  }
});

test('[MCP-06] searchCustomers filters in the database and pages with a cursor', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  const call = (args: object) => client.callTool({ name: 'searchCustomers', arguments: args as Record<string, unknown> }).then(structured);
  assert.equal((await call({ status: 'active', segment: 'enterprise', createdFrom: '2024-01-01', createdTo: '2024-12-31' })).total, 3);
  const p1 = await call({ nameContains: 'silv', limit: 2 });
  const p2 = await call({ nameContains: 'silv', limit: 2, cursor: p1.nextCursor });
  assert.deepEqual([p1.total, p1.items.length, p2.items.length, p2.nextCursor], [3, 2, 1, null]);
});

test('oversized inputs are rejected by validation without crashing the server', async (t) => {
  const { client } = await startStack(t, { role: 'member' });
  const long = await client.callTool({ name: 'getCustomer', arguments: { name: 'x'.repeat(500) } });
  assert.equal(long.isError, true);
  const many = await client.callTool({ name: 'searchCustomers', arguments: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, i])) });
  assert.match((many.content as { text: string }[])[0]!.text, /maximum of 64 elements/);
  assert.equal(structured(await client.callTool({ name: 'getCustomer', arguments: { id: 1 } })).match, 'found');
});

// Dirty legacy data is the realistic case: the legacy API accepts any non-empty name
// and email, as its own curl examples show. Such rows must not take the read tools
// down, and the output schemas must accept them on the server and on the client.
test('[MCP-15] rows the legacy API accepts but the input rules would refuse do not break the read tools', async (t) => {
  const { client, api } = await startStack(t, { role: 'member' });
  const admin = api.issueToken('admin');
  const post = async (body: object) => {
    const res = await fetch(`${api.url}/v1/customers`, { method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 201);
    return ((await res.json()) as { id: number }).id;
  };
  const shortId = await post({ cst_nm: 'X', cst_phn: '11911112222', cst_eml: 'not-an-email', cst_seg: 1 });
  const longName = `Maria Silva ${'Z'.repeat(124)}`; // 136 characters, above the input limit of 120
  const longId = await post({ cst_nm: longName, cst_phn: '11911113333', cst_eml: 'maria.zzz@example.com', cst_seg: 2 });

  const page = await client.callTool({ name: 'searchCustomers', arguments: { limit: 50 } });
  assert.equal(page.isError, undefined, JSON.stringify(page.content));
  assert.equal(structured(page).total, 32);
  assert.deepEqual(structured(page).items.find((c: { id: number }) => c.id === shortId), { id: shortId, name: 'X', email: 'not-an-email', status: 'active', segment: 'retail' });

  const byId = structured(await client.callTool({ name: 'getCustomer', arguments: { id: shortId } }));
  assert.deepEqual([byId.match, byId.customer.name, byId.customer.email], ['found', 'X', 'not-an-email']);

  // Still ambiguous, now with 3 candidates: a dirty homonym is never dropped from the
  // resolution, so the agent cannot be steered to the wrong Maria Silva.
  const maria = structured(await client.callTool({ name: 'getCustomer', arguments: { name: 'maria silva' } }));
  assert.equal(maria.match, 'ambiguous');
  assert.ok(maria.candidates.some((c: { id: number; name: string }) => c.id === longId && c.name === longName));
  assert.equal(maria.candidates.length, 3);
});
