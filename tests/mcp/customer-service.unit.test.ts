import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerService } from '../../src/mcp/application/customer-service.ts';
import type { Customer } from '../../src/mcp/domain/customer.ts';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import { createInMemoryGateway } from '../support/fake-gateway.ts';

const mk = (id: number, name: string, extra: Partial<Customer> = {}): Customer => ({
  id, name, email: `c${id}@example.com`, phone: `+55119000000${String(id).padStart(2, '0')}`, status: 'active', segment: 'retail', createdAt: '2024-01-15', ...extra });
const ctx = { requestId: 'r-1' };
const isInvalid = (e: unknown) => e instanceof DomainError && e.code === 'INVALID_INPUT';

test('[MCP-05] homonyms give ambiguous with at most 5 candidates and no customer', async () => {
  const gateway = createInMemoryGateway(Array.from({ length: 7 }, (_, i) => mk(i + 1, 'Ana Lima')));
  const out = await createCustomerService({ gateway }).getCustomer({ name: 'ana lima' }, ctx);
  assert.equal(out.match, 'ambiguous');
  assert.equal(out.customer, null);
  assert.equal(out.candidates.length, 5);
  assert.deepEqual(gateway.calls.filter((c) => c.method === 'search').map((c) => c.args[1]), [{ limit: 6, offset: 0 }]);
});

test('[MCP-05] one match is found and zero matches is none', async () => {
  const service = createCustomerService({ gateway: createInMemoryGateway([mk(1, 'Ana Lima'), mk(2, 'Bia Lopes')]) });
  const found = await service.getCustomer({ name: 'lopes' }, ctx);
  assert.equal(found.match, 'found');
  assert.equal(found.customer?.id, 2);
  assert.deepEqual(found.candidates, []);
  assert.deepEqual(await service.getCustomer({ name: 'zzz' }, ctx), { match: 'none', customer: null, candidates: [] });
});

test('getCustomer by id checks the other criteria and a missing id is none', async () => {
  const service = createCustomerService({ gateway: createInMemoryGateway([mk(1, 'Ana Lima'), mk(2, 'Bia Lopes')]) });
  assert.equal((await service.getCustomer({ id: 1, email: 'c2@example.com' }, ctx)).match, 'none');
  assert.equal((await service.getCustomer({ id: 99 }, ctx)).match, 'none');
  assert.equal((await service.getCustomer({ id: 2, name: 'lopes' }, ctx)).match, 'found');
});

test('getCustomer by id returns none when the phone or the name disagrees', async () => {
  const service = createCustomerService({ gateway: createInMemoryGateway([mk(1, 'Ana Lima'), mk(2, 'Bia Lopes')]) });
  assert.equal((await service.getCustomer({ id: 1, phone: '(11) 90000-0002' }, ctx)).match, 'none');
  assert.equal((await service.getCustomer({ id: 1, name: 'lopes' }, ctx)).match, 'none');
  assert.equal((await service.getCustomer({ id: 1, phone: '11 90000-0001', name: 'ANA' }, ctx)).match, 'found');
});

test('getCustomer by id folds accents in composed and decomposed forms when checking the name', async () => {
  // Escapes keep both Unicode forms intact whatever the editor does to the file.
  const service = createCustomerService({ gateway: createInMemoryGateway([mk(11, 'João Pereira'), mk(12, 'João Pereira')]) });
  for (const [id, name] of [[11, 'joao'], [11, 'joão pereira'], [12, 'JOÃO'], [12, 'joao pereira']] as const) {
    assert.equal((await service.getCustomer({ id, name }, ctx)).match, 'found', `${id} ${name}`);
  }
  assert.equal((await service.getCustomer({ id: 11, name: 'maria' }, ctx)).match, 'none');
});

test('getCustomer sends every criterion in a single search', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima')]);
  await createCustomerService({ gateway }).getCustomer({ name: 'ana', phone: '(11) 90000-0001' }, ctx);
  const searches = gateway.calls.filter((c) => c.method === 'search');
  assert.equal(searches.length, 1);
  assert.deepEqual(searches[0]!.args[0], { nameContains: 'ana', phoneDigits: '11900000001' });
});

test('an invalid phone becomes INVALID_INPUT before any upstream call', async () => {
  const gateway = createInMemoryGateway([]);
  await assert.rejects(createCustomerService({ gateway }).getCustomer({ phone: '98765-0012' }, ctx),
    (e: unknown) => e instanceof DomainError && e.code === 'INVALID_INPUT');
  assert.equal(gateway.calls.length, 0);
});

test('email criteria are case-insensitive', async () => {
  const service = createCustomerService({ gateway: createInMemoryGateway([mk(1, 'Ana Lima', { email: 'ana.lima@example.com' })]) });
  assert.equal((await service.getCustomer({ email: 'ANA.Lima@Example.com' }, ctx)).match, 'found');
  assert.equal((await service.getCustomer({ id: 1, email: 'ANA.Lima@Example.com' }, ctx)).match, 'found');
});

