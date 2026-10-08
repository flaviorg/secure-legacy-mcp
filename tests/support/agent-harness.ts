// Agent e2e harness: a real legacy API in process, the real MCP server as a child process
// (with the network guard) and the example agent, by default over the scripted fake.
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { connectCustomersMcp, createCustomerAgent } from '../../examples/agent/agent.ts';
import type { AgentLimits } from '../../examples/agent/agent.ts';
import { loadFixture } from '../../examples/agent/fake/fixture-schema.ts';
import type { Fixture } from '../../examples/agent/fake/fixture-schema.ts';
import { ScriptedChatModel } from '../../examples/agent/fake/scripted-chat-model.ts';
import type { Role } from '../../src/legacy-api/auth/token-store.ts';
import { startTestApi } from './api-harness.ts';
import type { TestApi } from './api-harness.ts';
import { guardNodeOptions } from './guard-options.ts';

export const exampleFixture = (name: string): Fixture => loadFixture(fileURLToPath(new URL(`../../examples/agent/fixtures/${name}.json`, import.meta.url)));
export const testFixture = (name: string): Fixture => loadFixture(fileURLToPath(new URL(`../agent/fixtures/${name}.json`, import.meta.url)));

export const CREATE_ANA = 'crie um cliente chamado ana souza, e-mail ana.souza@example.com, telefone 11 98888-7777, segmento smb';

export async function startAgent(t: TestContext, fixture: Fixture, opts: { role?: Role; memory?: boolean; limits?: Partial<AgentLimits>; model?: BaseChatModel } = {}) {
  const api = await startTestApi(t);
  const mcp = await connectCustomersMcp({ serviceToken: api.issueToken(opts.role ?? 'admin'), legacyApiUrl: api.url, nodeOptions: guardNodeOptions() });
  t.after(() => mcp.close());
  const model = opts.model ?? new ScriptedChatModel({ fixture });
  return { api, agent: createCustomerAgent({ model, tools: mcp.tools, memory: opts.memory ?? true, ...(opts.limits ? { limits: opts.limits } : {}) }) };
}

// Search requests (GET /v1/customers with a query) that reached the API.
export const searches = (api: TestApi): number => api.requests.filter((r) => r.url.startsWith('/v1/customers?')).length;
