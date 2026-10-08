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

Tokenizador: `o200k_base` (gpt-tokenizer) | estimativa: caracteres/4

**Definições** (`JSON.stringify` do array `{ name, description, inputSchema }` de um `tools/list`)

| Variante | Tools | Tokens (o200k) | Estimativa (chars/4) |
|---|---:|---:|---:|
| Espelho REST (gerado do OpenAPI) | 7 | 859 | 796 |
| Ações de negócio | 5 | 956 | 967 |
| Spec OpenAPI inteira no prompt | - | 2313 | 2227 |

As definições das ações de negócio custam 11% mais tokens que as do espelho. Com `outputSchema` e `annotations`, que o `tools/list` real também devolve, as ações de negócio somam 2471 tokens (o200k); o espelho gerado não tem esquema de saída.

**Cenários** (sequência mínima correta, sem erros do modelo, contra a API com o seed de 30 clientes)

| Cenário | Variante | Chamadas | Tokens de argumentos | Tokens de resultados |
|---|---|---:|---:|---:|
| C1 telefone do cliente com e-mail X | Espelho REST | 1 | 13 | 71 |
| C1 telefone do cliente com e-mail X | Ações de negócio | 1 | 12 | 61 |
| C2a clientes enterprise ativos cadastrados em 2024 (comparação justa) | Espelho REST | 1 | 28 | 188 |
| C2a clientes enterprise ativos cadastrados em 2024 (comparação justa) | Ações de negócio | 1 | 29 | 102 |
| C2b mesmo pedido, espelho ingênuo sem `lim` (erro do modelo) | Espelho REST | 1 | 24 | 188 |
| C2b mesmo pedido, espelho ingênuo sem `lim` (erro do modelo) | Ações de negócio (mesma chamada de C2a) | 1 | 29 | 102 |
| C3 desative o Teodoro | Espelho REST | 2 | 58 | 82 |
| C3 desative o Teodoro | Ações de negócio | 2 | 11 | 119 |

C2a é a comparação justa: os dois lados limitados a 10 itens. C2b mostra um erro possível do modelo, não um baseline: sem `lim`, a API legada devolve tudo o que casa com o filtro. O custo dos outros erros do espelho (códigos `A`/`I` e `1`/`2`/`3`, `cst_id` no corpo do `PUT`) não entra na medição. Outros modelos tokenizam diferente; vale a comparação relativa. Metodologia e ressalvas: [docs/token-comparison.md](docs/token-comparison.md).
