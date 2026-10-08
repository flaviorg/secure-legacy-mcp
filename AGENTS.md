# AGENTS.md

Instructions for coding agents (and people) working in this repository. Facts, not suggestions.

## Commands

```bash
npm ci                    # install; the esbuild postinstall warning is expected, do not approve scripts
npm test                  # the whole suite, no network (guard in tests/support/no-network.ts)
npm run typecheck         # tsc --noEmit (TypeScript 7)
npm run demo              # one-command demo: in-process API + MCP stdio + 10 steps
npm run bench:tokens      # regenerates the token table in the README and docs/token-comparison.md
npm run test:pack         # npm pack + npx from the tarball + tools/list with a real Client
npm run agent:demo        # LangChain agent with a fake model (optional extra)
npm run test:live         # agent with a real model; skips without OPENROUTER_API_KEY
npm run hooks:install     # once per clone: uses .githooks/pre-commit
```

Node 24 (`.nvmrc`). TypeScript runs directly on Node, with no build; relative imports use the `.ts` extension.

## Map

- `src/legacy-api/`: legacy API (Fastify + `node:sqlite`), tokens, RBAC, rate limit, CLI. Not in the package.
- `src/mcp/`: MCP server. Layers: `domain` (Zod schemas, errors, port) -> `infrastructure` (the only place with HTTP) -> `application` (service) -> `tools`, `resources`, `prompts`.
- `src/shared/`: logger, redaction, clock, token pattern. Imports neither `src/mcp` nor `src/legacy-api`.
- `scripts/`: demo, package verification, token comparison. `examples/agent/`: LangChain agent.
- `specs/`: constitution and SDD specs with EARS criteria. `docs/adr/`: decisions.

## Dependency rules (tested in tests/repo/conventions.unit.test.ts)

1. `src/mcp/**` never imports `src/legacy-api/**`.
2. `src/shared/**` imports neither `src/mcp` nor `src/legacy-api`.
3. `tools`, `resources` and `prompts` only call the service; the service only knows the `CustomerGateway` port; only `infrastructure` does HTTP.
4. In `src/` and `examples/`, only `main.ts`, `cli/tokens.ts` and `examples/agent/config.ts` read `process.env`.
5. No `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`). Function factories instead of stateful classes.

## MCP stdout

The MCP process's stdout is JSON-RPC only. `src/mcp` never uses `console.log`, `console.info`, `console.debug` or `process.stdout.write`. Logs go to stderr through the `Logger` (`src/shared/logger.ts`), one JSON line per event.

## Tests

- TDD: the test fails before the implementation.
- A test that proves an EARS criterion starts its name with `[ID]` (e.g. `[MCP-05] ...`). `conventions.unit` requires a test for every ID in `specs/*/spec.md` (exceptions: `PKG-02` in `scripts/verify-pack.ts`, `AGT-06` in `tests/live/agent.live.ts`).
- `npm test` never uses the network or a key. Each test creates its own `:memory:` API, its own tokens and its own MCP server, and cleans up with `t.after`.
- Suffixes: `*.unit.test.ts`, `*.int.test.ts`, `*.e2e.test.ts`; `tests/live/*.live.ts` stays out of `npm test`.
- Text equality only for constants: error catalog, prompts, `instructions`.

## Where each contract lives

- Tool error catalog: `src/mcp/domain/errors.ts` (`errorMessage`), formatted by `src/mcp/tools/define-tool.ts`.
- Domain schemas: `src/mcp/domain/customer.ts`. Legacy mapping: `src/mcp/infrastructure/legacy-mapper.ts`.
- Legacy API contract: `docs/legacy-api/openapi.json` (checked against the routes).

## Before committing

- If you changed a tool's `description`, `describe` or schema: run `npm run bench:tokens` before committing. `npm test` fails if the README table is out of date (BEN-02).
- The `.githooks/pre-commit` hook runs `npm run typecheck` and `npm test`.
- No `git push`, `npm publish` or remote repository until the project owner has validated.
- Exact dependency versions (`.npmrc` with `save-exact=true`). Runtime has only 3: `@modelcontextprotocol/sdk`, `zod`, `tsx`.
- No real token in any versioned file. In documentation, use `slm_<id>_<secret>`.

## Language and content

- Code, identifiers and model-facing text in English. README and documentation in English.
- Never copy course transcripts, slides or authored material. Lessons are cited only by ID and topic.
