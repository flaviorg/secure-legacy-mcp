# 003: Package, clients, token comparison and repository

Status: implemented (milestones M7, M8 and M10), with the manual VS Code check pending (see "Resolved questions"). Decisions: ADRs 0001 and 0006.

## Context

The MCP server ships as an `npx` package (a binary with `tsx`, `files` restricted to `bin/`, `src/mcp/`, `src/shared/`, `README.md` and `LICENSE`), validated with `npm pack` and `npx` from the tarball, without publishing. Only `.vscode/mcp.json` is versioned, asking for the token through a password input; Cursor and Claude Desktop stay as snippets in `docs/clients/README.md`. The token comparison measures the REST mirror generated from OpenAPI against the business actions. The repository carries its own process: `AGENTS.md`, `.env.example`, a pre-commit hook and a network guard in the tests.

## Acceptance criteria

**Package and clients**

- **PKG-01** When `npm pack` produces the tarball, it shall contain only `bin/`, `src/mcp/`, `src/shared/`, `package.json`, `README.md` and `LICENSE`.
- **PKG-02** When the tarball is installed in a temporary directory, the `secure-legacy-mcp` command run through `npx` shall answer `tools/list` to a real `Client` with the 5 tools.
- **PKG-03** `.vscode/mcp.json` shall be valid JSON and ask for the token through an `input` with `password: true`, and no versioned file outside `tests/` (including `docs/clients/README.md`) shall contain a string in the token format.
- **PKG-04** The code in `src/mcp` shall not import `src/legacy-api` nor use `console.log`, `console.info`, `console.debug` or `process.stdout.write`.

**Token comparison**

- **BEN-01** When the meter runs twice over the same code, it shall produce byte-for-byte identical output.
- **BEN-02** The block between `<!-- token-table:start -->` and `<!-- token-table:end -->` in the README shall equal the meter's output; otherwise, the test fails.
- **BEN-03** The REST mirror definitions shall be generated from `docs/legacy-api/openapi.json` by a pure function (no manual editing), and each OpenAPI operation shall exist as a route on the API, which has exactly the 7 routes from section 5.2 of the design spec.

**Repository**

- **REP-01** `AGENTS.md` shall have at most 100 lines.
- **REP-02** `.env.example` shall list every variable read by the API, MCP and agent config schemas.
- **REP-03** If any `npm test` test tries to connect to a host outside loopback, then the connection shall fail with an error from the network guard.
- **REP-04** The `.githooks/pre-commit` hook shall exist, be executable and run `npm run typecheck` and `npm test`, aborting the commit if either fails.

## Non-goals

| Out of scope | Reason |
|---|---|
| Publishing to npm or standing up Verdaccio | Nothing is published without the owner's validation; `npm pack` + `npx` from the tarball proves the binary |
| Versioned configs for Cursor and Claude Desktop | A versioned file with a token is the risk we want to avoid (D-17); they become snippets with the `slm_<id>_<secret>` placeholder |
| Low-level MCP server for the REST mirror | It would only echo the generated definitions; the comparison measures the JSON directly |
| Node version matrix in CI | Validated only on Node 24; `engines` declares `>=24` |
| Coverage gate | A good part of the code runs in a child process, without instrumentation; CI publishes the report with no minimum |
| Tests on Windows | Scripts are portable by construction, CI only on Ubuntu |

## Resolved questions

- **Node 22 is not declared.** Recorded floors: type stripping without a flag from 22.18, `node:sqlite` without a flag from 22.13, `--env-file-if-exists` from 22.9, and `@modelcontextprotocol/inspector` 2.9.0 requires 22.19. The binary runs through `tsx` and probably works on 22.x, but that is not tested.
- **`tsx` 4.23.15:** `import { register } from 'tsx/esm/api'; register();` in the binary loads `src/mcp/main.ts` with a top-level `await`, checked by `npm run test:pack` from the tarball. `npm ci` warns that the `postinstall` of `esbuild` (and that of `fsevents`, optional on macOS) is not approved; the warning is expected and `tsx` works without it (ADR 0006).
- **`npx --package <tgz>`** installs the package in its own cache (`~/.npm/_npx`); `verify-pack.ts`'s temporary directory only holds the tarball and serves as `cwd`, which is why the output says "temporary directory" and not "installed at". With the network guard in `NODE_OPTIONS`, an npm request fails with `NO_NETWORK` and npm falls back to the cache: locally `test:pack` passed without the network. In CI the cache starts cold and the `pack` job uses the network.
- **`gpt-tokenizer` 4.0.0:** `import { encode } from 'gpt-tokenizer/encoding/o200k_base'`, offline.
- **Comparison:** the real `tools/list` of the business actions also carries `outputSchema` and `annotations`. The table measures the three fields common to both variants (`name`, `description`, `inputSchema`) and a line below it gives the total with the extra fields. With the 30-customer seed, only 3 match the C2 filter, so C2b costs almost the same as C2a here.
- **Manual VS Code check (M7 criterion): pending.** VS Code is not installed on the machine where the project was built, and configuring Cursor or Claude Desktop instead would change persistent user configuration and require pasting a real token. Script for the owner: `npm run api`; `npm run tokens -- issue --name vscode --role member`; open the folder in VS Code; start `secure-legacy-mcp` from `.vscode/mcp.json`; paste the token into the password prompt; in a new chat, ask "find the customer teodoro". Record the date and VS Code version here, and fix in `docs/clients/README.md` any command names the check shows to be different. Meanwhile, the editor-independent part is automatic: `tests/mcp/client-config.e2e.test.ts` starts the server from the `.vscode/mcp.json` entry, with `${workspaceFolder}` and the password input filled in, and checks `tools/list` and `getCustomer`; `tests/repo/client-configs.unit.test.ts` checks the command (`node`, never `npm`), the path, the API's default address and the JSON snippets in `docs/clients/README.md`.
- **`git` in the construction shell:** in the interactive shell used, `git` was a function that failed; the commands used `/usr/bin/git`. The `hooks:install` script runs in `/bin/sh` and finds the normal `git`.

## Checklist

| Criterion | Test |
|---|---|
| PKG-01 | `tests/repo/pack-manifest.unit.test.ts` |
| PKG-02 | `scripts/verify-pack.ts` (`npm run test:pack`, outside `npm test`) |
| PKG-03, PKG-04 | `tests/repo/conventions.unit.test.ts` |
| BEN-01, BEN-02 | `tests/bench/token-table.int.test.ts` |
| BEN-03 | `tests/bench/mirror-tools.unit.test.ts`, `tests/bench/token-table.int.test.ts`, `tests/legacy-api/openapi-contract.int.test.ts` |
| REP-01, REP-02 | `tests/repo/conventions.unit.test.ts` |
| REP-04 | `tests/repo/conventions.unit.test.ts` (executable file), `tests/repo/pre-commit-hook.unit.test.ts` (the hook runs with a fake `npm` and aborts when the typecheck or the tests fail) |
| REP-03 | `tests/repo/no-network.unit.test.ts` |
| Every EARS ID has a test (CS-3) and each spec lists the full set of its IDs | `tests/repo/conventions.unit.test.ts` |
| Comparison caveats in the README and in `docs/token-comparison.md` (whole file generated) | `tests/bench/token-table.int.test.ts` |
| README sections (design spec 10.1), ADR structure, cited tests exist | `tests/repo/docs.unit.test.ts` |
