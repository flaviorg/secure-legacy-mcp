# 002: MCP server with business actions

Status: implemented (milestones M4, M5 and M6). Decisions: ADRs 0001, 0002 and 0005.

## Context

A stdio MCP server, an HTTP client of the legacy API (spec 001), that exposes 5 business actions in place of the 7 routes: `getCustomer` (resolves by id, email, phone or name, with `found`, `ambiguous` or `none`), `searchCustomers` (database-side filters and a cursor), `createCustomer`, `updateCustomerContact` and `deactivateCustomer` (idempotent, no physical delete). Also 1 static resource (`customers://service-info`), 1 resource template (`customers://customers/{id}`), 3 prompts and `instructions`. Layers `domain`, `infrastructure`, `application`, `tools`, `resources` and `prompts`; stdout is JSON-RPC only.

## Acceptance criteria

- **MCP-01** If `SERVICE_TOKEN` is missing or malformed, or if `LEGACY_API_URL` carries credentials (`user:password@`), then the server shall exit with code 1, write to stderr a message that names the variable without echoing the value, and write nothing to stdout.
- **MCP-02** While the server is running, stdout shall contain only valid JSON-RPC 2.0 messages, one per line.
- **MCP-03** The server shall write logs to stderr as one JSON line per event with `ts`, `level`, `component` and `event`, and no log shall contain a full token.
- **MCP-04** When the client calls `tools/list`, the server shall list exactly `getCustomer`, `searchCustomers`, `createCustomer`, `updateCustomerContact` and `deactivateCustomer`, each with `description`, `inputSchema`, `outputSchema` and the annotations from section 5.4 of the design spec.
- **MCP-05** When `getCustomer` receives criteria that match more than one customer, the server shall return `match: "ambiguous"`, `customer: null` and at most 5 candidates.
- **MCP-06** When `getCustomer` or `searchCustomers` query the legacy listing, the gateway shall send the filters and a `lim` of at most 50, never a listing without `lim`.
- **MCP-07** When `updateCustomerContact` or `deactivateCustomer` write, the `PUT` body shall contain all the required fields and never `cst_id`.
- **MCP-08** When the API answers 401, 403, 404, 409, 429 or 5xx, or is unreachable, the tool shall return `isError: true`, a `[CODE] ...` text from the catalog and `_meta` with `code` and `retryable`, without `structuredContent`, and the text shall not contain a stack, `SQLITE`, `Error:` or the token.
- **MCP-09** When `deactivateCustomer` receives an already inactive customer, or `updateCustomerContact` receives values equal to the current ones, the server shall not send a `PUT` and shall signal this in the output (`alreadyInactive: true` or `changed: []`).
- **MCP-10** When a read fails because of the network, a timeout or a 5xx, the gateway shall retry exactly once; writes, 4xx or 429 responses and invalid payloads shall not be retried; each attempt shall be aborted on reaching `LEGACY_API_TIMEOUT_MS`, so a read lasts at most 2 x `LEGACY_API_TIMEOUT_MS`.
- **MCP-11** When the client reads `customers://service-info`, the server shall include the current token's role; if the API is unreachable, it shall return the document with role `unknown`, with no error.
- **MCP-12** When the client reads `customers://customers/{id}` with an unknown id, the server shall answer with the error `Customer <id> not found`, with no internal detail.
- **MCP-13** When the client calls `prompts/get` for each of the 3 prompts, the server shall return exactly the text defined in the code, with the arguments interpolated.
- **MCP-14** If a handler hits an unexpected exception, then the tool shall return `[INTERNAL]` with `requestId` and log the detail only on stderr.
- **MCP-15** If the API returns a payload outside the legacy schema or a body that is not JSON, then the server shall answer `[UPSTREAM_CONTRACT]` and keep serving the following calls; a record within the legacy schema (for example, a 1-character name or an email without `@`, which the API accepts) shall be returned as is, without breaking the read or the page.
- **MCP-16** If `searchCustomers` receives a malformed cursor or one issued for other filters, then the server shall answer `[INVALID_INPUT]` with `cursor does not match the current filters`; when there are no more pages, `nextCursor` shall be `null`.
- **MCP-17** If the API accepts a write (`createCustomer`, `updateCustomerContact` or `deactivateCustomer`) and the customer read-back fails, then the tool shall return `[READBACK_FAILED]` with the customer id and `retryable: false`, saying the write was applied and must not be repeated.
- **MCP-18** If `createCustomer.name`, `getCustomer.name` or `searchCustomers.nameContains` have fewer than 2 characters after trimming the ends, or contain a control or bidirectional formatting character, then the tool shall refuse the call with an input validation error, without calling the API; valid names proceed without the leading and trailing spaces.

## Non-goals

| Out of scope | Reason |
|---|---|
| Streamable HTTP or SSE transport | ADR 0002: doing remote HTTP right requires the MCP server as an OAuth 2.1 resource server; the shortcut would be *token passthrough* |
| Physical delete, reactivating a customer, issuing a token or changing a role through MCP | Tier 4 of the Autonomy Matrix: forbidden by construction; stays with the administrator (CLI and API) |
| Hiding write tools from `member` tokens | It would require looking up the role at startup; the API is the authority and the 403 becomes `[FORBIDDEN]` |
| 1:1 CRUD over the routes | The business action hides the legacy mapping and traps (ADR 0001) |
| Concurrency control on writes | The legacy `PUT` requires the whole object and the API has no ETag or `If-Match`: a change made by another client between the read and the `PUT` is overwritten. Recorded in the README's limitations |
| Validating name and email on output | The legacy API accepts any non-empty name and email; the format rules apply only to the tools' input (MCP-15) |

