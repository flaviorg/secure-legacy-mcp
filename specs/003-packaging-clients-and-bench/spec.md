# 003: Pacote, clientes, comparativo de tokens e repositório

Status: implementado (marcos M7, M8 e M10), com a verificação manual no VS Code pendente (ver "Dúvidas resolvidas"). Decisões: ADRs 0001 e 0006.

## Contexto

O servidor MCP sai como pacote `npx` (binário com `tsx`, `files` restrito a `bin/`, `src/mcp/`, `src/shared/`, `README.md` e `LICENSE`), validado com `npm pack` e `npx` do tarball, sem publicar. Só o `.vscode/mcp.json` é versionado, pedindo o token por input de senha; Cursor e Claude Desktop ficam como trechos em `docs/clients/README.md`. O comparativo de tokens mede o espelho REST gerado do OpenAPI contra as ações de negócio. O repositório carrega o próprio processo: `AGENTS.md`, `.env.example`, hook de pre-commit e guarda de rede nos testes.

## Critérios de aceite

**Pacote e clientes**

- **PKG-01** Quando `npm pack` gerar o tarball, ele deve conter apenas `bin/`, `src/mcp/`, `src/shared/`, `package.json`, `README.md` e `LICENSE`.
- **PKG-02** Quando o tarball for instalado num diretório temporário, o comando `secure-legacy-mcp` executado via `npx` deve responder `tools/list` a um `Client` real com as 5 tools.
- **PKG-03** O `.vscode/mcp.json` deve ser JSON válido e pedir o token por `input` com `password: true`, e nenhum arquivo versionado fora de `tests/` (inclusive `docs/clients/README.md`) deve conter uma string com formato de token.
- **PKG-04** O código em `src/mcp` não deve importar `src/legacy-api` nem usar `console.log`, `console.info`, `console.debug` ou `process.stdout.write`.

**Comparativo de tokens**

- **BEN-01** Quando o medidor rodar duas vezes sobre o mesmo código, ele deve produzir saída byte a byte idêntica.
- **BEN-02** O bloco entre `<!-- token-table:start -->` e `<!-- token-table:end -->` no README deve ser igual à saída do medidor; caso contrário, o teste falha.
- **BEN-03** As definições do espelho REST devem ser geradas de `docs/legacy-api/openapi.json` por uma função pura (sem edição manual), e cada operação do OpenAPI deve existir como rota na API, que tem exatamente as 7 rotas da seção 5.2 da spec de design.

**Repositório**

- **REP-01** `AGENTS.md` deve ter no máximo 100 linhas.
- **REP-02** `.env.example` deve listar toda variável lida pelos schemas de config da API, do MCP e do agente.
- **REP-03** Se qualquer teste do `npm test` tentar conectar a um host fora de loopback, então a conexão deve falhar com erro da guarda de rede.
- **REP-04** O hook `.githooks/pre-commit` deve existir, ser executável e rodar `npm run typecheck` e `npm test`, abortando o commit se algum falhar.

## Non-goals

| Fora do escopo | Motivo |
|---|---|
| Publicar no npm ou subir Verdaccio | Nada é publicado sem validação do dono; `npm pack` + `npx` do tarball prova o binário |
| Configs versionadas para Cursor e Claude Desktop | Arquivo versionado com token é o risco que se quer evitar (D-17); viram trechos com placeholder `slm_<id>_<segredo>` |
| Servidor MCP low-level para o espelho REST | Ele só ecoaria as definições geradas; o comparativo mede o JSON direto |
| Matriz de versões do Node no CI | Validado só em Node 24; `engines` declara `>=24` |
| Portão de cobertura | Boa parte do código roda em processo filho, sem instrumentação; o CI publica o relatório sem limite mínimo |
| Testes em Windows | Scripts portáveis por construção, CI só em Ubuntu |

## Dúvidas resolvidas