test('[MCP-16] searchCustomers pages with nextCursor and ends with null', async () => {
  const service = createCustomerService({ gateway: createInMemoryGateway(Array.from({ length: 12 }, (_, i) => mk(i + 1, `Cliente ${String(i + 1).padStart(2, '0')}`))) });
  const p1 = await service.searchCustomers({ nameContains: 'cliente', limit: 5 }, ctx);
  const p2 = await service.searchCustomers({ nameContains: 'cliente', limit: 5, cursor: p1.nextCursor! }, ctx);
  const p3 = await service.searchCustomers({ nameContains: 'cliente', limit: 5, cursor: p2.nextCursor! }, ctx);
  assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p3.total], [5, 5, 2, 12]);
  assert.equal(p3.nextCursor, null);
  assert.deepEqual(Object.keys(p1.items[0]!).sort(), ['email', 'id', 'name', 'segment', 'status']);
});

test('[MCP-16] a cursor reused with other filters is rejected', async () => {
  const gateway = createInMemoryGateway(Array.from({ length: 12 }, (_, i) => mk(i + 1, `Cliente ${String(i + 1).padStart(2, '0')}`)));
  const service = createCustomerService({ gateway });
  const p1 = await service.searchCustomers({ nameContains: 'cliente', limit: 5 }, ctx);
  assert.ok(p1.nextCursor);
  const before = gateway.calls.length;
  await assert.rejects(service.searchCustomers({ nameContains: 'outro', limit: 5, cursor: p1.nextCursor }, ctx), isInvalid);
  assert.equal(gateway.calls.length, before);
});

// If the total changes between pages, an empty page must still end the pagination;
// a cursor pointing at the same offset would make a client loop forever.
test('[MCP-16] an empty page ends the pagination even when the total says otherwise', async () => {
  const gateway = { ...createInMemoryGateway([]), search: async () => ({ items: [], total: 5 }) };
  assert.deepEqual(await createCustomerService({ gateway }).searchCustomers({ limit: 5 }, ctx), { items: [], total: 5, nextCursor: null });
});

test('describeCaller returns the caller, or null when the API fails', async () => {
  const caller = { tokenId: 'k3x9q2ab', name: 'ci', role: 'member' } as const;
  assert.deepEqual(await createCustomerService({ gateway: createInMemoryGateway([], { caller }) }).describeCaller(ctx), caller);
  assert.equal(await createCustomerService({ gateway: createInMemoryGateway([], { whoamiError: new DomainError('UPSTREAM_UNAVAILABLE') }) }).describeCaller(ctx), null);
});

// Write path (spec 5.4): read, compare, write only when something changes, re-read.
const replaces = (gateway: ReturnType<typeof createInMemoryGateway>) => gateway.calls.filter((c) => c.method === 'replace');
const isNotFound = (id: number) => (e: unknown) => e instanceof DomainError && e.code === 'NOT_FOUND' && e.details.id === id;

test('[MCP-09] deactivating an inactive customer returns alreadyInactive and sends no replace', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima', { status: 'inactive' })]);
  const out = await createCustomerService({ gateway }).deactivate({ id: 1 }, ctx);
  assert.equal(out.alreadyInactive, true);
  assert.equal(out.customer.status, 'inactive');
  assert.equal(replaces(gateway).length, 0);
});

test('[MCP-09] updateContact with equal values returns changed [] and sends no replace', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima', { email: 'ana@example.com', phone: '+5511988887777' })]);
  const out = await createCustomerService({ gateway }).updateContact({ id: 1, email: 'ANA@example.com', phone: '(11) 98888-7777' }, ctx);
  assert.deepEqual(out.changed, []);
  assert.equal(out.customer.email, 'ana@example.com');
  assert.equal(replaces(gateway).length, 0);
});

test('updateContact replaces with the full current object plus the changes', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima')]);
  const out = await createCustomerService({ gateway }).updateContact({ id: 1, phone: '11 97777-6666' }, ctx);
  assert.deepEqual(out.changed, ['phone']);
  assert.deepEqual(replaces(gateway)[0]!.args.slice(0, 2),
    [1, { name: 'Ana Lima', email: 'c1@example.com', phone: '+5511977776666', status: 'active', segment: 'retail' }]);
  assert.equal(out.customer.phone, '+5511977776666');
  // read, write, re-read
  assert.deepEqual(gateway.calls.map((c) => c.method), ['getById', 'replace', 'getById']);
});

test('updateContact lowercases a new email and reports both changes in a fixed order', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima')]);
  const out = await createCustomerService({ gateway }).updateContact({ id: 1, phone: '+55 11 97777-6666', email: 'Ana.Lima@Example.com' }, ctx);
  assert.deepEqual(out.changed, ['email', 'phone']);
  assert.equal((replaces(gateway)[0]!.args[1] as { email: string }).email, 'ana.lima@example.com');
  assert.equal(out.customer.email, 'ana.lima@example.com');
});

test('updateContact with an invalid phone is INVALID_INPUT before any upstream call', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima')]);
  await assert.rejects(createCustomerService({ gateway }).updateContact({ id: 1, phone: '98765-0012' }, ctx), isInvalid);
  assert.equal(gateway.calls.length, 0);
});

