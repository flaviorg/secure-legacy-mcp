# secure-legacy-mcp constitution

Principles that apply to every feature in this repository. A spec or a change that goes against one of them must say why, in writing, before the code.

## 1. Security before convenience

- The legacy API is the authority for authentication, role and rate limit. The MCP server never decides a role and never holds a secret other than its own `SERVICE_TOKEN`.
- Tokens only as a SHA-256 hash in the database, shown once. Errors never leak a stack, SQL, a URL with a secret or a token.
- Least privilege: whatever is irreversible (physical delete, reactivate, issue a token, change a role) does not exist as a tool.

## 2. Business actions, not endpoints

- The MCP server exposes what the user wants to do (resolve, search, create, update contact, deactivate), not a mirror of the routes.
- The legacy mapping (cryptic names, codes, `PUT` with the full object) lives in `infrastructure`. Business rules live in the service.

## 3. stdout is JSON-RPC only

- In the MCP process, stdout is the protocol channel. Logs are one JSON line per event on stderr.
- `src/mcp` does not use `console.log`, `console.info`, `console.debug` or `process.stdout.write`; one test scans the code and another reads the raw stdout.

## 4. TDD with the EARS ID in the test name

- Every acceptance criterion in `specs/NNN-*/spec.md` has an ID (`API-01`, `MCP-05`) and at least one test whose name starts with `[ID]`. `conventions.unit` checks this.
- The test fails before the implementation. Text equality only for constants (error catalog, prompts, `instructions`).

## 5. `npm test` with no network and no key

- The `tests/support/no-network.ts` guard blocks connections outside loopback, in the test process and in its children.
- Each test creates its own `:memory:` API, its own tokens and its own MCP server.

## 6. Honest fake

- The agent example's fake model follows a script, ignores the system prompt and throws an explicit error for input with no script. It proves the mechanics, not the quality of a model, and the README says so.
- The values the fake returns come from the real tool results.

## 7. Exact versions and few dependencies

- Three runtime dependencies, at exact versions (`.npmrc` with `save-exact=true`), a versioned lockfile, no `postinstall`, no third-party MCP server.

## 8. Nothing published without the owner's validation

- No `git push`, `npm publish` or remote repository until the project owner has validated. `npm pack` with `npx` from the tarball proves the binary without publishing.

## 9. Language

- Model-facing text (tool descriptions, errors, resources, server prompts) and code in English. README and documentation in `docs/` and `specs/` in English.
- Course lessons are cited only by ID and topic; no transcript, slide or authored material enters the repository.
