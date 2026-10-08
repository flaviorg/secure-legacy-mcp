# Comparativo de tokens

Arquivo gerado por `npm run bench:tokens` (`scripts/bench/measure-tool-tokens.ts --write`). Não edite à mão: o `npm test` compara este bloco e o do README com a saída do medidor (BEN-02).

## O que se mede

Três formas de dar a um modelo acesso ao cadastro de clientes:

1. **Espelho REST**: uma tool por operação de `docs/legacy-api/openapi.json` (7 operações), gerada pela função pura `openApiToMirrorTools` (`scripts/bench/mirror-tools.ts`): nome do `operationId`, descrição de `summary` e `description`, `inputSchema` dos `parameters` e do `requestBody`. Ninguém escreveu essas definições à mão, então ninguém as piorou de propósito. Não existe servidor MCP para o espelho: ele só ecoaria as mesmas definições. Cada chamada do roteiro vai direto à API com `fetch`, e o resultado medido é o corpo legado cru, que é o que uma tool de repasse devolveria.
2. **Ações de negócio**: as 5 tools reais, lidas por um `Client` do SDK sobre `InMemoryTransport` ligado a `createMcpServer`, com o service apontando para a API em processo. O resultado medido é o `content[0].text` de cada chamada (JSON compacto).
3. **Spec OpenAPI inteira no prompt**: `openapi.json` minificado, a alternativa sem MCP.

Definições são medidas como `JSON.stringify` do array `{ name, description, inputSchema }`, os três campos que as duas variantes de tools têm. Nos cenários, "tokens de argumentos" é a soma de `JSON.stringify(args)` de cada chamada (o que o modelo precisa gerar) e "tokens de resultados" é a soma do que volta para o contexto. O nome da tool em cada chamada não entra na conta de nenhum dos lados.

Tokenizador: `o200k_base` do `gpt-tokenizer` 4.0.0, offline, mais a estimativa de caracteres/4 (aula 221522). Cada execução sobe APIs novas com SQLite `:memory:` e o seed de 30 clientes, uma para o espelho e outra para as ações de negócio, de modo que a escrita do C3 de um lado não afeta o outro e duas execuções dão a mesma saída byte a byte (BEN-01).

## Cenários

| Cenário | Espelho REST | Ações de negócio |
|---|---|---|
| C1 "telefone do cliente com e-mail X" | `getV1Customers {eml}` | `getCustomer {email}` |
| C2a "clientes enterprise ativos cadastrados em 2024" (comparação justa) | `getV1Customers {sts, seg, dt_de, dt_ate, lim: 10}` | `searchCustomers {status, segment, createdFrom, createdTo}` (limite padrão 10) |
| C2b mesmo pedido, espelho ingênuo | `getV1Customers {sts, seg, dt_de, dt_ate}` sem `lim`, como um modelo poderia montar a partir da spec | mesma chamada de C2a |
| C3 "desative o Teodoro" | `getV1Customers {nm}` e `putV1CustomersById` com o objeto completo montado do resultado anterior | `getCustomer {name}` e `deactivateCustomer {id}` |

O roteiro é a sequência mínima correta, sem LLM e sem erros do modelo (`scripts/bench/scenarios.ts`).

## Ressalvas

- Outros modelos tokenizam diferente. O número absoluto muda de um provedor para outro; a comparação relativa é o que importa.
- Os provedores reformatam as definições de tools antes de pôr no prompt. O JSON medido aqui é uma aproximação do que entra no contexto, não o valor faturado.
- O custo dos erros do espelho REST (códigos `A`/`I` e `1`/`2`/`3`, `cst_id` no corpo do `PUT`, que dá 500, listar tudo sem `lim`) **não** entra na medição. A exceção é a linha C2b, rotulada como erro do modelo. Com o seed de 30 clientes só 3 casam com o filtro, então o C2b custa aqui quase o mesmo que o C2a; numa tabela real, sem `lim`, o resultado cresce com o cadastro.
- O JSON Schema das ações de negócio usa os helpers de campo `emailField` e `isoDateField` (D-25), com `pattern` curto. O ADR `docs/adr/0001-business-actions-not-endpoint-mirror.md` registra quanto o padrão do Zod 4 (`z.email()` e `z.iso.date()`) custaria a mais nas definições.
- Os números publicados são os que o script der. Se as ações de negócio custarem mais em definições, a tabela mostra isso: o projeto troca descrições mais ricas (que ajudam o modelo a acertar de primeira) por menos chamadas e resultados menores, sem campos crípticos para o modelo decodificar.

## Resultado

Tokenizer: `o200k_base` (gpt-tokenizer) | estimate: characters/4

**Definitions** (`JSON.stringify` of the `{ name, description, inputSchema }` array from a `tools/list`)

| Variant | Tools | Tokens (o200k) | Estimate (chars/4) |
|---|---:|---:|---:|
| REST mirror (generated from OpenAPI) | 7 | 859 | 796 |
| Business actions | 5 | 956 | 967 |
| Whole OpenAPI spec in the prompt | - | 2313 | 2227 |

The business action definitions cost 11% more tokens than the mirror's. With `outputSchema` and `annotations`, which the real `tools/list` also returns, the business actions add up to 2471 tokens (o200k); the generated mirror has no output schema.

**Scenarios** (minimal correct sequence, no model mistakes, against the API with the 30-customer seed)

| Scenario | Variant | Calls | Argument tokens | Result tokens |
|---|---|---:|---:|---:|
| C1 customer phone for email X | REST mirror | 1 | 13 | 71 |
| C1 customer phone for email X | Business actions | 1 | 12 | 61 |
| C2a active enterprise customers registered in 2024 (fair comparison) | REST mirror | 1 | 28 | 188 |
| C2a active enterprise customers registered in 2024 (fair comparison) | Business actions | 1 | 29 | 102 |
| C2b same request, naive mirror without `lim` (model mistake) | REST mirror | 1 | 24 | 188 |
| C2b same request, naive mirror without `lim` (model mistake) | Business actions (same call as C2a) | 1 | 29 | 102 |
| C3 deactivate Teodoro | REST mirror | 2 | 58 | 82 |
| C3 deactivate Teodoro | Business actions | 2 | 11 | 119 |

C2a is the fair comparison: both sides are limited to 10 items. C2b shows a possible model mistake, not a baseline: without `lim`, the legacy API returns everything that matches the filter. The cost of the mirror's other mistakes (the `A`/`I` and `1`/`2`/`3` codes, `cst_id` in the `PUT` body) is not included in the measurement. Other models tokenize differently; the relative comparison is what matters. Methodology and caveats: [docs/token-comparison.md](docs/token-comparison.md).
