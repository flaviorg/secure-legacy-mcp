# Simulated legacy API

> **Summary:** a deliberately awkward legacy REST API (Fastify 5 + `node:sqlite`) with a real security layer: hashed service tokens, member/admin RBAC and two rate-limit buckets (per IP and per token). The MCP server in `src/mcp` is an HTTP client of this API. Contract: [`openapi.json`](./openapi.json), checked against the registered routes by `tests/legacy-api/openapi-contract.int.test.ts`.

The API imitates an old customer registry system: cryptic field names (`cst_nm`, `dt_cad`), codes (`A`/`I`, `1`/`2`/`3`), messages without accents and some deliberate traps. It is the authority for authentication, role and rate limit; the MCP server never accesses the database.

## How to start it

```bash
npm run api
```

It starts at `http://127.0.0.1:9999` with the database at `./data/legacy.db` (created with 30 fictional customers the first time). `npm run api` reads a `.env` at the root, if there is one.

| Variable | Default | Validation |
|---|---|---|
| `PORT` | `9999` | integer from 1 to 65535 |
| `HOST` | `127.0.0.1` | text |
| `DATABASE_PATH` | `./data/legacy.db` | path; `:memory:` for a throwaway database |
| `RATE_LIMIT_PER_TOKEN` | `90` | integer >= 1 |
| `RATE_LIMIT_PER_IP` | `180` | integer >= 1 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | integer >= 1000 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

With an invalid value the API does not start: it exits with code 1 and writes to stderr only the variable name and the reason, never the value.

## How to issue a token

Tokens are issued by the CLI, straight on the database file (the API can be running):

```bash
npm run tokens -- issue --name my-client --role member --expires-in 30d
npm run tokens -- list
npm run tokens -- revoke <id>
```

- `issue` shows the full token **exactly once**; the database keeps only its SHA-256. Roles: `member` (read-only) and `admin` (read and write). Without `--expires-in` (`<n>d` or `<n>h`), the token does not expire.
- `list` shows id, name, role, dates and status (`active`, `revoked`, `expired`); `--json` returns the same list as JSON. It never shows a hash or a token.
- `revoke` takes effect on the next request, with no API restart (the check queries the database on every request). Revoking again returns 0; an unknown id returns 2.
- `--db <path>` picks the database; without it, `DATABASE_PATH` applies, then `./data/legacy.db`.

The format is `slm_<id>_<secret>`: `<id>` is 8 public characters and `<secret>` is 43 base64url characters (256 random bits). The prefix makes secret scanning easier.

## `curl` examples

```bash
export SLM_TOKEN='slm_<id>_<secret>'   # the value printed by issue

curl -s http://127.0.0.1:9999/v1/health
curl -s http://127.0.0.1:9999/v1/auth/whoami -H "Authorization: Bearer $SLM_TOKEN"
curl -s 'http://127.0.0.1:9999/v1/customers?nm=teodoro&lim=6' -H "Authorization: Bearer $SLM_TOKEN"
curl -s 'http://127.0.0.1:9999/v1/customers?sts=A&seg=3&dt_de=20240101&dt_ate=20241231&lim=10' -H "Authorization: Bearer $SLM_TOKEN"
curl -s http://127.0.0.1:9999/v1/customers/12 -H "Authorization: Bearer $SLM_TOKEN"

# write: requires an admin token
curl -s -X POST http://127.0.0.1:9999/v1/customers -H "Authorization: Bearer $SLM_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"cst_nm":"New Customer","cst_phn":"11900000099","cst_eml":"new.customer@example.com","cst_seg":2}'
```

Use `curl -i` to see the `x-request-id` and `x-ratelimit-*` headers.

## Routes

