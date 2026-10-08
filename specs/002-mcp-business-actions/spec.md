# 002: Servidor MCP com ações de negócio

Status: implementado (marcos M4, M5 e M6). Decisões: ADRs 0001, 0002 e 0005.

## Contexto

Um servidor MCP stdio, cliente HTTP da API legada (spec 001), que expõe 5 ações de negócio no lugar das 7 rotas: `getCustomer` (resolve por id, e-mail, telefone ou nome, com `found`, `ambiguous` ou `none`), `searchCustomers` (filtros no banco e cursor), `createCustomer`, `updateCustomerContact` e `deactivateCustomer` (idempotentes, sem delete físico). Também 1 resource estático (`customers://service-info`), 1 resource template (`customers://customers/{id}`), 3 prompts e `instructions`. Camadas `domain`, `infrastructure`, `application`, `tools`, `resources` e `prompts`; stdout só JSON-RPC.

## Critérios de aceite

- **MCP-01** Se `SERVICE_TOKEN` estiver ausente ou fora do formato, ou se `LEGACY_API_URL` trouxer credenciais (`usuario:senha@`), então o servidor deve sair com código 1, escrever em stderr uma mensagem que nomeia a variável sem ecoar o valor e não escrever nada no stdout.
- **MCP-02** Enquanto o servidor estiver em execução, o stdout deve conter apenas mensagens JSON-RPC 2.0 válidas, uma por linha.
- **MCP-03** O servidor deve escrever logs em stderr como uma linha JSON por evento com `ts`, `level`, `component` e `event`, e nenhum log deve conter um token completo.
- **MCP-04** Quando o cliente chamar `tools/list`, o servidor deve listar exatamente `getCustomer`, `searchCustomers`, `createCustomer`, `updateCustomerContact` e `deactivateCustomer`, cada uma com `description`, `inputSchema`, `outputSchema` e as anotações da seção 5.4 da spec de design.
- **MCP-05** Quando `getCustomer` receber critérios que correspondem a mais de um cliente, o servidor deve devolver `match: "ambiguous"`, `customer: null` e no máximo 5 candidatos.
- **MCP-06** Quando `getCustomer` ou `searchCustomers` consultarem a listagem legada, o gateway deve enviar os filtros e `lim` de no máximo 50, nunca uma listagem sem `lim`.
- **MCP-07** Quando `updateCustomerContact` ou `deactivateCustomer` escreverem, o corpo do `PUT` deve conter todos os campos obrigatórios e nunca `cst_id`.
- **MCP-08** Quando a API responder 401, 403, 404, 409, 429 ou 5xx, ou estiver inacessível, a tool deve devolver `isError: true`, texto `[CODIGO] ...` do catálogo e `_meta` com `code` e `retryable`, sem `structuredContent`, e o texto não deve conter stack, `SQLITE`, `Error:` nem o token.
- **MCP-09** Quando `deactivateCustomer` receber um cliente já inativo, ou `updateCustomerContact` receber valores iguais aos atuais, o servidor não deve enviar `PUT` e deve sinalizar isso na saída (`alreadyInactive: true` ou `changed: []`).
- **MCP-10** Quando uma leitura falhar por rede, timeout ou 5xx, o gateway deve repetir uma única vez; escritas, respostas 4xx ou 429 e payloads inválidos não devem ser repetidos; cada tentativa deve ser abortada ao atingir `LEGACY_API_TIMEOUT_MS`, de modo que uma leitura dure no máximo 2 x `LEGACY_API_TIMEOUT_MS`.
- **MCP-11** Quando o cliente ler `customers://service-info`, o servidor deve incluir o papel do token atual; se a API estiver inacessível, deve devolver o documento com papel `unknown`, sem erro.
- **MCP-12** Quando o cliente ler `customers://customers/{id}` com id inexistente, o servidor deve responder com erro `Customer <id> not found`, sem detalhe interno.
- **MCP-13** Quando o cliente chamar `prompts/get` para cada um dos 3 prompts, o servidor deve devolver exatamente o texto definido no código, com os argumentos interpolados.
- **MCP-14** Se um handler encontrar uma exceção inesperada, então a tool deve devolver `[INTERNAL]` com `requestId` e registrar o detalhe só em stderr.
- **MCP-15** Se a API devolver um payload fora do schema legado ou um corpo que não é JSON, então o servidor deve responder `[UPSTREAM_CONTRACT]` e continuar atendendo as chamadas seguintes; um registro dentro do schema legado (por exemplo, nome de 1 caractere ou e-mail sem `@`, que a API aceita) deve ser devolvido como está, sem derrubar a leitura nem a página.
- **MCP-16** Se `searchCustomers` receber um cursor malformado ou emitido para outros filtros, então o servidor deve responder `[INVALID_INPUT]` com `cursor does not match the current filters`; quando não houver mais páginas, `nextCursor` deve ser `null`.
- **MCP-17** Se a API aceitar uma escrita (`createCustomer`, `updateCustomerContact` ou `deactivateCustomer`) e a releitura do cliente falhar, então a tool deve devolver `[READBACK_FAILED]` com o id do cliente e `retryable: false`, dizendo que a escrita foi aplicada e não deve ser repetida.
- **MCP-18** Se `createCustomer.name`, `getCustomer.name` ou `searchCustomers.nameContains` tiverem menos de 2 caracteres depois de aparar as pontas, ou contiverem caractere de controle ou de formatação bidirecional, então a tool deve recusar a chamada com erro de validação de entrada, sem chamar a API; nomes válidos seguem sem os espaços das pontas.

