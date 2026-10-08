# 004: Agente LangChain com memória (extra opcional)

Status: implementado (marco M9). Código em `examples/agent/`; guia em `examples/agent/README.md`.

## Contexto

Um agente LangChain.js consome o servidor MCP deste repositório via `@langchain/mcp-adapters` e prova a memória de dois turnos que faltou no agente da aula 203493 ("qual é o id dele?"). Por padrão usa um modelo fake roteirizado, que escolhe a resposta pela entrada e tira os valores dos resultados reais das tools; com `OPENROUTER_API_KEY`, usa um modelo real pelo OpenRouter. O agente tem tetos explícitos por turno e não usa servidores MCP de terceiros.

## Critérios de aceite

- **AGT-01** Quando, com memória ligada, o usuário perguntar "qual é o id dele?" depois de cadastrar um cliente, a resposta deve conter o id real devolvido por `createCustomer`.
- **AGT-02** Quando o mesmo roteiro rodar com memória desligada, a resposta deve ser o texto de `ifUnresolved`.
- **AGT-03** Se o modelo fake receber uma entrada sem fixture, então deve lançar `FakeScriptMissError` com a chave normalizada e as chaves conhecidas.
- **AGT-04** Se o modelo pedir mais de 4 chamadas de tool ou mais de 6 chamadas de modelo num turno, então o agente deve interromper o turno com o erro do middleware de teto (`exitBehavior: 'error'`).
- **AGT-05** Quando `getCustomer` devolver `ambiguous` no cenário `ambiguous-maria`, o agente não deve chamar `deactivateCustomer` e o banco deve permanecer inalterado.
- **AGT-06** Enquanto `OPENROUTER_API_KEY` estiver ausente, `test:live` deve pular os testes; com a chave, deve asseverar o estado do banco.

## Non-goals

| Fora do escopo | Motivo |
|---|---|
| Avaliação de qualidade de LLM | O fake prova a mecânica (fluxo, contratos, tetos, memória), não a inteligência do modelo; o `test:live` assevera estado no banco, não texto |
| Servidores MCP de terceiros no exemplo (filesystem via `npx`) | Download de terceiro na primeira execução e risco de supply chain |
| Memória persistente entre execuções | O exemplo é efêmero e de dois turnos; `MemorySaver` em memória basta |

## Dúvidas resolvidas

Conferidas nos pacotes instalados (`langchain` 1.5.15, `@langchain/core` 1.2.14, `@langchain/langgraph` 1.4.19, `@langchain/mcp-adapters` 2.0.0, `@langchain/openai` 1.6.2):

- `createAgent({ model, tools, systemPrompt, checkpointer, middleware })` aceitou o `ScriptedChatModel` (subclasse de `BaseChatModel` com `bindTools()` devolvendo a própria instância). A troca prevista em D-20 para `StateGraph` de um nó não foi necessária.
- O agente passa a `SystemMessage` primeiro; o router usa a última `HumanMessage` e ignora o resto, como manda a regra 1 do fake.
- `toolCallLimitMiddleware({ runLimit: 4, exitBehavior: 'error' })` lança `ToolCallLimitExceededError` ("Tool call limit reached: run limit exceeded (5/4 calls)") quando o modelo pede a 5ª chamada, antes de executá-la: a API vê exatamente 4 buscas no cenário `runaway-loop`. Com uma chamada de tool por passo, o teto de 6 chamadas de modelo não chega a disparar antes do teto de tools (a 5ª chamada de modelo já é barrada). Para provar o teto de modelo, `createCustomerAgent` aceita `limits` e um teste afrouxa o teto de tools para 10: o turno para com `ModelCallLimitMiddlewareError` ("run level call limit reached with 6 model calls"), depois de 6 buscas. A classe do erro não é exportada pelo `langchain` 1.5.15; o teste confere `name` e mensagem.
- O LangGraph para um run em 25 passos por padrão (`GraphRecursionError`), e cada chamada de modelo que pede uma tool gasta 5 passos aqui (hook antes do modelo, modelo, dois hooks depois do modelo e o nó de tools). Sem ajuste, um turno legítimo com 4 tools em sequência e a resposta final morria nesse limite, e o teto de modelo nunca era alcançado. `createCustomerAgent` usa `withConfig({ recursionLimit })` com `2 × 5 × (teto de modelo + 1)` passos, para que os tetos do middleware sejam os que param um turno.
- Os dois middlewares só zeram os contadores do run no `afterAgent`, que não roda quando o turno lança. Com memória, a thread guardava os contadores no limite (o turno seguinte falhava na primeira tool, mesmo precisando de uma só) e uma `AIMessage` com chamada de tool sem `ToolMessage`, que APIs compatíveis com a da OpenAI recusam. `askWithTrace` lê o estado antes do turno (`agent.graph.getState`) e, se o turno falha, devolve a thread a esse checkpoint (`agent.graph.updateState` com os valores de antes) ou apaga a thread se ela não existia (`deleteThread`), e só então repassa o erro.
- `MultiServerMCPClient` 2.0 prefixa o nome das tools com o do servidor por padrão (`prefixToolNameWithServerName` vira `true` quando ausente). O exemplo passa `false`, para que as fixtures usem os nomes do MCP (`createCustomer`).
- O adapter usa o cliente v2 do SDK (`@modelcontextprotocol/client`), cujo `StdioClientTransport` soma `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` e `USER` ao `env` explícito. Por isso `connectCustomersMcp` passa só `SERVICE_TOKEN`, `LEGACY_API_URL`, `LOG_LEVEL` e, nos testes, `NODE_OPTIONS` com a guarda de rede. O stderr do filho fica em `ignore` (o padrão herdaria o terminal).
- Resultado de sucesso com um único bloco de texto vira `ToolMessage` com conteúdo string; `isError` com `tool_call_id` vira `ToolMessage` com `status: 'error'` e o texto `[CODIGO] ...` (D-21, visto de novo no cenário `member-forbidden`). O router aceita conteúdo string ou lista de blocos.
- O adapter valida os argumentos de cada chamada contra o JSON Schema da tool antes de enviar; os argumentos das fixtures precisam passar nessa validação.
- Um placeholder que ocupa um argumento inteiro (`"id": "{{tool:getCustomer.customer.id}}"`) mantém o tipo do valor resolvido, para que o id chegue como número ao `deactivateCustomer`.
- A regra 4.3 da spec de design limita a leitura de `process.env` em `examples/` ao `config.ts`; o demo usa `loadAgentConfigFromProcessEnv()` em vez de ler o ambiente direto.
- O alvo `ES2022` do `tsconfig` não tem `Array.prototype.findLastIndex`; o router procura a última `HumanMessage` com um laço.

## Checklist

| Critério | Teste |
|---|---|
| AGT-01 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts`, `tests/agent/agent-demo.e2e.test.ts` |
| AGT-02 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| AGT-03 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| AGT-04 | `tests/agent/agent-memory.e2e.test.ts` (teto de tools), `tests/agent/agent-ceilings.e2e.test.ts` (4 tools em sequência, teto de modelo, turno que falha fora da memória) |
| AGT-05 | `tests/agent/agent-memory.e2e.test.ts` |
| AGT-06 | `tests/live/agent.live.ts` (`npm run test:live`, fora do `npm test`) |
