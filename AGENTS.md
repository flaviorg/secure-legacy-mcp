# AGENTS.md

Instruções para agentes de código (e pessoas) que mexem neste repositório. Fatos, não sugestões.

## Comandos

```bash
npm ci                    # instala; o aviso do postinstall do esbuild é esperado, não aprove scripts
npm test                  # suíte inteira, sem rede (guarda tests/support/no-network.ts)
npm run typecheck         # tsc --noEmit (TypeScript 7)
npm run demo              # demo de um comando: API em processo + MCP stdio + 10 passos
npm run bench:tokens      # regenera a tabela de tokens do README e docs/token-comparison.md
npm run test:pack         # npm pack + npx do tarball + tools/list com Client real
npm run agent:demo        # agente LangChain com modelo fake (extra opcional)
npm run test:live         # agente com modelo real; pula sem OPENROUTER_API_KEY
npm run hooks:install     # uma vez por clone: usa .githooks/pre-commit
```

Node 24 (`.nvmrc`). TypeScript roda direto no Node, sem build; imports relativos com extensão `.ts`.

## Mapa

- `src/legacy-api/`: API legada (Fastify + `node:sqlite`), tokens, RBAC, rate limit, CLI. Não vai no pacote.
- `src/mcp/`: servidor MCP. Camadas: `domain` (schemas Zod, erros, porta) -> `infrastructure` (único lugar com HTTP) -> `application` (service) -> `tools`, `resources`, `prompts`.
- `src/shared/`: logger, redação, relógio, padrão de token. Não importa `src/mcp` nem `src/legacy-api`.
- `scripts/`: demo, verificação do pacote, comparativo de tokens. `examples/agent/`: agente LangChain.
- `specs/`: constituição e specs SDD com critérios EARS. `docs/adr/`: decisões.

## Regras de dependência (testadas em tests/repo/conventions.unit.test.ts)

1. `src/mcp/**` nunca importa `src/legacy-api/**`.
2. `src/shared/**` não importa `src/mcp` nem `src/legacy-api`.
3. `tools`, `resources` e `prompts` só chamam o service; o service só conhece a porta `CustomerGateway`; só a `infrastructure` faz HTTP.
4. Em `src/` e `examples/`, só `main.ts`, `cli/tokens.ts` e `examples/agent/config.ts` leem `process.env`.
5. Sem `enum`, `namespace` nem parameter properties (`erasableSyntaxOnly`). Fábricas de funções no lugar de classes com estado.

## stdout do MCP

stdout do processo MCP é só JSON-RPC. `src/mcp` nunca usa `console.log`, `console.info`, `console.debug` nem `process.stdout.write`. Log vai para stderr pelo `Logger` (`src/shared/logger.ts`), uma linha JSON por evento.

## Testes

- TDD: o teste falha antes da implementação.
- Teste que prova um critério EARS começa o nome por `[ID]` (ex.: `[MCP-05] ...`). O `conventions.unit` exige um teste para cada ID dos `specs/*/spec.md` (exceções: `PKG-02` em `scripts/verify-pack.ts`, `AGT-06` em `tests/live/agent.live.ts`).
- `npm test` nunca usa rede nem chave. Cada teste cria a própria API `:memory:`, os próprios tokens e o próprio servidor MCP, e limpa com `t.after`.
- Sufixos: `*.unit.test.ts`, `*.int.test.ts`, `*.e2e.test.ts`; `tests/live/*.live.ts` fica fora do `npm test`.
- Igualdade de texto só para constantes: catálogo de erros, prompts, `instructions`.

## Onde fica cada contrato

- Catálogo de erros das tools: `src/mcp/domain/errors.ts` (`errorMessage`), formatado por `src/mcp/tools/define-tool.ts`.
- Schemas de domínio: `src/mcp/domain/customer.ts`. De-para do legado: `src/mcp/infrastructure/legacy-mapper.ts`.
- Contrato da API legada: `docs/legacy-api/openapi.json` (checado contra as rotas).

## Antes do commit

- Mudou `description`, `describe` ou schema de tool: rode `npm run bench:tokens` antes do commit. O `npm test` falha se a tabela do README estiver desatualizada (BEN-02).
- O hook `.githooks/pre-commit` roda `npm run typecheck` e `npm test`.
- Nada de `git push`, `npm publish` ou repositório remoto sem o dono do projeto validar.
- Dependências com versão exata (`.npmrc` com `save-exact=true`). Runtime tem só 3: `@modelcontextprotocol/sdk`, `zod`, `tsx`.
- Nenhum token real em arquivo versionado. Em documentação, use `slm_<id>_<segredo>`.

## Idioma e conteúdo

- Código, identificadores e textos voltados ao modelo em inglês. README e documentação em português.
- Nunca copie transcrição, slide ou material autoral do curso. Aulas são citadas só por ID e tema.
