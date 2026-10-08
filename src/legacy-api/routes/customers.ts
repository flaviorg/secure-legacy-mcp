import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { requireRole } from '../auth/require-role.ts';
import { DuplicateEmailError } from '../db/customer-repository.ts';
import type { CustomerRepository, LegacyFilter, LegacyWritable } from '../db/customer-repository.ts';

type ListQuery = { filter: LegacyFilter; limit?: number; offset: number };
type NewCustomerBody = Omit<LegacyWritable, 'cst_sts'>;
type ReplaceCustomerBody = LegacyWritable & { cst_id?: unknown };

const NOT_FOUND = { msg: 'nao encontrado' } as const;
const DUPLICATE_EMAIL = { erro: 'email duplicado' } as const;

// Fastify JSON Schemas for the legacy write bodies. No `additionalProperties: false`:
// the legacy API accepts extra fields, which is what lets `cst_id` reach the PUT trap.
const writableProperties = {
  cst_nm: { type: 'string', minLength: 1 },
  cst_phn: { type: 'string', pattern: '^\\d{10,11}$' },
  cst_eml: { type: 'string', minLength: 1 },
  cst_sts: { type: 'string', enum: ['A', 'I'] },
  cst_seg: { type: 'integer', enum: [1, 2, 3] },
} as const;
const { cst_sts: _status, ...newProperties } = writableProperties;
const NEW_CUSTOMER_SCHEMA = { type: 'object', required: ['cst_nm', 'cst_phn', 'cst_eml', 'cst_seg'], properties: newProperties } as const;
const REPLACE_CUSTOMER_SCHEMA = { type: 'object', required: ['cst_nm', 'cst_phn', 'cst_eml', 'cst_sts', 'cst_seg'], properties: writableProperties } as const;

// Deliberate legacy bug (spec 5.2, API-04): when the PUT body carries cst_id, the old
// handler builds the UPDATE from this fixed column list and forgets the commas, so
// SQLite rejects the statement and the raw message goes back to the client. Column
// names never come from the body.
const LEGACY_UPDATE_COLUMNS = ['cst_id', 'cst_nm', 'cst_phn', 'cst_eml', 'cst_sts', 'cst_seg'] as const;
const LEGACY_UPDATE_SQL = `UPDATE customers SET ${LEGACY_UPDATE_COLUMNS.map((c) => `${c} = ?`).join(' ')} WHERE cst_id = ?`;
const DIGITS = /^\d+$/;
const LEGACY_DATE = /^\d{8}$/;
const PHONE = /^\d{10,11}$/;

const intIn = (value: string, min: number, max: number): number | null => {
  if (!DIGITS.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};

// Manual validation of the legacy query string. Known parameters with an invalid
// value are reported by name; unknown parameters are ignored (legacy behavior).
function parseListQuery(query: Record<string, unknown>): ListQuery | { invalid: string } {
  const filter: LegacyFilter = {};
  let limit: number | undefined;
  let offset = 0;
  const known = ['nm', 'eml', 'phn', 'sts', 'seg', 'dt_de', 'dt_ate', 'lim', 'off'] as const;
  for (const name of known) {
    const raw = query[name];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') return { invalid: name };
    switch (name) {
      case 'nm':
      case 'eml':
        if (raw.length === 0) return { invalid: name };
        filter[name] = raw;
        break;
      case 'phn':
        if (!PHONE.test(raw)) return { invalid: name };
        filter.phn = raw;
        break;
      case 'sts':
        if (raw !== 'A' && raw !== 'I') return { invalid: name };
        filter.sts = raw;
        break;
      case 'seg':
        if (raw !== '1' && raw !== '2' && raw !== '3') return { invalid: name };
        filter.seg = Number(raw) as 1 | 2 | 3;
        break;
      case 'dt_de':
      case 'dt_ate':
        if (!LEGACY_DATE.test(raw)) return { invalid: name };
        filter[name === 'dt_de' ? 'dtDe' : 'dtAte'] = raw;
        break;
      case 'lim': {
        const n = intIn(raw, 1, 500);
        if (n === null) return { invalid: name };
        limit = n;
        break;
      }
      case 'off': {
        const n = intIn(raw, 0, Number.MAX_SAFE_INTEGER);
        if (n === null) return { invalid: name };
        offset = n;
        break;
      }
    }
  }
  return limit === undefined ? { filter, offset } : { filter, limit, offset };
}

// Legacy ids: anything that is not a positive integer is simply "not found".
const parseId = (raw: unknown): number | null => (typeof raw === 'string' ? intIn(raw, 1, Number.MAX_SAFE_INTEGER) : null);

export function registerCustomerRoutes(app: FastifyInstance, deps: { repository: CustomerRepository; db: DatabaseSync }): void {
  const { repository, db } = deps;
  // Writes need admin; the check runs before body validation (see require-role.ts).
  const adminOnly = requireRole('admin');

  app.get('/v1/customers', async (request, reply) => {
    const parsed = parseListQuery(request.query as Record<string, unknown>);
    if ('invalid' in parsed) return reply.code(400).send({ erro: `parametro invalido: ${parsed.invalid}` });
    const { total, rows } = repository.search(parsed.filter, { limit: parsed.limit, offset: parsed.offset });
    return { qtd: total, dados: rows };
  });

  app.get('/v1/customers/:id', async (request, reply) => {
    const id = parseId((request.params as { id?: unknown }).id);
    const row = id === null ? null : repository.getById(id);
    if (row === null) return reply.code(404).send(NOT_FOUND);
    return row;
  });

  app.post<{ Body: NewCustomerBody }>('/v1/customers', { preValidation: adminOnly, schema: { body: NEW_CUSTOMER_SCHEMA } }, async (request, reply) => {
    const { cst_nm, cst_phn, cst_eml, cst_seg } = request.body;
    try {
      const id = repository.insert({ cst_nm, cst_phn, cst_eml, cst_seg });
      return reply.code(201).send({ id, msg: 'cadastrado' });
    } catch (err) {
      if (err instanceof DuplicateEmailError) return reply.code(409).send(DUPLICATE_EMAIL);
      throw err;
    }
  });

  app.put<{ Body: ReplaceCustomerBody }>('/v1/customers/:id', { preValidation: adminOnly, schema: { body: REPLACE_CUSTOMER_SCHEMA } }, async (request, reply) => {
    const body = request.body;
    if ('cst_id' in body) {
      try {
        db.prepare(LEGACY_UPDATE_SQL).run();
      } catch (err) {
        return reply.code(500).send({ erro: `SQLITE_ERROR: ${(err as Error).message}` });
      }
    }
    const id = parseId((request.params as { id?: unknown }).id);
    if (id === null) return reply.code(404).send(NOT_FOUND);
    const { cst_nm, cst_phn, cst_eml, cst_sts, cst_seg } = body;
    try {
      if (!repository.replace(id, { cst_nm, cst_phn, cst_eml, cst_sts, cst_seg })) return reply.code(404).send(NOT_FOUND);
    } catch (err) {
      if (err instanceof DuplicateEmailError) return reply.code(409).send(DUPLICATE_EMAIL);
      throw err;
    }
    return { id, msg: 'atualizado' };
  });

  app.delete('/v1/customers/:id', { preValidation: adminOnly }, async (request, reply) => {
    const id = parseId((request.params as { id?: unknown }).id);
    if (id === null || !repository.remove(id)) return reply.code(404).send(NOT_FOUND);
    return { id, msg: 'removido' };
  });
}
