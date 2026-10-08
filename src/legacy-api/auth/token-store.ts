import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../shared/clock.ts';
import { TOKEN_REGEX, tokenIdOf } from '../../shared/token-pattern.ts';

export type Role = 'member' | 'admin';
export type TokenRecord = {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type TokenRow = {
  id: string;
  name: string;
  role: Role;
  token_hash: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;
const SECRET_BYTES = 32; // 256 random bits -> 43 base64url characters
const MAX_ID_ATTEMPTS = 5;
const PUBLIC_COLUMNS = 'id, name, role, created_at, expires_at, last_used_at, revoked_at';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

function generateId(): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

function toRecord(row: Omit<TokenRow, 'token_hash'>): TokenRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

// Service tokens (spec 4.4 and 5.7). Only the SHA-256 of the full token is stored;
// the token itself exists in clear only in the return value of issue(). verify()
// reads the database on every call (no cache), so a revocation done by the CLI in
// another process is seen by the very next request.
export function createTokenStore(db: DatabaseSync, clock: Clock) {
  const selectById = db.prepare('SELECT * FROM service_tokens WHERE id = ?');
  const insert = db.prepare(`INSERT INTO service_tokens (id, name, role, token_hash, created_at, expires_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`);
  const touch = db.prepare('UPDATE service_tokens SET last_used_at = ? WHERE id = ?');
  const selectAll = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM service_tokens ORDER BY created_at, id`);
  const markRevoked = db.prepare('UPDATE service_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');

  return {
    issue(input: { name: string; role: Role; expiresAt?: Date }): { token: string; record: TokenRecord } {
      if (input.name.trim() === '') throw new TypeError('token name must not be empty');
      if (input.expiresAt && Number.isNaN(input.expiresAt.getTime())) throw new RangeError('expiresAt is not a valid date');
      let id = generateId();
      for (let attempt = 1; selectById.get(id) !== undefined; attempt++) {
        if (attempt >= MAX_ID_ATTEMPTS) throw new Error('could not allocate a unique token id');
        id = generateId();
      }
      const token = `slm_${id}_${randomBytes(SECRET_BYTES).toString('base64url')}`;
      const createdAt = clock.now().toISOString();
      const expiresAt = input.expiresAt?.toISOString() ?? null;
      insert.run(id, input.name, input.role, sha256(token).toString('hex'), createdAt, expiresAt);
      return { token, record: { id, name: input.name, role: input.role, createdAt, expiresAt, lastUsedAt: null, revokedAt: null } };
    },

    verify(token: string): TokenRecord | null {
      if (typeof token !== 'string' || !TOKEN_REGEX.test(token)) return null;
      const id = tokenIdOf(token);
      if (id === null) return null;
      const row = selectById.get(id) as TokenRow | undefined;
      if (!row) return null;
      const stored = Buffer.from(row.token_hash, 'hex');
      const presented = sha256(token);
      if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null;
      if (row.revoked_at !== null) return null;
      const now = clock.now();
      if (row.expires_at !== null && Date.parse(row.expires_at) <= now.getTime()) return null;
      const lastUsedAt = now.toISOString();
      touch.run(lastUsedAt, id);
      return toRecord({ ...row, last_used_at: lastUsedAt });
    },

    list(): TokenRecord[] {
      return (selectAll.all() as Omit<TokenRow, 'token_hash'>[]).map(toRecord);
    },

    revoke(id: string): 'revoked' | 'already_revoked' | 'not_found' {
      if (markRevoked.run(clock.now().toISOString(), id).changes > 0) return 'revoked';
      return selectById.get(id) === undefined ? 'not_found' : 'already_revoked';
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
