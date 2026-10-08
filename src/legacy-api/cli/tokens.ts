// Service token CLI (spec 5.7): `npm run tokens -- issue|list|revoke ...`.
// It talks to the SQLite file directly; the API sees changes on its next request.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { systemClock } from '../../shared/clock.ts';
import type { Clock } from '../../shared/clock.ts';
import { maskTokens, tokenIdOf } from '../../shared/token-pattern.ts';
import { createTokenStore } from '../auth/token-store.ts';
import type { Role, TokenRecord } from '../auth/token-store.ts';
import { openDatabase } from '../db/database.ts';

const DEFAULT_DATABASE_PATH = './data/legacy.db';
const USAGE = `Uso:
  npm run tokens -- issue --name <rótulo> --role member|admin [--expires-in <n>d|<n>h] [--db <caminho>]
  npm run tokens -- list [--json] [--db <caminho>]
  npm run tokens -- revoke <id> [--db <caminho>]`;

const OPTIONS = {
  name: { type: 'string' },
  role: { type: 'string' },
  'expires-in': { type: 'string' },
  json: { type: 'boolean' },
  db: { type: 'string' },
} as const;
type OptionName = keyof typeof OPTIONS;
type Values = Partial<Record<OptionName, string | boolean>>;

const ALLOWED: Record<string, { options: readonly OptionName[]; positionals: number }> = {
  issue: { options: ['name', 'role', 'expires-in', 'db'], positionals: 0 },
  list: { options: ['json', 'db'], positionals: 0 },
  revoke: { options: ['db'], positionals: 1 },
};

const HOUR_MS = 3_600_000;
const EXPIRES_IN = /^([1-9]\d*)([dh])$/;

type Command =
  | { kind: 'issue'; db?: string; name: string; role: Role; expiresAt?: Date }
  | { kind: 'list'; db?: string; json: boolean }
  | { kind: 'revoke'; db?: string; id: string };

type Io = { out(text: string): void; err(text: string): void };

const isRole = (value: unknown): value is Role => value === 'member' || value === 'admin';

// `undefined` = no expiry; `null` = invalid value.
function expiresAtFrom(value: Values['expires-in'], now: Date): Date | undefined | null {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' ? EXPIRES_IN.exec(value) : null;
  if (!match) return null;
  const ms = Number(match[1]) * (match[2] === 'd' ? 24 * HOUR_MS : HOUR_MS);
  const expiresAt = new Date(now.getTime() + ms);
  return Number.isSafeInteger(ms) && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;
}

// Returns null for any invalid usage: unknown command or option, an option that does
// not belong to the command, a missing or extra argument, or an invalid value.
function parseCommand(argv: string[], now: Date): Command | null {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch {
    return null;
  }
  const [kind, ...positionals] = parsed.positionals;
  const allowed = kind === undefined ? undefined : ALLOWED[kind];
  if (kind === undefined || allowed === undefined || positionals.length !== allowed.positionals) return null;
  const values = parsed.values as Values;
  if ((Object.keys(values) as OptionName[]).some((key) => !allowed.options.includes(key))) return null;
  const db = typeof values.db === 'string' ? { db: values.db } : {};

  if (kind === 'list') return { kind, ...db, json: values.json === true };
  if (kind === 'revoke') return { kind, ...db, id: positionals[0]! };
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const expiresAt = expiresAtFrom(values['expires-in'], now);
  if (name === '' || !isRole(values.role) || expiresAt === null) return null;
  return { kind: 'issue', ...db, name, role: values.role, ...(expiresAt ? { expiresAt } : {}) };
}

const day = (iso: string | null, empty: string) => (iso === null ? empty : iso.slice(0, 10));

function statusOf(record: TokenRecord, now: Date): string {
  if (record.revokedAt !== null) return 'revogado';
  if (record.expiresAt !== null && Date.parse(record.expiresAt) <= now.getTime()) return 'expirado';
  return 'ativo';
}

function formatTable(records: TokenRecord[], now: Date): string {
  const header = ['ID', 'NOME', 'PAPEL', 'CRIADO', 'ÚLTIMO USO', 'EXPIRA', 'STATUS'];
  const rows = records.map((r) => [r.id, r.name, r.role, day(r.createdAt, '-'), day(r.lastUsedAt, '-'), day(r.expiresAt, 'nunca'), statusOf(r, now)]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  return [header, ...rows].map((cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('  ')).join('\n');
}

// Returns the exit code: 0 ok, 1 invalid usage or failure, 2 unknown token id.
function runTokensCli(argv: string[], env: Record<string, string | undefined>, io: Io, clock: Clock): number {
  const cmd = parseCommand(argv, clock.now());
  if (cmd === null) {
    io.err(USAGE);
    return 1;
  }
  const fromEnv = env.DATABASE_PATH === '' ? undefined : env.DATABASE_PATH;
  const databasePath = cmd.db ?? fromEnv ?? DEFAULT_DATABASE_PATH;
  try {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    const db = openDatabase(databasePath);
    try {
      const store = createTokenStore(db, clock);
      switch (cmd.kind) {
        case 'issue': {
          const { token, record } = store.issue({ name: cmd.name, role: cmd.role, ...(cmd.expiresAt ? { expiresAt: cmd.expiresAt } : {}) });
          io.out([
            'Token emitido. Copie agora: ele não será exibido novamente.',
            '',
            `  ${token}`,
            '',
            `  id: ${record.id} | nome: ${record.name} | papel: ${record.role} | expira: ${day(record.expiresAt, 'nunca')}`,
          ].join('\n'));
          return 0;
        }
        case 'list': {
          const records = store.list();
          if (cmd.json) io.out(JSON.stringify(records, null, 2));
          else io.out(records.length === 0 ? 'Nenhum token emitido.' : formatTable(records, clock.now()));
          return 0;
        }
        case 'revoke': {
          // A full token pasted by mistake is reduced to its public id and never echoed;
          // one pasted with a missing or an extra character is masked (slm_<id>_***).
          const id = tokenIdOf(cmd.id) ?? cmd.id;
          const outcome = store.revoke(id);
          if (outcome === 'not_found') {
            io.err(`Token ${maskTokens(id)} não encontrado.`);
            return 2;
          }
          io.out(outcome === 'revoked' ? `Token ${id} revogado.` : `Token ${id} já estava revogado.`);
          return 0;
        }
      }
    } finally {
      db.close();
    }
  } catch (err) {
    io.err(`Erro: ${maskTokens((err as Error).message)}`);
    return 1;
  }
}

process.exitCode = runTokensCli(process.argv.slice(2), process.env, {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
}, systemClock);
