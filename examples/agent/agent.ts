// Example agent (spec 7, D-20): LangChain createAgent over the MCP server of this repo,
// with optional short-term memory (MemorySaver + thread_id) and explicit ceilings per
// turn: 6 model calls and 4 tool calls, both failing the turn when exceeded. A failed
// turn is rolled back in the thread's memory.
import { fileURLToPath } from 'node:url';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createAgent, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { contentText } from './fake/scripted-router.ts';
import { SYSTEM_PROMPT_V1 } from './prompts/v1/system.ts';

export const MCP_MAIN_PATH = fileURLToPath(new URL('../../src/mcp/main.ts', import.meta.url));
export const MAX_MODEL_CALLS_PER_TURN = 6;
export const MAX_TOOL_CALLS_PER_TURN = 4;

export type AgentLimits = { modelCalls: number; toolCalls: number };

// LangGraph stops a run after 25 graph steps by default. Here a model call that asks for
// a tool takes 5 steps (the before-model hook, the model, two after-model hooks and the
// tools node), so 4 sequential tool calls and the final answer would hit that limit
// before the middleware ceilings. Twice the steps of the model-call ceiling (plus the
// blocked call) keeps the middleware ceilings as the ones that stop a turn.
const GRAPH_STEPS_PER_MODEL_CALL = 5;
const recursionLimitFor = (modelCalls: number) => 2 * GRAPH_STEPS_PER_MODEL_CALL * (modelCalls + 1);

export type CustomersMcp = { tools: StructuredToolInterface[]; close(): Promise<void> };

// Starts the MCP server of this repo as a child process over stdio, with an explicit
// environment (the SDK adds only its default variables, such as PATH and HOME). Tool
// names keep their MCP names (no server prefix), as the fixtures expect.
export async function connectCustomersMcp(opts: { serviceToken: string; legacyApiUrl: string; nodeOptions?: string }): Promise<CustomersMcp> {
  const env: Record<string, string> = { SERVICE_TOKEN: opts.serviceToken, LEGACY_API_URL: opts.legacyApiUrl, LOG_LEVEL: 'warn' };
  if (opts.nodeOptions !== undefined) env.NODE_OPTIONS = opts.nodeOptions;
  const client = new MultiServerMCPClient({
    mcpServers: { customers: { transport: 'stdio', command: process.execPath, args: [MCP_MAIN_PATH], env, stderr: 'ignore' } },
    prefixToolNameWithServerName: false,
    throwOnLoadError: true,
    onConnectionError: 'throw',
  });
  try {
    return { tools: await client.getTools(), close: () => client.close() };
  } catch (err) {
    await client.close();
    throw err;
  }
}

// limits overrides the ceilings (the defaults are the ones of spec 7.3); the tests use it
// to show the model-call ceiling, which the tool-call ceiling otherwise reaches first.
export function createCustomerAgent(opts: { model: BaseChatModel; tools: StructuredToolInterface[]; memory: boolean; limits?: Partial<AgentLimits> }) {
  const modelCalls = opts.limits?.modelCalls ?? MAX_MODEL_CALLS_PER_TURN;
  const toolCalls = opts.limits?.toolCalls ?? MAX_TOOL_CALLS_PER_TURN;
  return createAgent({
    model: opts.model,
    tools: opts.tools,
    systemPrompt: SYSTEM_PROMPT_V1,
    checkpointer: opts.memory ? new MemorySaver() : undefined,
    middleware: [
      modelCallLimitMiddleware({ runLimit: modelCalls, exitBehavior: 'error' }),
      toolCallLimitMiddleware({ runLimit: toolCalls, exitBehavior: 'error' }),
    ],
  }).withConfig({ recursionLimit: recursionLimitFor(modelCalls) });
}

export type CustomerAgent = ReturnType<typeof createCustomerAgent>;

export type ToolTrace = { name: string; text: string; error: boolean };

// With memory, a failed turn (a ceiling, a script miss, a model error) would stay in the
// thread's checkpoint: its run counters (the middleware resets them only when a turn
// ends well), so every later turn would start over the ceiling, and an AIMessage whose
// tool calls never got an answer, which real model APIs reject. So the thread goes back
// to where it was before the turn: the checkpoint before it, or no checkpoint at all.
async function rollBackFailedTurn(agent: CustomerAgent, threadId: string, before: Awaited<ReturnType<CustomerAgent['graph']['getState']>>): Promise<void> {
  if (before.config.configurable?.checkpoint_id === undefined) {
    const saver = agent.checkpointer;
    if (typeof saver === 'object') await saver.deleteThread(threadId);
    return;
  }
  await agent.graph.updateState(before.config, before.values);
}

// One user turn: the text of the last AIMessage and the tool results of this turn.
export async function askWithTrace(agent: CustomerAgent, text: string, threadId: string): Promise<{ answer: string; tools: ToolTrace[] }> {
  const config = { configurable: { thread_id: threadId } };
  const before = typeof agent.checkpointer === 'object' ? await agent.graph.getState(config) : undefined;
  let state: Awaited<ReturnType<CustomerAgent['invoke']>>;
  try {
    state = await agent.invoke({ messages: [new HumanMessage(text)] }, config);
  } catch (err) {
    if (before !== undefined) await rollBackFailedTurn(agent, threadId, before);
    throw err;
  }
  const messages = [...state.messages];
  let turnStart = messages.length - 1;
  while (turnStart >= 0 && messages[turnStart]!.type !== 'human') turnStart -= 1;
  const turn = messages.slice(turnStart + 1);
  const last = [...turn].reverse().find((m) => m.type === 'ai');
  if (last === undefined) throw new Error('the agent finished without an AI message');
  const tools = turn.filter((m) => m.type === 'tool').map((m) => {
    const tm = m as typeof m & { name?: string; status?: 'success' | 'error' };
    return { name: tm.name ?? '?', text: contentText(tm.content), error: tm.status === 'error' };
  });
  return { answer: contentText(last.content), tools };
}

// One user turn; returns the text of the last AIMessage.
export async function ask(agent: CustomerAgent, text: string, threadId: string): Promise<string> {
  return (await askWithTrace(agent, text, threadId)).answer;
}