## Resolved questions

Checked against the installed `@modelcontextprotocol/sdk` 1.32.0 and `zod` 4.6.5:

- `registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb)` accepts a Zod 4 `ZodObject`, including with `.refine()`, which runs on the server. The refusal arrives with the `MCP error -32602:` prefix before `Input validation error`; tests use `assert.match`.
- With a generic schema, `registerTool`'s conditional callback type does not resolve: `defineTool` registers with `registerTool<z.ZodObject, z.ZodObject>` and narrows the already validated input.
- The client validates `structuredContent` against the `outputSchema` whenever it is present, even with `isError` (ADR 0005). `isError` without `structuredContent` passes and the `_meta` reaches the client.
- An exception thrown in the handler becomes `isError` with the raw message; that is why `defineTool` catches everything.
- `maxToolInputElements: 64` refuses with `MCP error -32602: Invalid arguments for tool <name>: arguments contain more than the maximum of 64 elements`.
- `McpError(ErrorCode.InvalidParams, msg)` in a resource arrives as code -32602 with the `MCP error -32602:` prefix twice. A template with `list: undefined` does not show up in `listResources`.
- Schema conversion is `toJSONSchema(schema, { target: 'draft-7', io: 'input' })`, without `override`: `z.email()` and `z.iso.date()` emit long `pattern`s, hence the `emailField` and `isoDateField` helpers (D-25; numbers in ADR 0001). `z.number().int()` also emits `minimum: -9007199254740991`.
- `StdioClientTransport` adds `getDefaultEnvironment()` (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`) to the explicit `env`. `client.close()` closes stdin, waits 2 s and only then sends `SIGTERM`; that is why `main.ts` also shuts down at the end of stdin.
- `Protocol.connect` chains the `onmessage`, `onerror` and `onclose` already set on the transport; the demo relies on this to also count the `initialize` response.
- Node's default `warning` listener can be removed: warnings become `node_warning` logger lines and all of stderr stays JSON.
- stdout and stderr are separate pipes: a log line written before the response can arrive after it. The tests wait for log lines with `waitForStderr`.
- On macOS, `process.exit` can cut off a pending write to stderr on a pipe. The config failure uses `process.exitCode = 1`, and the crash uses a synchronous write to fd 2.
- `node --env-file-if-exists=.env` without a `.env` writes `.env not found. Continuing without it.` to stderr (not stdout). The JSON-RPC channel is not affected; the tests start `main.ts` directly.
- `npm run mcp` writes the npm banner (`> secure-legacy-mcp@0.1.0 mcp`) to stdout before the server; `npm run -s mcp` does not. Clients start `node src/mcp/main.ts` or the binary, never the npm script.
- Node's `fetch` refuses a URL with credentials, and Zod 4 runs `z.url()`'s `.refine()` even when the format has already failed (so the credentials check uses `URL.parse` and accepts what is not a URL).
- The SDK validates `structuredContent` against the `outputSchema` on the server and on the client: an output field with the input rules would refuse a valid legacy record (MCP-15).
- In Zod 4, `.trim()` runs before `.min()` in chain order, and neither it nor `.refine()` enters the JSON Schema: the MCP-18 name rule changes neither `tools/list` nor the token comparison. The refusal arrives as `MCP error -32602: Input validation error: ... at name`.

## Checklist

| Criterion | Test |
|---|---|
| MCP-01 | `tests/mcp/config.unit.test.ts`, `tests/mcp/startup.e2e.test.ts` |
| MCP-02 | `tests/mcp/stdout-clean.e2e.test.ts` |
| MCP-03 | `tests/mcp/stdout-clean.e2e.test.ts`, `tests/shared/logger.unit.test.ts`, `tests/shared/redact.unit.test.ts` |
| MCP-04 | `tests/mcp/tools-read.e2e.test.ts` |
| MCP-05 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-06 | `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-07 | `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/legacy-mapper.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| MCP-08 | `tests/mcp/tool-errors.e2e.test.ts`, `tests/mcp/define-tool.unit.test.ts`, `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/customer-schemas.unit.test.ts` |
| MCP-09 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| MCP-10 | `tests/mcp/legacy-gateway.unit.test.ts` |
| MCP-11 | `tests/mcp/resources-prompts.e2e.test.ts`, `tests/mcp/service-info.unit.test.ts` |
| MCP-12, MCP-13 | `tests/mcp/resources-prompts.e2e.test.ts` |
| MCP-14 | `tests/mcp/define-tool.unit.test.ts` |
| MCP-15 | `tests/mcp/legacy-mapper.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-16 | `tests/mcp/cursor.unit.test.ts`, `tests/mcp/customer-service.unit.test.ts` |
| MCP-17 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts` |
| MCP-18 | `tests/mcp/customer-schemas.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| One-command demo (CS-1) | `tests/demo/demo.e2e.test.ts` |
