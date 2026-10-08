import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Clock } from '../../shared/clock.ts';
import type { LegacyCustomerRow } from './database.ts';
import { escapeLike, normalizeName } from './normalize.ts';

export type LegacyFilter = { nm?: string; eml?: string; phn?: string; sts?: 'A' | 'I'; seg?: 1 | 2 | 3; dtDe?: string; dtAte?: string };
export type LegacyWritable = Omit<LegacyCustomerRow, 'cst_id' | 'dt_cad'>;

export class DuplicateEmailError extends Error {
  override name = 'DuplicateEmailError';
}

// Public columns only: cst_nm_norm never leaves the repository.
const COLUMNS = 'cst_id, cst_nm, cst_phn, cst_eml, cst_sts, cst_seg, dt_cad';
const SQLITE_CONSTRAINT_UNIQUE = 2067;

function isDuplicateEmail(err: unknown): boolean {
  const e = err as { errcode?: unknown; message?: unknown };
  return e?.errcode === SQLITE_CONSTRAINT_UNIQUE && typeof e.message === 'string' && e.message.includes('customers.cst_eml');
}

function translateDuplicate<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isDuplicateEmail(err)) throw new DuplicateEmailError('email duplicado', { cause: err });
    throw err;
  }
}

// YYYYMMDD in UTC, the legacy date format.
const legacyDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '');

function whereClause(filter: LegacyFilter): { sql: string; params: SQLInputValue[] } {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.nm !== undefined) { parts.push(`cst_nm_norm LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(normalizeName(filter.nm))}%`); }
  if (filter.eml !== undefined) { parts.push('cst_eml = ?'); params.push(filter.eml); } // column is COLLATE NOCASE
  if (filter.phn !== undefined) { parts.push('cst_phn = ?'); params.push(filter.phn); }
  if (filter.sts !== undefined) { parts.push('cst_sts = ?'); params.push(filter.sts); }
  if (filter.seg !== undefined) { parts.push('cst_seg = ?'); params.push(filter.seg); }
  if (filter.dtDe !== undefined) { parts.push('dt_cad >= ?'); params.push(filter.dtDe); }
  if (filter.dtAte !== undefined) { parts.push('dt_cad <= ?'); params.push(filter.dtAte); }
  return { sql: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

export function createCustomerRepository(db: DatabaseSync, clock: Clock) {
  return {
    search(filter: LegacyFilter, page: { limit?: number; offset: number }): { total: number; rows: LegacyCustomerRow[] } {
      const where = whereClause(filter);
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM customers${where.sql}`).get(...where.params) as { total: number };
      let sql = `SELECT ${COLUMNS} FROM customers${where.sql} ORDER BY cst_nm_norm, cst_id`;
      const params = [...where.params];
      if (page.limit !== undefined) { sql += ' LIMIT ? OFFSET ?'; params.push(page.limit, page.offset); }
      else if (page.offset > 0) { sql += ' LIMIT -1 OFFSET ?'; params.push(page.offset); }
      const rows = db.prepare(sql).all(...params) as LegacyCustomerRow[];
      return { total, rows };
    },

    getById(id: number): LegacyCustomerRow | null {
      return (db.prepare(`SELECT ${COLUMNS} FROM customers WHERE cst_id = ?`).get(id) as LegacyCustomerRow | undefined) ?? null;
    },

    insert(input: Omit<LegacyWritable, 'cst_sts'>): number {
      return translateDuplicate(() => {
        const result = db.prepare(`INSERT INTO customers (cst_nm, cst_nm_norm, cst_phn, cst_eml, cst_sts, cst_seg, dt_cad)
          VALUES (?, ?, ?, ?, 'A', ?, ?)`).run(input.cst_nm, normalizeName(input.cst_nm), input.cst_phn, input.cst_eml, input.cst_seg, legacyDate(clock.now()));
        return Number(result.lastInsertRowid);
      });
    },

    replace(id: number, data: LegacyWritable): boolean {
      return translateDuplicate(() => {
        const result = db.prepare(`UPDATE customers SET cst_nm = ?, cst_nm_norm = ?, cst_phn = ?, cst_eml = ?, cst_sts = ?, cst_seg = ?
          WHERE cst_id = ?`).run(data.cst_nm, normalizeName(data.cst_nm), data.cst_phn, data.cst_eml, data.cst_sts, data.cst_seg, id);
        return Number(result.changes) > 0;
      });
    },

    remove(id: number): boolean {
      return Number(db.prepare('DELETE FROM customers WHERE cst_id = ?').run(id).changes) > 0;
    },
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