- **Node 22 não é declarado.** Pisos registrados: type stripping sem flag a partir de 22.18, `node:sqlite` sem flag a partir de 22.13, `--env-file-if-exists` a partir de 22.9, e o `@modelcontextprotocol/inspector` 2.9.0 exige 22.19. O binário roda via `tsx` e provavelmente funciona em 22.x, mas isso não é testado.
- **`tsx` 4.23.15:** `import { register } from 'tsx/esm/api'; register();` no binário carrega `src/mcp/main.ts` com `await` de topo, conferido pelo `npm run test:pack` a partir do tarball. O `npm ci` avisa que o `postinstall` do `esbuild` (e o do `fsevents`, opcional no macOS) não está aprovado; o aviso é esperado e o `tsx` funciona sem ele (ADR 0006).
- **`npx --package <tgz>`** instala o pacote no próprio cache (`~/.npm/_npx`); o diretório temporário do `verify-pack.ts` só guarda o tarball e serve de `cwd`, por isso a saída diz "diretório temporário" e não "instalado em". Com a guarda de rede no `NODE_OPTIONS`, um pedido do npm falha com `NO_NETWORK` e o npm cai no cache: localmente o `test:pack` passou sem rede. No CI o cache começa frio e o job `pack` usa a rede.
- **`gpt-tokenizer` 4.0.0:** `import { encode } from 'gpt-tokenizer/encoding/o200k_base'`, offline.
- **Comparativo:** o `tools/list` real das ações de negócio também traz `outputSchema` e `annotations`. A tabela mede os três campos comuns às duas variantes (`name`, `description`, `inputSchema`) e uma linha abaixo dela dá o total com os campos extras. Com o seed de 30 clientes, só 3 casam com o filtro do C2, então C2b custa quase o mesmo que C2a aqui.
- **Verificação manual no VS Code (critério do M7): pendente.** O VS Code não está instalado na máquina onde o projeto foi construído, e configurar Cursor ou Claude Desktop no lugar mudaria configuração persistente do usuário e exigiria colar um token real. Roteiro para o dono: `npm run api`; `npm run tokens -- issue --name vscode --role member`; abrir a pasta no VS Code; iniciar `secure-legacy-mcp` pelo `.vscode/mcp.json`; colar o token no prompt de senha; num chat novo, pedir "procure o cliente teodoro". Registrar aqui a data e a versão do VS Code, e ajustar em `docs/clients/README.md` os nomes de comandos que a conferência mostrar diferentes. Enquanto isso, a parte que não depende do editor é automática: `tests/mcp/client-config.e2e.test.ts` sobe o servidor pela entrada do `.vscode/mcp.json`, com `${workspaceFolder}` e o input de senha preenchidos, e confere `tools/list` e `getCustomer`; `tests/repo/client-configs.unit.test.ts` confere o comando (`node`, nunca `npm`), o caminho, o endereço padrão da API e os trechos JSON de `docs/clients/README.md`.
- **`git` no shell da construção:** no shell interativo usado, `git` era uma função que falhava; os comandos usaram `/usr/bin/git`. O script `hooks:install` roda em `/bin/sh` e acha o `git` normal.

## Checklist

| Critério | Teste |
|---|---|
| PKG-01 | `tests/repo/pack-manifest.unit.test.ts` |
| PKG-02 | `scripts/verify-pack.ts` (`npm run test:pack`, fora do `npm test`) |
| PKG-03, PKG-04 | `tests/repo/conventions.unit.test.ts` |
| BEN-01, BEN-02 | `tests/bench/token-table.int.test.ts` |
| BEN-03 | `tests/bench/mirror-tools.unit.test.ts`, `tests/bench/token-table.int.test.ts`, `tests/legacy-api/openapi-contract.int.test.ts` |
| REP-01, REP-02 | `tests/repo/conventions.unit.test.ts` |
| REP-04 | `tests/repo/conventions.unit.test.ts` (arquivo executável), `tests/repo/pre-commit-hook.unit.test.ts` (o hook roda com um `npm` falso e aborta quando o typecheck ou os testes falham) |
| REP-03 | `tests/repo/no-network.unit.test.ts` |
| Todo ID EARS com teste (CS-3) e cada spec com a lista completa dos seus IDs | `tests/repo/conventions.unit.test.ts` |
| Ressalvas do comparativo no README e em `docs/token-comparison.md` (arquivo inteiro gerado) | `tests/bench/token-table.int.test.ts` |
| Seções do README (spec de design 10.1), estrutura dos ADRs, testes citados existem | `tests/repo/docs.unit.test.ts` |
