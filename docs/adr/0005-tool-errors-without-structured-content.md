# ADR 0005: Erros de tool sem `structuredContent`

- **Status:** aceito (2026-10-04)

## Contexto

Na aula 203490 os erros das tools voltavam dentro de `structuredContent`. No SDK 1.32 isso quebra: o `Client` valida `structuredContent` contra o `outputSchema` sempre que ele vem, inclusive com `isError: true`, e um objeto de erro não casa com o schema de sucesso. Além disso, uma exceção lançada no handler vira `isError` com a mensagem crua (por exemplo, `SQLITE_ERROR: ...`), conferido nos tipos e em execução (spec, Apêndice A).

## Decisão

- Todo handler roda dentro de `defineTool`, que captura tudo; nada é lançado para o SDK.
- Erro é `{ isError: true, content: [{ type: 'text', text: '[CODIGO] mensagem' }], _meta: { 'secure-legacy-mcp/error': { code, retryable, requestId, retryAfterSeconds?, scope? } } }`, sem `structuredContent` (D-07).
- O texto vem de um catálogo fechado de 11 códigos (`src/mcp/domain/errors.ts`), em inglês, sem stack, SQL, URL ou token. O detalhe (corpo cru da API mascarado e truncado em 500 caracteres, stack de exceção) vai só para o stderr, com o mesmo `requestId`.
- `retryable` é verdadeiro só para `RATE_LIMITED` e `UPSTREAM_UNAVAILABLE`.
- Uma escrita aceita pela API cuja releitura falha vira `[READBACK_FAILED]` com o id do cliente e `retryable: false` (MCP-17). Sem esse código, uma falha de rede ou um 429 na releitura viraria `UPSTREAM_UNAVAILABLE` ou `RATE_LIMITED`, que convidam a repetir; repetir `createCustomer` daria `[CONFLICT]` ("outro cliente já usa este e-mail"), uma mensagem enganosa, porque o cliente é o mesmo.

## Consequências

- O modelo lê um prefixo estável (`[FORBIDDEN]`, `[CONFLICT]`) e uma frase acionável; o cliente pode decidir repetição pelo `_meta`. O `@langchain/mcp-adapters` entrega esse texto ao agente como `ToolMessage` com `status: 'error'`.
- Os textos do catálogo são testados por igualdade exata (MCP-08), e os testes procuram `SQLITE`, `Error:`, stack e o token em todo texto de erro.
- Clientes que só olham `structuredContent` não veem o erro estruturado; precisam ler `content` ou `_meta`.

## Alternativas

- **Erro dentro de `structuredContent` (aula):** rejeitado pelo próprio cliente do SDK 1.32.
- **`outputSchema` como união de sucesso e erro:** polui o schema de todas as tools e o custo em tokens das definições, e o modelo teria de discriminar a união.
- **Lançar exceção e deixar o SDK formatar:** vaza a mensagem crua.
