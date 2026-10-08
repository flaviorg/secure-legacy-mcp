// The agent's ceilings and their edges (spec 7.3, AGT-04): the graph step limit, the
// model-call ceiling, a failed turn and the memory of its thread, and the system prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { ToolCallLimitExceededError } from 'langchain';
import { ask } from '../../examples/agent/agent.ts';
import { ScriptedChatModel } from '../../examples/agent/fake/scripted-chat-model.ts';
import { contentText } from '../../examples/agent/fake/scripted-router.ts';
import { SYSTEM_PROMPT_V1 } from '../../examples/agent/prompts/v1/system.ts';
import { CREATE_ANA as T1, exampleFixture, searches, startAgent, testFixture } from '../support/agent-harness.ts';

test('[AGT-04] a turn with exactly 4 sequential tool calls finishes: only a 5th call hits the ceiling', async (t) => {
  // 4 tool calls, each in its own model step, and a final answer: 5 model calls. The
  // graph's own step limit must not stop the turn before the middleware ceilings do.
  const { api, agent } = await startAgent(t, testFixture('four-searches'));
  assert.equal(await ask(agent, 'busque quatro vezes', 'th-1'), 'Fiz 4 buscas; a última trouxe 30 clientes.');
  assert.equal(searches(api), 4);
});

test('[AGT-04] with the tool ceiling raised, the model-call ceiling stops the turn after 6 model calls', async (t) => {
  const { api, agent } = await startAgent(t, testFixture('runaway-loop'), { limits: { toolCalls: 10 } });
  await assert.rejects(ask(agent, 'liste todos os clientes', 'th-1'), (err: Error) => {
    assert.equal(err.name, 'ModelCallLimitMiddlewareError');
    assert.match(err.message, /run level call limit reached with 6 model calls/);
    return true;
  });
  // Each of the 6 model calls asked for one search; the 7th call never reached the model.
  assert.equal(searches(api), 6);
});

test('[AGT-04] a failed turn leaves no trace in the memory of its thread', async (t) => {
  const { api, agent } = await startAgent(t, testFixture('failed-turn-memory'));
  const thread = { configurable: { thread_id: 'th-1' } };
  const messagesOf = async () => ((await agent.graph.getState(thread)).values as { messages?: BaseMessage[] }).messages ?? [];

  // A first turn that fails leaves the thread empty.
  await assert.rejects(ask(agent, 'liste todos os clientes', 'th-1'), ToolCallLimitExceededError);
  assert.deepEqual(await messagesOf(), []);

  const first = await ask(agent, T1, 'th-1');
  const id = (api.db.prepare('SELECT cst_id FROM customers WHERE cst_eml = ?').get('ana.souza@example.com') as { cst_id: number }).cst_id;
  assert.equal(first, `Cliente Ana Souza cadastrado com id ${id}.`);

  // A later turn that fails is rolled back: the next turn starts below the ceiling (it
  // needs 2 tool calls) and still sees the turns before the failure.
  await assert.rejects(ask(agent, 'liste todos os clientes', 'th-1'), ToolCallLimitExceededError);
  assert.match(await ask(agent, 'desative o cliente teodoro', 'th-1'), /agora está inactive\.$/);
  assert.equal((api.db.prepare("SELECT cst_sts FROM customers WHERE cst_nm = 'Teodoro Escarlate'").get() as { cst_sts: string }).cst_sts, 'I');
  assert.equal(await ask(agent, 'qual é o id dele?', 'th-1'), `O id de Ana Souza é ${id}.`);

  // Only the successful turns are in memory, and every tool call there has its answer.
  const messages = await messagesOf();
  assert.deepEqual(messages.filter((m) => m.type === 'human').map((m) => m.content), [T1, 'desative o cliente teodoro', 'qual é o id dele?']);
  const answered = new Set(messages.filter((m) => m.type === 'tool').map((m) => (m as BaseMessage & { tool_call_id: string }).tool_call_id));
  const calls = messages.flatMap((m) => (m.type === 'ai' ? (m as AIMessage).tool_calls ?? [] : []));
  assert.ok(calls.length === 3 && calls.every((c) => c.id !== undefined && answered.has(c.id)));
});

test('the agent sends SYSTEM_PROMPT_V1 first on every model call (spec 7.3)', async (t) => {
  const seen: BaseMessage[] = [];
  class RecordingModel extends ScriptedChatModel {
    override async _generate(messages: BaseMessage[]) {
      seen.push(messages[0]!);
      return super._generate(messages);
    }
  }
  const fixture = exampleFixture('deactivate-teodoro');
  const { agent } = await startAgent(t, fixture, { memory: false, model: new RecordingModel({ fixture }) });
  await ask(agent, 'desative o cliente teodoro', 'th-1');
  assert.equal(seen.length, 3);
  for (const first of seen) {
    assert.equal(first.type, 'system');
    assert.equal(contentText(first.content), SYSTEM_PROMPT_V1); // createAgent sends it as a text block
  }
});
