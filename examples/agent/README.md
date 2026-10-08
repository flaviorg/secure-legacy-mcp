# Agente LangChain (extra opcional)

Um agente LangChain.js que consome o servidor MCP deste repositório pelo `@langchain/mcp-adapters`, com memória de dois turnos. Ele corrige o "qual é o id dele?" da aula 203493 (agente sem memória) e prova isso com teste, antes e depois.

```bash
npm run agent:demo
```

Sem chave e sem `.env`, o demo usa o modelo fake roteirizado. Para cada execução (memória ligada e desligada) ele sobe a API legada em processo, emite um token `admin`, inicia o servidor MCP como processo filho via stdio e roda o roteiro `create-then-ask-id`.

## Peças

| Arquivo | Papel |
|---|---|
| `config.ts` | `loadAgentConfig(env)`: `fake` por padrão; `openrouter` quando há `OPENROUTER_API_KEY` e `LLM_PROVIDER` não foi definido; `openrouter` sem chave falha cedo. Único arquivo de `examples/` que lê `process.env` |
| `agent.ts` | `connectCustomersMcp` (servidor `customers` via stdio, `env` explícito, nomes de tool sem prefixo), `createCustomerAgent` (`createAgent` + `MemorySaver` opcional + tetos por turno) e `ask` (um turno; se ele falha, a thread volta ao estado de antes dele) |
| `model.ts` | `createChatModel`: fake, ou `ChatOpenAI` apontando para `https://openrouter.ai/api/v1` |
| `prompts/v1/system.ts` | Prompt de sistema versionado: dados só por tools, nunca adivinhar id, resolver antes de escrever, parar diante de `ambiguous`, repassar `[CODIGO]`, responder em inglês |
| `fake/scripted-router.ts` | Função pura `(fixture, mensagens) -> AIMessage`: escolhe o passo pela última mensagem do usuário e resolve `{{tool:X.caminho}}`, `{{history:X.caminho}}` e `{{error:X}}` nos resultados reais das tools |
| `fake/scripted-chat-model.ts` | `BaseChatModel` fino sobre o router |
| `fixtures/*.json` | Um roteiro por cenário: `create-then-ask-id`, `deactivate-teodoro`, `ambiguous-maria`, `member-forbidden` |

Tetos por turno (spec 6.1): 6 chamadas de modelo e 4 chamadas de tool, os dois com `exitBehavior: 'error'`. O teste `runaway-loop` mostra o turno parando com `ToolCallLimitExceededError` na 5ª chamada de tool; com o teto de tools afrouxado no teste, o de modelo para o turno na 7ª chamada (`ModelCallLimitMiddlewareError`). Dois detalhes do LangGraph que o código trata:

- **Limite de passos do grafo.** O LangGraph para um run em 25 passos por padrão, e aqui cada chamada de modelo que pede uma tool gasta 5 passos. Sem ajuste, um turno legítimo com 4 tools em sequência morria com `GraphRecursionError` antes da resposta final. `createCustomerAgent` sobe esse limite acima dos tetos, para que sejam eles que param o turno.
- **Turno que falha não fica na memória.** O middleware só zera os contadores do turno quando ele termina bem. Sem tratamento, depois de um erro de teto a thread guardava os contadores no limite (o turno seguinte falhava na primeira tool) e uma `AIMessage` com chamada de tool sem resposta, que APIs de modelo real recusam. `ask` devolve a thread ao checkpoint anterior ao turno antes de repassar o erro.

## O que o fake prova, e o que não prova

O fake **ignora o prompt de sistema** e segue o roteiro da fixture. Ele não decide nada: prova a mecânica (o agente chama as tools reais, o resultado real volta como `ToolMessage`, o histórico chega ao modelo no turno seguinte só com memória, os tetos interrompem um laço, um `[FORBIDDEN]` chega até a resposta). Os valores da resposta (id, nome) vêm do servidor MCP real contra a API real; o fake não inventa dados. Entrada sem roteiro lança `FakeScriptMissError` com a chave normalizada e as chaves conhecidas.

Se o modelo obedece ao prompt (parar diante de homônimos, não adivinhar id) só aparece com modelo real.

## Modelo real (OpenRouter)

```bash
cp .env.example .env    # preencha OPENROUTER_API_KEY; OPENROUTER_MODEL é opcional (padrão openrouter/free)
npm run agent:demo
npm run test:live       # create-then-ask-id e deactivate-teodoro; assevera o banco e o id, nunca o texto
```

Sem `OPENROUTER_API_KEY`, `npm run test:live` pula os dois testes (`OPENROUTER_API_KEY ausente`) e sai com 0. Se o modelo gratuito padrão não suportar tools, escolha outro modelo gratuito com suporte a tools em `OPENROUTER_MODEL`.

## Testes

- `tests/agent/scripted-router.unit.test.ts`: placeholders, `ifUnresolved`, `FakeScriptMissError`, fixtures, config.
- `tests/agent/model-and-prompt.unit.test.ts`: `createChatModel` (cliente do OpenRouter montado sem rede, fake com fixture) e as regras do prompt de sistema.
- `tests/agent/agent-memory.e2e.test.ts`: os cenários contra o servidor MCP e a API reais (memória ligada e desligada, teto de tools, homônimos, papel `member`).
- `tests/agent/agent-ceilings.e2e.test.ts`: as bordas dos tetos (4 tools em sequência, teto de modelo, turno que falha fora da memória) e o prompt de sistema em toda chamada de modelo.
- `tests/agent/agent-demo.e2e.test.ts`: o `agent:demo` com o fake.
