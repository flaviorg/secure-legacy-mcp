# ADR 0006: `tsx` em runtime no pacote

- **Status:** aceito (2026-10-04)

## Contexto

O projeto roda TypeScript direto no Node 24, sem build, como no repositório do curso. O Node não remove tipos de arquivos dentro de `node_modules`, então um pacote instalado com `src/mcp/*.ts` não roda com `node` puro. A aula 203491 publicou o servidor com `bin` + shebang + `tsx`.

## Decisão

- `bin/secure-legacy-mcp.js` tem shebang, chama `register()` de `tsx/esm/api` e importa `src/mcp/main.ts` (D-04).
- `tsx` 4.23.15 é uma das três dependências de runtime, com versão exata, ao lado do SDK e do Zod.
- `files` publica só `bin/`, `src/mcp/`, `src/shared/`, `README.md` e `LICENSE` (PKG-01). O `npm run test:pack` gera o tarball, roda o binário com `npx --package <tgz>` e lista as 5 tools com um `Client` real (PKG-02).

## Consequências

- Sem etapa de build e sem divergência entre o código testado e o publicado.
- O `npm ci` do npm 11 avisa que o `postinstall` do `esbuild` (dependência do `tsx`) não está aprovado, e no macOS também o do `fsevents`. O aviso é esperado: o binário do `esbuild` vem do pacote opcional da plataforma (`@esbuild/<plataforma>`) e o `tsx` funciona sem o script (spec, Apêndice B). O projeto não aprova scripts de instalação.
- A primeira execução via `npx` baixa `tsx` e `esbuild`: o pacote fica maior que um bundle único.
- Validado só em Node 24; em 22.x o binário provavelmente funciona, mas não é testado (spec 003).

## Alternativas

- **Bundle com esbuild no `prepack`, num único `.mjs`:** pacote menor e sem `tsx` em runtime, mas uma etapa de build e um artefato diferente do código testado. Plano B se o `test:pack` falhar no Node 24.
- **Compilar com `tsc` para `dist/`:** o projeto usa `allowImportingTsExtensions` e `noEmit`; exigiria reescrever os imports e manter duas árvores.
