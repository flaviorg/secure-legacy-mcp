# 001: Legacy API and security layer

Status: implemented (milestones M1, M2 and M3). Full design: `docs/legacy-api/README.md`, `docs/security.md` and ADRs 0003 and 0004.

## Context

A simulated customer REST API, hostile to agents on purpose: cryptic fields (`cst_nm`, `dt_cad`), `A`/`I` status, `1`/`2`/`3` segment, an unbounded listing and a `PUT` that returns a raw 500 if the body carries `cst_id`. On top of it, a real security layer: Service Tokens with SHA-256 hashes and revocation in `node:sqlite`, a local CLI to issue, list and revoke, `member`/`admin` RBAC with the role coming only from the database, and rate limiting with two buckets (token and IP). It is the authority the MCP server (spec 002) consumes.

## Acceptance criteria

**Legacy API**

- **API-01** When it receives `GET /v1/customers` with any combination of `nm`, `eml`, `phn`, `sts`, `seg`, `dt_de` and `dt_ate`, the API shall apply all the filters in the prepared SQL query and return in `qtd` the filtered total before `lim` and `off`.
- **API-02** When `nm` contains `%` or `_`, the API shall treat them as literal characters.
- **API-03** When `nm` comes without accents or in another case, the API shall find the matching accented names.
- **API-04** If the body of `PUT /v1/customers/:id` contains `cst_id`, then the API shall answer 500 with the raw SQLite message (a documented legacy trap).
- **API-05** When the API starts with the `customers` table empty, it shall insert the 30 seed customers; when there are already customers, it shall insert nothing.
- **API-06** If a known parameter has an invalid value, then the API shall answer 400 naming the parameter; unknown parameters shall be ignored.
- **API-07** When `GET /v1/customers` comes without `lim`, the API shall return all the filtered customers (legacy behavior preserved).
- **API-08** When an authenticated request reaches a route that does not exist, the API shall answer 404 with `{"msg":"nao encontrado"}`, without echoing the URL.

**Security**

- **SEC-01** When the CLI issues a token, the system shall store only the token's SHA-256 and show it in clear text exactly once.
- **SEC-02** When a route outside the allowlist receives a request with no Bearer, or with a malformed, unknown, revoked or expired token, the API shall answer 401 with the same generic body in all five cases.
- **SEC-03** When a `member` token calls `POST`, `PUT` or `DELETE`, the API shall answer 403 with `papel_necessario: "admin"`.
- **SEC-04** The API shall decide the role exclusively from the token record in the database, ignoring any role sent in a header or body.
- **SEC-05** When the same token makes the 91st request within 60 s, the API shall answer 429 with `retry-after`, `x-ratelimit-limit` and `x-ratelimit-remaining`.
- **SEC-06** When the same IP adds up to the 181st request in 60 s, even if spread across different tokens, the API shall answer 429.
- **SEC-07** When `revoke <id>` is executed, the next request with that token shall receive 401, without restarting the API.
- **SEC-08** The CLI and the API shall never show the hash nor, after issue, the token, not even part of the secret of a pasted token with one character missing or extra.
- **SEC-09** The API logs shall not contain the value of the `Authorization` header, nor a token sent in the query string.
- **SEC-10** While the current date is later than `expires_at`, the API shall treat the token as invalid (401).
- **SEC-11** If `revoke` receives an unknown id, then the CLI shall exit with code 2 and a clear message.
- **SEC-12** The API shall send `x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-scope` of the bucket that decided the response, and `GET /v1/health` shall not consume any bucket.
- **SEC-13** When the received `x-request-id` header is not a UUID, the API shall generate a new UUID as `requestId`; when it is, it shall adopt it and return it in the response.
- **SEC-14** If a route or a hook fails with an unexpected error (outside the API-04 trap), then the API shall answer 500 with `{"erro":"erro interno"}`, with no internal message, code or stack, and log the detail only in the log.

## Non-goals

| Out of scope | Reason |
|---|---|
| Login with user and password, JWT and a public token-issue route | The MCP server only uses a Service Token; issuing stays in the local CLI with access to the database file. Less attack surface |
| Distributed rate limit (Redis), several instances | In-memory limiter, resets on restart; documented in `docs/security.md` |
| CORS and TLS on the API | API on `127.0.0.1`, consumed by a local process |
| Database migration framework | Idempotent schema (`CREATE TABLE IF NOT EXISTS`) at startup |
| Web interface, Docker | They do not increase the impact of this project |

## Resolved questions

Checked against the installed packages (Node 24.21.0, `fastify` 5.12.5) during construction:

- `Fastify({ requestIdHeader: false, genReqId(req), bodyLimit: 16384, trustProxy: false })`: `genReqId` receives the raw request (`req.headers`); `app.inject({ remoteAddress })` changes `request.ip`; `app.hasRoute({ method, url })` exists.
- Fastify validates the body **before** `preHandler`. With RBAC in `preHandler`, a `member` sending `{}` would get 400 and learn the schema. `requireRole` runs in `preValidation`, which comes after parsing and before validation.
- `decorateRequest('x', null)` works for `caller` and `rateLimit`; `printRoutes({ commonPrefix: false })` lists one path per line (used by the OpenAPI contract test); `logger: { level, stream, redact }` accepts `redact` as an array; an `onSend` also receives the responses sent by `onRequest` hooks (401 and 429).
- `node:sqlite`: `new DatabaseSync(path, { timeout: 5000 })`; `PRAGMA journal_mode=WAL` returns `memory` on `:memory:` and `wal` on a file; errors have `code: 'ERR_SQLITE_ERROR'` and `errcode` (2067 for UNIQUE; the syntax error from the `PUT` trap has `errcode` 1, not the 2067 in the plan's table).
- The API's body schemas do not use `additionalProperties: false`: Ajv's `removeAdditional` would delete `cst_id` and the `PUT` trap (API-04) would not fire.
- Fastify's pino writes to the API process's stdout. In the tests and in the demo, `startLegacyApi` uses `logger: false`, so the API log never shares stdout with a stdio MCP server.
- Expiry holds with `expires_at <= now` (the exact millisecond falls on the invalid side).
- In a root `setErrorHandler`, rethrowing the error hands it to Fastify's default handler: Fastify's own 4xx (body validation, malformed JSON, 413) keep the default body. Unknown routes go through the `onRequest` hooks before `setNotFoundHandler`, so an anonymous caller gets 401. The default 404 handler echoes the URL (with the query string) in the body.
- Fastify merges the `serializers` it receives over its own, and the default `req` serializer logs `req.url` with the query string. `buildApp` uses the same fields as the default (or the received serializer) and masks tokens in the URL.

## Checklist

| Criterion | Test |
|---|---|
| API-01 to API-08 | `tests/legacy-api/customers.int.test.ts` |
| SEC-01, SEC-07, SEC-08 | `tests/legacy-api/token-store.unit.test.ts`, `tests/legacy-api/tokens-cli.e2e.test.ts` |
| SEC-02, SEC-03, SEC-04, SEC-13, SEC-14 | `tests/legacy-api/auth-rbac.int.test.ts` |
| SEC-05 | `tests/legacy-api/fixed-window-limiter.unit.test.ts`, `tests/legacy-api/rate-limit.int.test.ts` |
| SEC-06, SEC-12 | `tests/legacy-api/rate-limit.int.test.ts` |
| SEC-09 | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/shared/redact.unit.test.ts` |
| SEC-10 | `tests/legacy-api/token-store.unit.test.ts` |
| SEC-11 | `tests/legacy-api/tokens-cli.e2e.test.ts` |
