// Optional live check with a real model through OpenRouter (spec 7.4, AGT-06). Outside
// the npm test glob (.live.ts) and skipped without OPENROUTER_API_KEY. Asserts database
// state and the numeric id, never the exact wording (the model chooses it).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ask, connectCustomersMcp, createCustomerAgent } from '../../examples/agent/agent.ts';
import { loadAgentConfig } from '../../examples/agent/config.ts';
import { createChatModel } from '../../examples/agent/model.ts';
import { startTestApi } from '../support/api-harness.ts';

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
const skip = apiKey ? false : 'OPENROUTER_API_KEY is not set';

async function liveAgent(t: TestContext) {
  const config = loadAgentConfig({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: apiKey, OPENROUTER_MODEL: process.env.OPENROUTER_MODEL });
  const api = await startTestApi(t);
  const mcp = await connectCustomersMcp({ serviceToken: api.issueToken('admin'), legacyApiUrl: api.url });
  t.after(() => mcp.close());
  return { api, agent: createCustomerAgent({ model: createChatModel(config), tools: mcp.tools, memory: true }) };
}

test('[AGT-06] create-then-ask-id with a real model creates the customer and answers its id', { skip, timeout: 120_000 }, async (t) => {
  const { api, agent } = await liveAgent(t);
  await ask(agent, 'create a customer named ana souza, email ana.souza@example.com, phone 11 98888-7777, segment smb', 'live-1');
  const row = api.db.prepare('SELECT cst_id FROM customers WHERE cst_eml = ?').get('ana.souza@example.com') as { cst_id: number } | undefined;
  assert.ok(row !== undefined, 'the customer was not created');
  assert.match(await ask(agent, 'what is her id?', 'live-1'), new RegExp(`\\b${row.cst_id}\\b`));
});

test('[AGT-06] deactivate-teodoro with a real model sets cst_sts to I', { skip, timeout: 120_000 }, async (t) => {
  const { api, agent } = await liveAgent(t);
  await ask(agent, 'deactivate customer teodoro', 'live-2');
  const row = api.db.prepare("SELECT cst_sts FROM customers WHERE cst_nm = 'Teodoro Escarlate'").get() as { cst_sts: string };
  assert.equal(row.cst_sts, 'I');
});
