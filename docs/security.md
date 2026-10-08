# Security

Threat model of a local MCP server that gives an agent access to a legacy customer API. The API is the authority for authentication, role and rate limit; the MCP server is its HTTP client and never touches the database. Decisions: ADRs 0002 to 0005.

## Risk, mitigation and test

| Risk | Source lesson | Mitigation | Test |
|---|---|---|---|
| A database leak exposes tokens | 203488 (`Map`, UUID) | Only SHA-256 in the database; token shown once | `tests/legacy-api/token-store.unit.test.ts` |
| Token leaked from a client | 203488 | Immediate revocation through the CLI, optional expiry, `slm_` prefix for scanning | `tests/legacy-api/tokens-cli.e2e.test.ts` |
| Token brute force | | 256 bits; IP bucket before authentication; generic 401 in all five cases | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/legacy-api/rate-limit.int.test.ts` |
| Role escalation by the client | 203487 | The role comes only from the token record; a `role` header or body is ignored | `tests/legacy-api/auth-rbac.int.test.ts` |
| Limit bypass with several tokens | 203490 | IP bucket added to the token bucket | `tests/legacy-api/rate-limit.int.test.ts` |
| Raw error reaches the model | 203479, 203483 | Error catalog; detail only on stderr | `tests/mcp/tool-errors.e2e.test.ts` (500 and invalid payload injected by the harness), `tests/mcp/define-tool.unit.test.ts` |
| Internal API error exposed to the HTTP client | | An unexpected failure becomes 500 `{"erro":"erro interno"}` with the detail only in the log; an unknown route gives 404 in the legacy format, after authentication. Only the `PUT` trap (API-04) returns the SQLite message, on purpose | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/legacy-api/customers.int.test.ts` |
| Arbitrary `requestId` in the API logs | | `genReqId` accepts only a UUID; anything else becomes a fresh UUID | `tests/legacy-api/auth-rbac.int.test.ts` |
| Several local clients share the IP bucket | 203490 | `x-ratelimit-scope` header and the note below | `tests/legacy-api/rate-limit.int.test.ts` |
| Token appears in a log | | Redaction by field name and by pattern (`slm_<id>_***`, also for a truncated token or one with an extra character); `redact` of `Authorization` in the API logger, proven with a serializer that deliberately logs the headers; a token pasted in the query string (`?token=`) is masked in the URL the API logs | `tests/mcp/stdout-clean.e2e.test.ts`, `tests/legacy-api/auth-rbac.int.test.ts`, `tests/shared/redact.unit.test.ts` |
| API password in the MCP log | | `LEGACY_API_URL` with `user:password@` is refused at startup (`config_invalid`, without echoing the value); `fetch` would refuse the URL anyway | `tests/mcp/config.unit.test.ts`, `tests/mcp/startup.e2e.test.ts` |
| Corrupted stdio protocol | 203479, 221518 | Logger on stderr, `console.*` redirected, a test that reads the raw stdout | `tests/mcp/stdout-clean.e2e.test.ts` |
| SQL injection through filters | 221515 | Prepared statements only; `LIKE` with `ESCAPE` | `tests/legacy-api/customers.int.test.ts` |
| Agent acts on the wrong customer | 221525 | `ambiguous` with no pick, tier 3 with `destructiveHint`, prompt with confirmation, no physical delete; a namesake with dirty legacy data stays among the candidates | `tests/mcp/tools-read.e2e.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| Agent repeats a write that was already applied | 221517 | A read-back that fails after an accepted write becomes `[READBACK_FAILED]` with the id and `retryable: false`, instead of an error that invites a retry | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts` |
| Prompt injection through customer data | 203473, 203470, 221517 | The server does not interpret data; `instructions` and `service-info` warn that customer fields are untrusted data; a `member` token cannot write, and with `admin` the write goes through tier 3 | Illustrated in step 10 of `npm run demo` (a seed customer whose name looks like an instruction, returned as plain JSON). As a defense, it cannot be tested without a real model |
| Huge input | | `bodyLimit` of 16 KiB, `maxToolInputElements: 64`, string limits in the schemas | `tests/legacy-api/customers.int.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| Blank name or name with an invisible character written by the agent | 200963 | Tool name fields trim the ends before the 2-character minimum and refuse control and bidirectional formatting characters, at no cost in the JSON Schema | `tests/mcp/customer-schemas.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| Package with unwanted files | 203491 | `files` whitelist and a tested manifest | `tests/repo/pack-manifest.unit.test.ts` |
| Versioned secret | | `.env` in `.gitignore`; only `.vscode/mcp.json` is versioned, with a password input; scan for the token pattern in every file outside `tests/` | `tests/repo/conventions.unit.test.ts` |

## Token lifecycle

```bash
npm run tokens -- issue --name vscode-flavio --role member --expires-in 30d   # shows slm_<id>_<secret> exactly once
npm run tokens -- list                                                         # id, name, role, created, last used, expires, status
npm run tokens -- revoke <id>                                                  # effective on the next request, no API restart
```

1. **Issue:** through the local CLI, with access to the database file (`--db`, `DATABASE_PATH` or `./data/legacy.db`). There is no issue route. Pick the smallest role that works: `member` reads, `admin` also writes.
2. **Delivery:** copy the token straight into VS Code's password input (`.vscode/mcp.json`) or into the local `.env` (outside Git). Never into a versioned file.
3. **Use:** every request checks the hash, the revocation and the expiry in the database, with no cache, and updates the last use. `list` shows tokens idle for a long time.
4. **Revocation:** `revoke <id>` (if the whole token is pasted, the CLI uses only the id and never echoes the secret; a pasted token with one character missing or extra shows up as `slm_<id>_***`). It is idempotent; an unknown id exits with code 2.
5. **Expiry:** optional, through `--expires-in <n>d|<n>h`. No expiry by default: a local service token is revoked when it falls out of use.

## IP bucket shared between local clients

The per-IP limit (180 per minute) counts every request from `127.0.0.1`. VS Code, Cursor, Claude Desktop, Inspector and the agent running at the same time share this bucket, even with different tokens. When the tool returns `[RATE_LIMITED]`, the `_meta` carries `scope`: `token` means that token went over 90 per minute; `ip` means the sum of the local clients went over 180. The limits are configurable on the API (`RATE_LIMIT_PER_TOKEN`, `RATE_LIMIT_PER_IP`, `RATE_LIMIT_WINDOW_MS`).

## What is not covered

- **TLS and CORS:** the API listens on `127.0.0.1` and is consumed by local processes. Exposing the API beyond loopback requires TLS, a CORS review and a second look at the `/v1/health` exception (D-28).
- **Distributed limiter:** the limit is in memory, resets on restart and is not shared between instances.
- **Burst at the window boundary:** the fixed window resets the counter when it expires, so up to twice the limit gets through within a few milliseconds (90 requests at the end of one window and 90 more at the start of the next). Acceptable for an API on `127.0.0.1`; a sliding window or a token bucket would close the gap (`tests/legacy-api/fixed-window-limiter.unit.test.ts` proves the behavior).
- **Defense against prompt injection:** the server marks the data as untrusted and limits the damage by role and by tier, but it does not stop a model from following malicious text. That depends on the client and the model.
- **Remote transport:** stdio only (ADR 0002). A remote MCP server would need to be an OAuth 2.1 resource server.
- **Compromise of the local machine:** whoever reads the `.env` or the database file administers the tokens.
- **Concurrency between clients:** writes read the customer and send the whole object in the `PUT` (a legacy requirement, with no ETag or `If-Match`). A change made by another client between the read and the `PUT` is overwritten.
