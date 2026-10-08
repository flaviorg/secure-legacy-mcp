import { DatabaseSync } from 'node:sqlite';

export type LegacyCustomerRow = {
  cst_id: number;
  cst_nm: string;
  cst_phn: string;
  cst_eml: string;
  cst_sts: 'A' | 'I';
  cst_seg: 1 | 2 | 3;
  dt_cad: string;
};

// Idempotent DDL (spec 5.1). cst_nm_norm is internal and never returned by the API.
const DDL = `
CREATE TABLE IF NOT EXISTS customers (
  cst_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  cst_nm      TEXT    NOT NULL,
  cst_nm_norm TEXT    NOT NULL,
  cst_phn     TEXT    NOT NULL,
  cst_eml     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  cst_sts     TEXT    NOT NULL CHECK (cst_sts IN ('A','I')),
  cst_seg     INTEGER NOT NULL CHECK (cst_seg IN (1,2,3)),
  dt_cad      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_nm_norm ON customers(cst_nm_norm);

CREATE TABLE IF NOT EXISTS service_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('member','admin')),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
);
`;

// timeout: wait up to 5 s for a lock instead of failing with SQLITE_BUSY when the
// token CLI and the API write to the same file. WAL only applies to file databases.
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode=WAL');
  db.exec(DDL);
  return db;
}
