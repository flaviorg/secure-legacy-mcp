# ADR 0003: Service Tokens with SHA-256 in SQLite

- **Status:** accepted (2026-10-04)

## Context

In lesson 203488 the tokens lived in an in-memory `Map` and were UUIDs, issued by a public route protected by a fixed secret. The lesson itself named the risks: a restart loses everything, a memory or database leak exposes usable tokens, and there is no revocation or expiry. The environment has no Docker; Node 24 ships `node:sqlite`.

## Decision

- Format `slm_<id>_<secret>`: an 8-character `[a-z0-9]` id (`crypto.randomInt`) and a secret of 32 random bytes in base64url (43 characters, 256 bits). The `slm_` prefix helps secret scanning.
- The database stores only `sha256(token)` in hex, with `name`, `role`, `created_at`, `last_used_at`, `expires_at` and `revoked_at`. The token appears in clear text once, at issue time.
- Verification on every request, with no cache: regex, id, row lookup, `timingSafeEqual` of the hashes, `revoked_at`, `expires_at`; it updates `last_used_at` (D-14). Revocation takes effect on the next request.
- Issuing, listing and revoking only through the local CLI (`npm run tokens`), with access to the database file. No issue route. Optional expiry (`--expires-in`), never by default (D-10).
- `DatabaseSync(path, { timeout: 5000 })` and WAL on a file, so the CLI and the API can write to the same file without `SQLITE_BUSY`.

## Consequences

- A database leak does not hand over usable tokens. Revocation is immediate, with no restart (SEC-07, tested with the API running).
- Whoever has access to the database file administers tokens: this is the lesson's "admin panel with strong login", replaced by local access.
- `last_used_at` written on every request costs one write per call; acceptable on a local SQLite with demo volume.

## Alternatives

- **argon2 or bcrypt:** a slow hash protects low-entropy secrets (passwords). A random 256-bit secret cannot be brute-forced, and the slow hash would only add latency to every request (D-09).
- **HMAC with a pepper:** protects against someone who reads the database but not the pepper; it would require managing one more secret, with no real gain for 256-bit tokens.
- **JWT:** revocation needs a blocklist or a short expiry; the MCP server does not need a self-contained token.