test('deactivate sends the full object with status inactive and returns the re-read customer', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima', { segment: 'enterprise' })]);
  const out = await createCustomerService({ gateway }).deactivate({ id: 1 }, ctx);
  assert.equal(out.alreadyInactive, false);
  assert.equal(out.customer.status, 'inactive');
  assert.deepEqual(replaces(gateway)[0]!.args.slice(0, 2),
    [1, { name: 'Ana Lima', email: 'c1@example.com', phone: '+5511900000001', status: 'inactive', segment: 'enterprise' }]);
});

test('createCustomer normalizes email and phone and returns the full customer', async () => {
  const gateway = createInMemoryGateway([]);
  const out = await createCustomerService({ gateway }).createCustomer({ name: 'Ana Souza', email: 'Ana.Souza@Example.COM', phone: '(11) 98888-7777', segment: 'smb' }, ctx);
  assert.deepEqual(gateway.calls.find((c) => c.method === 'create')!.args[0], { name: 'Ana Souza', email: 'ana.souza@example.com', phone: '+5511988887777', segment: 'smb' });
  assert.equal(out.customer.status, 'active');
  assert.equal(out.customer.id, 1);
  assert.deepEqual(gateway.calls.map((c) => c.method), ['create', 'getById']);
});

test('createCustomer with an invalid phone is INVALID_INPUT before any upstream call', async () => {
  const gateway = createInMemoryGateway([]);
  await assert.rejects(createCustomerService({ gateway }).createCustomer({ name: 'Ana Souza', email: 'ana@example.com', phone: '123456789', segment: 'smb' }, ctx), isInvalid);
  assert.equal(gateway.calls.length, 0);
});

test('createCustomer raises UPSTREAM_CONTRACT when the created id cannot be read back', async () => {
  const gateway = createInMemoryGateway([]);
  const service = createCustomerService({ gateway: { ...gateway, getById: async () => null } });
  await assert.rejects(service.createCustomer({ name: 'Ana Souza', email: 'ana@example.com', phone: '11 98888-7777', segment: 'smb' }, ctx),
    (e: unknown) => e instanceof DomainError && e.code === 'UPSTREAM_CONTRACT');
});

test('update and deactivate of a missing id raise NOT_FOUND with the id', async () => {
  const gateway = createInMemoryGateway([mk(1, 'Ana Lima')]);
  const service = createCustomerService({ gateway });
  await assert.rejects(service.updateContact({ id: 99, phone: '11 97777-6666' }, ctx), isNotFound(99));
  await assert.rejects(service.deactivate({ id: 99 }, ctx), isNotFound(99));
  assert.equal(replaces(gateway).length, 0);
});

// After the API accepted a write, a failed re-read must not invite a retry: the write
// already happened, and a repeated create would hit CONFLICT (MCP-17).
test('[MCP-17] a failed re-read after an accepted write becomes READBACK_FAILED with the id', async () => {
  const isReadback = (id: number) => (e: unknown) => e instanceof DomainError && e.code === 'READBACK_FAILED' && e.details.id === id && e.details.upstreamStatus === 500;
  const failingReads = (gateway: ReturnType<typeof createInMemoryGateway>, readsBeforeFailure: number) => {
    let reads = 0;
    return { ...gateway, getById: async (id: number, c: typeof ctx) => {
      if (++reads > readsBeforeFailure) throw new DomainError('UPSTREAM_ERROR', { upstreamStatus: 500 });
      return gateway.getById(id, c);
    } };
  };
  const created = createInMemoryGateway([]);
  await assert.rejects(createCustomerService({ gateway: failingReads(created, 0) })
    .createCustomer({ name: 'Ana Souza', email: 'ana@example.com', phone: '11 98888-7777', segment: 'smb' }, ctx), isReadback(1));
  assert.equal((await created.getById(1, ctx))?.email, 'ana@example.com'); // the customer exists
  const updated = createInMemoryGateway([mk(1, 'Ana Lima')]);
  await assert.rejects(createCustomerService({ gateway: failingReads(updated, 1) }).updateContact({ id: 1, phone: '11 97777-6666' }, ctx), isReadback(1));
  assert.equal((await updated.getById(1, ctx))?.phone, '+5511977776666');
  const deactivated = createInMemoryGateway([mk(1, 'Ana Lima')]);
  await assert.rejects(createCustomerService({ gateway: failingReads(deactivated, 1) }).deactivate({ id: 1 }, ctx), isReadback(1));
  assert.equal((await deactivated.getById(1, ctx))?.status, 'inactive');
  // Any failure of the re-read counts, not only a DomainError from the gateway.
  const broken = createInMemoryGateway([]);
  await assert.rejects(createCustomerService({ gateway: { ...broken, getById: async () => { throw new TypeError('boom'); } } })
    .createCustomer({ name: 'Bia Lopes', email: 'bia@example.com', phone: '11 95555-4444', segment: 'retail' }, ctx),
  (e: unknown) => e instanceof DomainError && e.code === 'READBACK_FAILED' && e.details.id === 1 && e.details.upstreamStatus === undefined && e.cause instanceof TypeError);
});
