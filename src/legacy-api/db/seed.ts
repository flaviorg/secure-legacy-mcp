import type { DatabaseSync } from 'node:sqlite';
import { normalizeName } from './normalize.ts';
import { SEED_CUSTOMERS } from './seed-data.ts';

// Inserts the fixed seed when `customers` is empty; returns how many rows were inserted.
// Ids are explicit (index + 1) so the array order always defines them.
export function seedIfEmpty(db: DatabaseSync): number {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  if (n > 0) return 0;
  const insert = db.prepare(`INSERT INTO customers (cst_id, cst_nm, cst_nm_norm, cst_phn, cst_eml, cst_sts, cst_seg, dt_cad)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    SEED_CUSTOMERS.forEach((c, i) => {
      insert.run(i + 1, c.cst_nm, normalizeName(c.cst_nm), c.cst_phn, c.cst_eml, c.cst_sts, c.cst_seg, c.dt_cad);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return SEED_CUSTOMERS.length;
}