| Method and route | Role | Responses |
|---|---|---|
| `GET /v1/health` | public | 200 `{"status":"UP"}` |
| `GET /v1/auth/whoami` | any | 200 `{"tokenId","name","role"}` |
| `GET /v1/customers` | any | 200 `{"qtd": <filtered total>, "dados": [...]}`; 400 `{"erro":"parametro invalido: <name>"}` |
| `GET /v1/customers/:id` | any | 200 with the customer object; 404 `{"msg":"nao encontrado"}` |
| `POST /v1/customers` | admin | 201 `{"id": n, "msg": "cadastrado"}`; 409 `{"erro":"email duplicado"}`; 400 (Fastify's default body, trap 9) |
| `PUT /v1/customers/:id` | admin | 200 `{"id": n, "msg": "atualizado"}`; 404; 409; 400 |
| `DELETE /v1/customers/:id` | admin | 200 `{"id": n, "msg": "removido"}`; 404 |

Any route: 500 `{"erro":"erro interno"}` on an unexpected failure (the detail goes only to the log; trap 6 is the only exception) and, for a route that does not exist, 404 `{"msg":"nao encontrado"}` after authentication.

The legacy API's response bodies keep their original Portuguese keys and messages on purpose (`qtd`, `dados`, `erro`, `msg`), as part of the legacy contract.

Listing filters: `nm` (part of the name, accent- and case-insensitive), `eml` (exact, case-insensitive), `phn` (digits only, exact), `sts` (`A`/`I`), `seg` (`1` retail, `2` smb, `3` enterprise), `dt_de` and `dt_ate` (`YYYYMMDD`, inclusive), `lim` (1 to 500) and `off` (>= 0). Order: normalized name and `cst_id`.

## Deliberate traps

Legacy system behaviors kept on purpose; the MCP server is what hides them behind the business actions.

1. `GET /v1/customers` without `lim` returns **all** the filtered customers.
2. Unknown parameters (for example `name=`) are **silently ignored**: the listing comes back without that filter.
3. The listing has an envelope (`qtd`, `dados`); `GET /v1/customers/:id` returns the object **with no envelope**.
4. `POST` returns only the id, not the created object.
5. `PUT` requires the **full** object (`cst_nm`, `cst_phn`, `cst_eml`, `cst_sts`, `cst_seg`); a missing field gives 400.
6. If the `PUT` body contains `cst_id`, the API answers **500 with the raw SQLite message**, like the update-with-id-in-the-body case seen in lesson 203485 (`PUT` with the full object).
7. `DELETE` is physical. The MCP server does not expose it.
8. Cryptic field names and messages without accents (`nao encontrado`, `parametro invalido`).
9. Body errors (400 for validation or malformed JSON, 413) come in Fastify's default format, in English (`statusCode`, `code`, `error` and `message`, which on validation names the field), unlike the `{"erro": ...}` of the other responses.

## Security

Hook order on each request: IP bucket, authentication, token bucket and, on write routes, the role.

- **401** `{"erro":"nao autorizado"}`: the same body for a missing, malformed, unknown, revoked or expired token.
- **403** `{"erro":"proibido","papel_necessario":"admin"}`: a `member` token on `POST`, `PUT` or `DELETE`. The role comes only from the token record in the database; `role` headers or fields sent by the client are ignored.
- **429** `{"erro":"limite excedido"}` with `retry-after` in seconds.
- **Limits:** 90 requests per token and 180 per IP every 60 s, in a fixed window (at the window rollover, up to twice the limit gets through in sequence; see `docs/security.md`). The IP bucket counts before authentication, including requests that end in 401. `GET /v1/health` is outside both buckets.
- **Limit headers:** every response from a protected route carries `x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-scope` (`ip` or `token`) of the bucket that decided: `ip` on an IP 429 and on a 401; `token` on the rest.
- **Clients on the same machine:** VS Code, Inspector, the demo and the agent running locally share the 180 requests per minute of `127.0.0.1`. A 429 with `x-ratelimit-scope: ip` can show up even with each token under 90.
- **`x-request-id`:** the API adopts the received value only if it is a UUID; otherwise it generates a new one. The final value comes back in the response header and appears in the logs.
- **Logs:** one JSON line per event (pino), with the `Authorization` header redacted, tokens masked in the logged URL (`?token=slm_<id>_***`, if someone pastes the token in the query string; it does not authenticate) and one `audit` line per write (`tokenId`, `role`, method, route and status).
- **Port in use:** the API exits with code 1 and a short line (`port 9999 in use on 127.0.0.1; pick another one with PORT`), with no stack.
- **Body:** at most 16 KiB (413 above that). The IP comes from the socket; `X-Forwarded-For` is ignored.
