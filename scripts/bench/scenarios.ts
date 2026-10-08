// Scripted scenarios of the token comparison (spec 9.1): the minimal correct sequence
// of calls for each request, without an LLM. Arguments may depend on the parsed
// results of the previous steps of the same scenario.
import { SEED_CUSTOMERS } from '../../src/legacy-api/db/seed-data.ts';

export type ScenarioStep = {
  tool: string;
  args: Record<string, unknown> | ((previous: unknown[]) => Record<string, unknown>);
};

export type Scenario = {
  id: 'C1' | 'C2a' | 'C2b' | 'C3';
  title: string;
  mirror: ScenarioStep[];
  business: ScenarioStep[] | null; // null: same business calls as C2a
};

type LegacyRow = { cst_id: number; cst_nm: string; cst_phn: string; cst_eml: string; cst_sts: string; cst_seg: number };

const TEODORO = SEED_CUSTOMERS.find((c) => c.cst_nm === 'Teodoro Escarlate');
if (TEODORO === undefined) throw new Error('seed without Teodoro Escarlate');

const firstRow = (previous: unknown[]): LegacyRow => {
  const row = (previous[0] as { dados?: LegacyRow[] } | undefined)?.dados?.[0];
  if (row === undefined) throw new Error('mirror lookup returned no customer');
  return row;
};

const foundId = (previous: unknown[]): number => {
  const id = (previous[0] as { customer?: { id?: number } | null } | undefined)?.customer?.id;
  if (id === undefined) throw new Error('getCustomer did not find the customer');
  return id;
};

const ENTERPRISE_2024_LEGACY = { sts: 'A', seg: 3, dt_de: '20240101', dt_ate: '20241231' };

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'C1',
    title: 'telefone do cliente com e-mail X',
    mirror: [{ tool: 'getV1Customers', args: { eml: TEODORO.cst_eml } }],
    business: [{ tool: 'getCustomer', args: { email: TEODORO.cst_eml } }],
  },
  {
    id: 'C2a',
    title: 'clientes enterprise ativos cadastrados em 2024 (comparação justa)',
    mirror: [{ tool: 'getV1Customers', args: { ...ENTERPRISE_2024_LEGACY, lim: 10 } }],
    business: [{ tool: 'searchCustomers', args: { status: 'active', segment: 'enterprise', createdFrom: '2024-01-01', createdTo: '2024-12-31' } }],
  },
  {
    id: 'C2b',
    title: 'mesmo pedido, espelho ingênuo sem `lim` (erro do modelo)',
    mirror: [{ tool: 'getV1Customers', args: { ...ENTERPRISE_2024_LEGACY } }],
    business: null,
  },
  {
    id: 'C3',
    title: 'desative o Teodoro',
    mirror: [
      { tool: 'getV1Customers', args: { nm: 'teodoro' } },
      {
        tool: 'putV1CustomersById',
        args: (previous) => {
          const c = firstRow(previous);
          return { id: c.cst_id, cst_nm: c.cst_nm, cst_phn: c.cst_phn, cst_eml: c.cst_eml, cst_sts: 'I', cst_seg: c.cst_seg };
        },
      },
    ],
    business: [
      { tool: 'getCustomer', args: { name: 'teodoro' } },
      { tool: 'deactivateCustomer', args: (previous) => ({ id: foundId(previous) }) },
    ],
  },
];
