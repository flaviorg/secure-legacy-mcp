# ADR 0005: Tool errors without `structuredContent`

- **Status:** accepted (2026-10-04)

## Context

In lesson 203490 the tool errors came back inside `structuredContent`. In SDK 1.32 that breaks: the `Client` validates `structuredContent` against the `outputSchema` whenever it is present, even with `isError: true`, and an error object does not match the success schema. Also, an exception thrown in the handler becomes `isError` with the raw message (for example `SQLITE_ERROR: ...`), checked in the types and at runtime (spec, Appendix A).

## Decision

- Every handler runs inside `defineTool`, which catches everything; nothing is thrown to the SDK.
- An error is `{ isError: true, content: [{ type: 'text', text: '[CODE] message' }], _meta: { 'secure-legacy-mcp/error': { code, retryable, requestId, retryAfterSeconds?, scope? } } }`, with no `structuredContent` (D-07).
- The text comes from a closed catalog of 11 codes (`src/mcp/domain/errors.ts`), in English, with no stack, SQL, URL or token. The detail (the API's raw body, masked and truncated to 500 characters, the exception stack) goes only to stderr, with the same `requestId`.
- `retryable` is true only for `RATE_LIMITED` and `UPSTREAM_UNAVAILABLE`.
- A write accepted by the API whose read-back fails becomes `[READBACK_FAILED]` with the customer id and `retryable: false` (MCP-17). Without this code, a network failure or a 429 on the read-back would become `UPSTREAM_UNAVAILABLE` or `RATE_LIMITED`, which invite a retry; retrying `createCustomer` would give `[CONFLICT]` ("another customer already uses this email"), a misleading message, because the customer is the same one.

## Consequences

- The model reads a stable prefix (`[FORBIDDEN]`, `[CONFLICT]`) and an actionable sentence; the client can decide on retries from `_meta`. `@langchain/mcp-adapters` hands this text to the agent as a `ToolMessage` with `status: 'error'`.
- The catalog texts are tested by exact equality (MCP-08), and the tests look for `SQLITE`, `Error:`, stacks and the token in every error text.
- Clients that only look at `structuredContent` do not see the structured error; they have to read `content` or `_meta`.

## Alternatives

- **Error inside `structuredContent` (the lesson):** rejected by the SDK 1.32 client itself.
- **`outputSchema` as a union of success and error:** pollutes every tool's schema and the token cost of the definitions, and the model would have to discriminate the union.
- **Throw and let the SDK format it:** leaks the raw message.
