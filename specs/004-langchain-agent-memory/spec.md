# 004: LangChain agent with memory (optional extra)

Status: implemented (milestone M9). Code in `examples/agent/`; guide in `examples/agent/README.md`.

## Context

A LangChain.js agent consumes this repository's MCP server through `@langchain/mcp-adapters` and proves the two-turn memory that the lesson 203493 agent lacked ("what is his id?"). By default it uses a scripted fake model, which picks the answer from the input and takes the values from the real tool results; with `OPENROUTER_API_KEY`, it uses a real model through OpenRouter. The agent has explicit per-turn ceilings and uses no third-party MCP servers.

## Acceptance criteria

- **AGT-01** When, with memory on, the user asks "what is her id?" after creating a customer, the answer shall contain the real id returned by `createCustomer`.
- **AGT-02** When the same script runs with memory off, the answer shall be the `ifUnresolved` text.
- **AGT-03** If the fake model receives input with no fixture, then it shall throw `FakeScriptMissError` with the normalized key and the known keys.
- **AGT-04** If the model asks for more than 4 tool calls or more than 6 model calls in a turn, then the agent shall interrupt the turn with the ceiling middleware's error (`exitBehavior: 'error'`).
- **AGT-05** When `getCustomer` returns `ambiguous` in the `ambiguous-maria` scenario, the agent shall not call `deactivateCustomer` and the database shall remain unchanged.
- **AGT-06** While `OPENROUTER_API_KEY` is missing, `test:live` shall skip the tests; with the key, it shall assert the database state.

## Non-goals

| Out of scope | Reason |
|---|---|
| LLM quality evaluation | The fake proves the mechanics (flow, contracts, ceilings, memory), not the model's intelligence; `test:live` asserts database state, not text |
| Third-party MCP servers in the example (filesystem via `npx`) | A third-party download on first run and supply-chain risk |
| Persistent memory across runs | The example is ephemeral and two turns long; an in-memory `MemorySaver` is enough |

## Resolved questions

Checked against the installed packages (`langchain` 1.5.15, `@langchain/core` 1.2.14, `@langchain/langgraph` 1.4.19, `@langchain/mcp-adapters` 2.0.0, `@langchain/openai` 1.6.2):

- `createAgent({ model, tools, systemPrompt, checkpointer, middleware })` accepted the `ScriptedChatModel` (a `BaseChatModel` subclass whose `bindTools()` returns the instance itself). The swap to a one-node `StateGraph` planned in D-20 was not needed.
- The agent passes the `SystemMessage` first; the router uses the last `HumanMessage` and ignores the rest, as fake rule 1 requires.
- `toolCallLimitMiddleware({ runLimit: 4, exitBehavior: 'error' })` throws `ToolCallLimitExceededError` ("Tool call limit reached: run limit exceeded (5/4 calls)") when the model asks for the 5th call, before running it: the API sees exactly 4 searches in the `runaway-loop` scenario. With one tool call per step, the 6-model-call ceiling does not fire before the tool ceiling (the 5th model call is already blocked). To prove the model ceiling, `createCustomerAgent` accepts `limits` and a test loosens the tool ceiling to 10: the turn stops with `ModelCallLimitMiddlewareError` ("run level call limit reached with 6 model calls"), after 6 searches. The error class is not exported by `langchain` 1.5.15; the test checks `name` and message.
- LangGraph stops a run at 25 steps by default (`GraphRecursionError`), and here each model call that asks for a tool spends 5 steps (hook before the model, model, two hooks after the model and the tools node). Without an adjustment, a legitimate turn with 4 tools in sequence and the final answer died at that limit, and the model ceiling was never reached. `createCustomerAgent` uses `withConfig({ recursionLimit })` with `2 × 5 × (model ceiling + 1)` steps, so that the middleware ceilings are what stop a turn.
- Both middlewares only reset the run counters in `afterAgent`, which does not run when the turn throws. With memory, the thread kept the counters at the limit (the next turn failed on its first tool, even when it needed only one) and an `AIMessage` with a tool call without a `ToolMessage`, which OpenAI-compatible APIs reject. `askWithTrace` reads the state before the turn (`agent.graph.getState`) and, if the turn fails, returns the thread to that checkpoint (`agent.graph.updateState` with the earlier values) or deletes the thread if it did not exist (`deleteThread`), and only then re-raises the error.
- `MultiServerMCPClient` 2.0 prefixes tool names with the server name by default (`prefixToolNameWithServerName` becomes `true` when absent). The example passes `false`, so the fixtures use the MCP names (`createCustomer`).
- The adapter uses the SDK's v2 client (`@modelcontextprotocol/client`), whose `StdioClientTransport` adds `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` to the explicit `env`. That is why `connectCustomersMcp` passes only `SERVICE_TOKEN`, `LEGACY_API_URL`, `LOG_LEVEL` and, in the tests, `NODE_OPTIONS` with the network guard. The child's stderr is set to `ignore` (the default would inherit the terminal).
- A success result with a single text block becomes a `ToolMessage` with string content; `isError` with `tool_call_id` becomes a `ToolMessage` with `status: 'error'` and the `[CODE] ...` text (D-21, seen again in the `member-forbidden` scenario). The router accepts string content or a list of blocks.
- The adapter validates each call's arguments against the tool's JSON Schema before sending; the fixtures' arguments have to pass that validation.
- A placeholder that fills a whole argument (`"id": "{{tool:getCustomer.customer.id}}"`) keeps the resolved value's type, so the id reaches `deactivateCustomer` as a number.
- Rule 4.3 of the design spec limits reading `process.env` in `examples/` to `config.ts`; the demo uses `loadAgentConfigFromProcessEnv()` instead of reading the environment directly.
- The `tsconfig`'s `ES2022` target has no `Array.prototype.findLastIndex`; the router looks for the last `HumanMessage` with a loop.

## Checklist

| Criterion | Test |
|---|---|
| AGT-01 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts`, `tests/agent/agent-demo.e2e.test.ts` |
| AGT-02 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| AGT-03 | `tests/agent/scripted-router.unit.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| AGT-04 | `tests/agent/agent-memory.e2e.test.ts` (tool ceiling), `tests/agent/agent-ceilings.e2e.test.ts` (4 tools in sequence, model ceiling, a failed turn kept out of memory) |
| AGT-05 | `tests/agent/agent-memory.e2e.test.ts` |
| AGT-06 | `tests/live/agent.live.ts` (`npm run test:live`, outside `npm test`) |
