import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import { toCustomer, toCustomerList, toLegacyQuery, toLegacyWritable, toMutationId } from '../../src/mcp/infrastructure/legacy-mapper.ts';

const row = { cst_id: 12, cst_nm: 'Teodoro Escarlate', cst_phn: '11900000012', cst_eml: 'Teodoro.Escarlate@example.com', cst_sts: 'A', cst_seg: 3, dt_cad: '20240115' };
const customer = { id: 12, name: 'Teodoro Escarlate', email: 'teodoro.escarlate@example.com', phone: '+5511900000012', status: 'active', segment: 'enterprise', createdAt: '2024-01-15' } as const;

test('maps a legacy row to the domain customer', () => assert.deepEqual(toCustomer(row), customer));

test('[MCP-07] maps the domain back to the legacy writable shape without cst_id', () => {
  const { id: _i, createdAt: _c, ...writable } = customer;
  assert.deepEqual(toLegacyWritable(writable), { cst_nm: 'Teodoro Escarlate', cst_phn: '11900000012', cst_eml: 'teodoro.escarlate@example.com', cst_sts: 'A', cst_seg: 3 });
});

test('maps filters to legacy query parameters', () => {
  assert.deepEqual(toLegacyQuery({ nameContains: 'teo', email: 'a@b.co', phoneDigits: '11900000012', status: 'active', segment: 'smb', createdFrom: '2024-01-01', createdTo: '2024-12-31' }),
    { nm: 'teo', eml: 'a@b.co', phn: '11900000012', sts: 'A', seg: '2', dt_de: '20240101', dt_ate: '20241231' });
});

test('[MCP-15] payloads outside the legacy schema become UPSTREAM_CONTRACT', () => {
  const isContract = (e: unknown) => e instanceof DomainError && e.code === 'UPSTREAM_CONTRACT';
  for (const bad of [{ ...row, cst_sts: 'X' }, { ...row, dt_cad: '2024-01-15' }, { ...row, cst_phn: '+5511' }, '<html>', null]) assert.throws(() => toCustomer(bad), isContract);
  assert.throws(() => toCustomerList({ qtd: '1', dados: [] }), isContract);
  assert.throws(() => toMutationId({ msg: 'ok' }), isContract);
});

// The legacy API validates only minLength 1 for name and email, so it stores rows that
// the MCP input rules would refuse. Inside the legacy contract they are still
// customers and map as stored; UPSTREAM_CONTRACT is only for the legacy contract.
test('[MCP-15] rows inside the legacy contract map as stored, even when the input rules would refuse them', () => {
  const dirty = [
    { ...row, cst_id: 31, cst_nm: 'X', cst_eml: 'Not-An-Email' },
    { ...row, cst_id: 32, cst_nm: `Maria Silva ${'Z'.repeat(124)}` },
    { ...row, cst_id: 33, dt_cad: '20241399' },
  ];
  const { total, items } = toCustomerList({ qtd: 3, dados: dirty });
  assert.equal(total, 3);
  assert.deepEqual(items.map((c) => [c.id, c.name.length, c.email, c.createdAt]),
    [[31, 1, 'not-an-email', '2024-01-15'], [32, 136, 'teodoro.escarlate@example.com', '2024-01-15'], [33, 17, 'teodoro.escarlate@example.com', '2024-13-99']]);
  assert.equal(toCustomer(dirty[0]).email, 'not-an-email');
});
