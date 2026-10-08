# ADR 0002: stdio only, no HTTP transport

- **Status:** accepted (2026-10-04)

## Context

SDK 1.32 offers three transports: stdio, Streamable HTTP and SSE. The server runs on the machine of whoever uses the editor or the agent, next to the local legacy API. Lesson 203492 compares the transports; stdio is also the transport of a server distributed as an npm package and started by the client itself.

| Transport | Where it runs | MCP client authentication | Status in SDK 1.32 |
|---|---|---|---|
| stdio | child process of the client, same machine | no network; the process inherits only the `env` the client passes | supported |
| Streamable HTTP | remote service, several sessions | the MCP authorization spec asks for the server to be an OAuth 2.1 resource server | supported, the current transport for remote |
| SSE | remote service | same | legacy, kept for compatibility |

## Decision

stdio only. The server receives a `SERVICE_TOKEN` through an environment variable and uses it to talk to the API, which is the authority for authentication, role and rate limit. No port opened by the MCP server.

## Consequences

- Security is demonstrated where it lives: in the API (hashed tokens, RBAC, two rate-limit buckets).
- One token per process: the demo starts one MCP process per token; each editor configures its own.
- stdout discipline becomes a tested requirement: stdout is the JSON-RPC channel, logs go to stderr (MCP-02, MCP-03).
- Remote, multi-user use is not served. If requested, it becomes a new spec.

## Alternatives

- **Streamable HTTP accepting the Service Token at the MCP server and forwarding it to the API:** this is the *token passthrough* anti-pattern from the *Security Best Practices* reading suggested in 203470: the MCP server would accept a token that was not issued for it and lose the audit boundary. Doing it right requires OAuth 2.1 with the MCP server as a resource server, a new scope for this project.
- **SSE:** the same authentication problem, and it is the legacy transport.
