# ADR 0006: `tsx` at runtime in the package

- **Status:** accepted (2026-10-04)

## Context

The project runs TypeScript directly on Node 24, with no build, as in the course repository. Node does not strip types from files inside `node_modules`, so an installed package with `src/mcp/*.ts` does not run with plain `node`. Lesson 203491 published the server with `bin` + shebang + `tsx`.

## Decision

- `bin/secure-legacy-mcp.js` has a shebang, calls `register()` from `tsx/esm/api` and imports `src/mcp/main.ts` (D-04).
- `tsx` 4.23.15 is one of the three runtime dependencies, at an exact version, next to the SDK and Zod.
- `files` publishes only `bin/`, `src/mcp/`, `src/shared/`, `README.md` and `LICENSE` (PKG-01). `npm run test:pack` builds the tarball, runs the binary with `npx --package <tgz>` and lists the 5 tools with a real `Client` (PKG-02).

## Consequences

- No build step and no divergence between the tested code and the published code.
- npm 11's `npm ci` warns that the `postinstall` of `esbuild` (a dependency of `tsx`) is not approved, and on macOS also the one from `fsevents`. The warning is expected: the `esbuild` binary comes from the platform's optional package (`@esbuild/<platform>`) and `tsx` works without the script (spec, Appendix B). The project does not approve install scripts.
- The first run through `npx` downloads `tsx` and `esbuild`: the package is heavier than a single bundle.
- Validated only on Node 24; on 22.x the binary probably works, but it is not tested (spec 003).

## Alternatives

- **esbuild bundle in `prepack`, a single `.mjs`:** a smaller package and no `tsx` at runtime, but a build step and an artifact that differs from the tested code. Plan B if `test:pack` fails on Node 24.
- **Compile with `tsc` to `dist/`:** the project uses `allowImportingTsExtensions` and `noEmit`; it would require rewriting the imports and maintaining two trees.
