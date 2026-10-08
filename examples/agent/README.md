# LangChain agent (optional extra)

A LangChain.js agent that consumes this repository's MCP server through `@langchain/mcp-adapters`, with two-turn memory. It fixes the "what is his id?" of lesson 203493 (an agent without memory) and proves it with a test, before and after.

```bash
npm run agent:demo
```

Without a key and without a `.env`, the demo uses the scripted fake model. For each run (memory on and off) it starts the legacy API in process, issues an `admin` token, starts the MCP server as a child process over stdio and runs the `create-then-ask-id` script.

## Pieces

| File | Role |
|---|---|
| `config.ts` | `loadAgentConfig(env)`: `fake` by default; `openrouter` when there is an `OPENROUTER_API_KEY` and `LLM_PROVIDER` was not set; `openrouter` without a key fails early. The only file in `examples/` that reads `process.env` |
| `agent.ts` | `connectCustomersMcp` (`customers` server over stdio, explicit `env`, tool names without a prefix), `createCustomerAgent` (`createAgent` + optional `MemorySaver` + per-turn ceilings) and `ask` (one turn; if it fails, the thread goes back to the state before it) |
| `model.ts` | `createChatModel`: the fake, or `ChatOpenAI` pointing at `https://openrouter.ai/api/v1` |
| `prompts/v1/system.ts` | Versioned system prompt: data only through tools, never guess an id, resolve before writing, stop on `ambiguous`, relay `[CODE]`, answer in English |
| `fake/scripted-router.ts` | Pure function `(fixture, messages) -> AIMessage`: picks the step from the last user message and resolves `{{tool:X.path}}`, `{{history:X.path}}` and `{{error:X}}` against the real tool results |
| `fake/scripted-chat-model.ts` | A thin `BaseChatModel` over the router |
| `fixtures/*.json` | One script per scenario: `create-then-ask-id`, `deactivate-teodoro`, `ambiguous-maria`, `member-forbidden` |

Per-turn ceilings (spec 6.1): 6 model calls and 4 tool calls, both with `exitBehavior: 'error'`. The `runaway-loop` test shows the turn stopping with `ToolCallLimitExceededError` on the 5th tool call; with the tool ceiling loosened in the test, the model ceiling stops the turn on the 7th call (`ModelCallLimitMiddlewareError`). Two LangGraph details the code handles:

- **Graph step limit.** LangGraph stops a run at 25 steps by default, and here each model call that asks for a tool spends 5 steps. Without an adjustment, a legitimate turn with 4 tools in sequence died with `GraphRecursionError` before the final answer. `createCustomerAgent` raises that limit above the ceilings, so that the ceilings are what stop the turn.
- **A failed turn does not stay in memory.** The middleware only resets the turn counters when the turn ends well. Without handling, after a ceiling error the thread kept the counters at the limit (the next turn failed on its first tool) and an `AIMessage` with a tool call that had no response, which real model APIs reject. `ask` returns the thread to the checkpoint before the turn before re-raising the error.

## What the fake proves, and what it does not

The fake **ignores the system prompt** and follows the fixture's script. It decides nothing: it proves the mechanics (the agent calls the real tools, the real result comes back as a `ToolMessage`, the history reaches the model on the next turn only with memory, the ceilings interrupt a loop, a `[FORBIDDEN]` reaches the answer). The values in the answer (id, name) come from the real MCP server against the real API; the fake does not invent data. Input with no script throws `FakeScriptMissError` with the normalized key and the known keys.

Whether the model obeys the prompt (stopping on namesakes, not guessing an id) only shows up with a real model.

## Real model (OpenRouter)

```bash
cp .env.example .env    # fill in OPENROUTER_API_KEY; OPENROUTER_MODEL is optional (default openrouter/free)
npm run agent:demo
npm run test:live       # create-then-ask-id and deactivate-teodoro; asserts the database and the id, never the text
```

Without `OPENROUTER_API_KEY`, `npm run test:live` skips both tests (`OPENROUTER_API_KEY is not set`) and exits with 0. If the default free model does not support tools, pick another free model with tool support in `OPENROUTER_MODEL`.

## Tests

- `tests/agent/scripted-router.unit.test.ts`: placeholders, `ifUnresolved`, `FakeScriptMissError`, fixtures, config.
- `tests/agent/model-and-prompt.unit.test.ts`: `createChatModel` (OpenRouter client built without the network, fake with a fixture) and the system prompt rules.
- `tests/agent/agent-memory.e2e.test.ts`: the scenarios against the real MCP server and API (memory on and off, tool ceiling, namesakes, `member` role).
- `tests/agent/agent-ceilings.e2e.test.ts`: the ceiling edges (4 tools in sequence, model ceiling, a failed turn kept out of memory) and the system prompt on every model call.
- `tests/agent/agent-demo.e2e.test.ts`: `agent:demo` with the fake.
