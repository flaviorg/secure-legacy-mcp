# ADR 0004: Own rate limiter, with an IP bucket and a token bucket

- **Status:** accepted (2026-10-04)

## Context

Lesson 203489 limited requests to 90 per minute per token with `@fastify/rate-limit`, falling back to the IP when there was no token. Lesson 203490 pointed out the bypass: whoever has several tokens multiplies the limit. The plugin takes one key per registration; the project wants two limits at once and deterministic tests.

## Decision

- A fixed-window limiter of its own (`fixed-window-limiter.ts`, about 50 lines), in memory, with an injectable clock. Each key's window starts at its first `hit`.
- Two buckets per request: **IP** (180 per 60 s) in the first `onRequest`, before authentication, which also slows brute-force 401s; **token** (90 per 60 s) after authentication.
- `x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-scope` (`ip` or `token`) headers from the bucket that decided the response; 429 with `retry-after`.
- `GET /v1/health` stays outside both buckets (D-28): a health check should not consume the limit, and the cost of abuse is low on an API at `127.0.0.1`.
- The MCP server translates the 429 into `[RATE_LIMITED]` with the limit, the wait in seconds and the scope in `_meta`.

## Consequences

- Three tokens on the same IP are stopped at the 181st request (SEC-06).
- Several local clients (editor, Inspector, agent) share the IP bucket, because they all come from `127.0.0.1`. `x-ratelimit-scope` shows which bucket blocked; `docs/security.md` explains.
- The limit resets when the API restarts, and is not shared between instances.
- Fixed window: a burst at the end of one window plus another at the start of the next lets through up to twice the limit within a few milliseconds. Accepted for a local API; a sliding window or a token bucket would close the gap.

## Alternatives

- **`@fastify/rate-limit`:** mature, but one key per registration; two registrations with different keys in the same app and the test clock would need workarounds. Revisit if a distributed store is ever needed (D-06).
- **Per token only:** reopens the multiple-token bypass and leaves token brute force unchecked before authentication.