## Non-goals

| Fora do escopo | Motivo |
|---|---|
| Transporte Streamable HTTP ou SSE | ADR 0002: HTTP remoto direito exige o MCP como resource server OAuth 2.1; o atalho seria *token passthrough* |
| Delete físico, reativar cliente, emitir token ou mudar papel pelo MCP | Faixa 4 da Matriz de Autonomia: proibido por construção; fica com o administrador (CLI e API) |
| Esconder tools de escrita para tokens `member` | Exigiria consultar o papel na inicialização; a API é a autoridade e o 403 vira `[FORBIDDEN]` |
| CRUD 1:1 sobre as rotas | A ação de negócio esconde o de-para e as armadilhas do legado (ADR 0001) |
| Controle de concorrência nas escritas | O `PUT` legado exige o objeto inteiro e a API não tem ETag nem `If-Match`: uma mudança feita por outro cliente entre a leitura e o `PUT` é sobrescrita. Registrado nas limitações do README |
| Validar nome e e-mail na saída | A API legada aceita qualquer nome e e-mail não vazios; as regras de formato valem só na entrada das tools (MCP-15) |

## Dúvidas resolvidas

Conferidas no `@modelcontextprotocol/sdk` 1.32.0 e no `zod` 4.6.5 instalados:

- `registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb)` aceita `ZodObject` do Zod 4, inclusive com `.refine()`, que roda no servidor. A recusa chega com o prefixo `MCP error -32602:` antes de `Input validation error`; testes usam `assert.match`.
- Com schema genérico, o tipo condicional do callback de `registerTool` não se resolve: o `defineTool` registra com `registerTool<z.ZodObject, z.ZodObject>` e estreita a entrada já validada.
- O cliente valida `structuredContent` contra o `outputSchema` sempre que ele vem, inclusive com `isError` (ADR 0005). `isError` sem `structuredContent` passa e o `_meta` chega ao cliente.
- Exceção lançada no handler vira `isError` com a mensagem crua; por isso o `defineTool` captura tudo.
- `maxToolInputElements: 64` recusa com `MCP error -32602: Invalid arguments for tool <nome>: arguments contain more than the maximum of 64 elements`.
- `McpError(ErrorCode.InvalidParams, msg)` num resource chega como código -32602 com o prefixo `MCP error -32602:` duas vezes. Template com `list: undefined` não aparece em `listResources`.
- A conversão de schema é `toJSONSchema(schema, { target: 'draft-7', io: 'input' })`, sem `override`: `z.email()` e `z.iso.date()` emitem `pattern` longos, daí os helpers `emailField` e `isoDateField` (D-25; números no ADR 0001). `z.number().int()` emite também `minimum: -9007199254740991`.
- O `StdioClientTransport` soma `getDefaultEnvironment()` (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER`) ao `env` explícito. `client.close()` fecha o stdin, espera 2 s e só então manda `SIGTERM`; por isso o `main.ts` encerra também no fim do stdin.
- O `Protocol.connect` encadeia `onmessage`, `onerror` e `onclose` já definidos no transporte; o demo depende disso para contar também a resposta do `initialize`.
- O ouvinte padrão de `warning` do Node pode ser removido: os avisos viram linhas `node_warning` do logger e todo o stderr continua JSON.
- stdout e stderr são pipes separados: uma linha de log escrita antes da resposta pode chegar depois dela. Os testes esperam as linhas de log com `waitForStderr`.
- No macOS, `process.exit` pode cortar uma escrita pendente em stderr num pipe. A falha de config usa `process.exitCode = 1`, e o crash usa escrita síncrona no fd 2.
- `node --env-file-if-exists=.env` sem `.env` escreve `.env not found. Continuing without it.` no stderr (não no stdout). O canal JSON-RPC não é afetado; os testes sobem `main.ts` direto.
- `npm run mcp` escreve o banner do npm (`> secure-legacy-mcp@0.1.0 mcp`) no stdout antes do servidor; `npm run -s mcp` não. Clientes iniciam `node src/mcp/main.ts` ou o binário, nunca o script do npm.
- O `fetch` do Node recusa URL com credenciais, e o Zod 4 roda o `.refine()` de `z.url()` mesmo quando o formato já falhou (por isso a checagem de credenciais usa `URL.parse` e aceita o que não é URL).
- O SDK valida `structuredContent` contra o `outputSchema` no servidor e no cliente: um campo de saída com as regras de entrada recusaria um registro legado válido (MCP-15).
- No Zod 4, `.trim()` roda antes de `.min()` na ordem da cadeia, e nem ele nem `.refine()` entram no JSON Schema: a regra de nome do MCP-18 não muda o `tools/list` nem o comparativo de tokens. A recusa chega como `MCP error -32602: Input validation error: ... at name`.

## Checklist

| Critério | Teste |
|---|---|
| MCP-01 | `tests/mcp/config.unit.test.ts`, `tests/mcp/startup.e2e.test.ts` |
| MCP-02 | `tests/mcp/stdout-clean.e2e.test.ts` |
| MCP-03 | `tests/mcp/stdout-clean.e2e.test.ts`, `tests/shared/logger.unit.test.ts`, `tests/shared/redact.unit.test.ts` |
| MCP-04 | `tests/mcp/tools-read.e2e.test.ts` |
| MCP-05 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-06 | `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-07 | `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/legacy-mapper.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| MCP-08 | `tests/mcp/tool-errors.e2e.test.ts`, `tests/mcp/define-tool.unit.test.ts`, `tests/mcp/legacy-gateway.unit.test.ts`, `tests/mcp/customer-schemas.unit.test.ts` |
| MCP-09 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| MCP-10 | `tests/mcp/legacy-gateway.unit.test.ts` |
| MCP-11 | `tests/mcp/resources-prompts.e2e.test.ts`, `tests/mcp/service-info.unit.test.ts` |
| MCP-12, MCP-13 | `tests/mcp/resources-prompts.e2e.test.ts` |
| MCP-14 | `tests/mcp/define-tool.unit.test.ts` |
| MCP-15 | `tests/mcp/legacy-mapper.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| MCP-16 | `tests/mcp/cursor.unit.test.ts`, `tests/mcp/customer-service.unit.test.ts` |
| MCP-17 | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts` |
| MCP-18 | `tests/mcp/customer-schemas.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| Demo de um comando (CS-1) | `tests/demo/demo.e2e.test.ts` |
