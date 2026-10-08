# ADR 0001: Ações de negócio, não espelho de endpoints

- **Status:** aceito (2026-10-04)

## Contexto

A API legada tem 7 rotas com campos crípticos (`cst_nm`, `dt_cad`), códigos (`A`/`I`, `1`/`2`/`3`), listagem sem limite e um `PUT` que exige o objeto completo e quebra com `cst_id` no corpo. Converter cada rota numa tool (como fazem os conversores REST para MCP citados na aula 203483) entrega ao modelo todas essas armadilhas. Colar a spec OpenAPI inteira no prompt (a alternativa sem MCP discutida em 203470) custa ainda mais contexto.

## Decisão

O servidor expõe 5 ações de negócio: `getCustomer` (resolve por qualquer critério, com `found`/`ambiguous`/`none`), `searchCustomers` (filtros no banco e cursor), `createCustomer`, `updateCustomerContact` e `deactivateCustomer`. O de-para fica na `infrastructure` e a regra no service. Regras de camada (spec 4.3, testadas no `conventions.unit`): `src/mcp` não importa `src/legacy-api`; `tools`, `resources` e `prompts` só chamam o service; o service só conhece a porta `CustomerGateway`; só a `infrastructure` faz HTTP; `src/shared` não importa os outros dois.

O JSON Schema das entradas usa helpers de campo com `pattern` curto (`emailField`, `isoDateField`, D-25), porque o SDK 1.32 converte o Zod sem `override` e o padrão do Zod 4 emite `pattern` longos. A validação forte continua no servidor (`format: email`, `refine` de data de calendário).

## Consequências

Números de `npm run bench:tokens` (tokenizador `o200k_base`; tabela completa no README e em `docs/token-comparison.md`):

| Medida | Espelho REST (7 tools) | Ações de negócio (5 tools) |
|---|---:|---:|
| Definições (`name`, `description`, `inputSchema`) | 859 | 956 |
| C2a, enterprise ativos de 2024: tokens de resultado | 188 | 102 |
| C3, desativar o Teodoro: tokens de argumentos | 58 | 11 |
| C3: tokens de resultado | 82 | 119 |

- As definições das ações de negócio custam 11% mais que as do espelho, e o `tools/list` completo (com `outputSchema` e `annotations`) chega a 2471 tokens. A spec OpenAPI inteira custa 2313. O ganho está nas chamadas: o modelo não monta o objeto completo do `PUT`, não decodifica códigos e recebe listas menores; no C3 as ações devolvem o cliente inteiro, e o resultado é maior que o `{id, msg}` do legado.
- Custo de schema (D-25), medido uma vez trocando os helpers por `z.email()` e `z.iso.date()` sem salvar a troca: as definições das ações de negócio iriam de 956 para 1327 tokens (+371, +39%) e o `tools/list` completo de 2471 para 2842 (os esquemas de saída não usam os helpers: nome, e-mail e data saem como o legado guarda, ver MCP-15). Sem `describe`, `z.email()` emite 154 caracteres de schema contra 77 do helper, e `z.iso.date()` 259 contra 52 (spec, Apêndice B).
- Qualquer mudança em `description`, `describe` ou schema de tool exige `npm run bench:tokens` (o `npm test` compara a tabela, BEN-02).

## Alternativas

- **Espelho 1:1 gerado do OpenAPI:** menos código no servidor, mas o modelo herda as armadilhas e o custo de erro (que a tabela não mede, salvo a linha C2b). Mantido só como baseline do comparativo, gerado por função pura para não ser piorado de propósito.
- **Spec OpenAPI inteira no prompt:** sem servidor, 2313 tokens fixos por conversa e nenhuma proteção contra `PUT` parcial ou listagem sem limite.
