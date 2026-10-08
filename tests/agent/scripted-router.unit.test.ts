import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { loadAgentConfig } from '../../examples/agent/config.ts';
import { fixtureSchema, loadFixture } from '../../examples/agent/fake/fixture-schema.ts';
import { FakeScriptMissError, routeScriptedTurn } from '../../examples/agent/fake/scripted-router.ts';
import { ConfigError } from '../../src/shared/config-error.ts';

const exampleFixture = (name: string) => loadFixture(fileURLToPath(new URL(`../../examples/agent/fixtures/${name}.json`, import.meta.url)));
const fixture = exampleFixture('create-then-ask-id');
const toolResult = JSON.stringify({ customer: { id: 31, name: 'Ana Souza' } });
const turn1 = 'crie um cliente chamado ana souza, e-mail ana.souza@example.com, telefone 11 98888-7777, segmento smb';
const turn1Messages = () => [
  new HumanMessage(turn1),
  new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'createCustomer', args: {} }] }),
  new ToolMessage({ tool_call_id: 'c1', content: toolResult }),
];

test('[AGT-03] unknown input raises FakeScriptMissError with the normalized key and known keys', () => {
  const r = routeScriptedTurn(fixture, [new HumanMessage('  Algo   Novo ')]);
  assert.ok(r instanceof FakeScriptMissError);
  assert.match(r.message, /"algo novo"/);
  assert.match(r.message, /qual é o id dele\?/);
});

test('emits the scripted tool calls on the first step of a turn', () => {
  const r = routeScriptedTurn(fixture, [new SystemMessage('rules'), new HumanMessage(turn1)]) as AIMessage;
  assert.ok(r instanceof AIMessage);
  assert.equal(r.tool_calls?.[0]?.name, 'createCustomer');
  assert.deepEqual(r.tool_calls?.[0]?.args, { name: 'Ana Souza', email: 'ana.souza@example.com', phone: '11 98888-7777', segment: 'smb' });
});

test('resolves {{tool:X.path}} from the current turn, with string or block content', () => {
  assert.equal((routeScriptedTurn(fixture, turn1Messages()) as AIMessage).content, 'Cliente Ana Souza cadastrado com id 31.');
  const blocks = turn1Messages(); blocks[2] = new ToolMessage({ tool_call_id: 'c1', content: [{ type: 'text', text: toolResult }] });
  assert.equal((routeScriptedTurn(fixture, blocks) as AIMessage).content, 'Cliente Ana Souza cadastrado com id 31.');
});

test('[AGT-01] resolves {{history:X.path}} across turns', () => {
  const msgs = [...turn1Messages(), new AIMessage('Cliente Ana Souza cadastrado com id 31.'), new HumanMessage('Qual é o id dele?')];
  assert.equal((routeScriptedTurn(fixture, msgs) as AIMessage).content, 'O id de Ana Souza é 31.');
});

test('[AGT-02] without history the second turn answers the ifUnresolved text', () => {
  assert.equal((routeScriptedTurn(fixture, [new HumanMessage('qual é o id dele?')]) as AIMessage).content,
    'Não sei a qual cliente você se refere. Pode me dizer o nome ou o e-mail?');
});

test('exposes error ToolMessages through {{error:X}}', () => {
  const f = exampleFixture('member-forbidden');
  const forbidden = '[FORBIDDEN] This action requires the admin role; the configured token does not have it.';
  const msgs = [
    new HumanMessage(f.turns[0]!.match),
    new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'createCustomer', args: {} }] }),
    new ToolMessage({ tool_call_id: 'c1', status: 'error', content: forbidden }),
  ];
  const r = routeScriptedTurn(f, msgs) as AIMessage;
  assert.ok(r instanceof AIMessage);
  assert.ok(String(r.content).includes(forbidden));
  assert.equal(r.tool_calls?.length ?? 0, 0);
});

test('a placeholder that is a whole tool argument keeps the type of the resolved value', () => {
  const f = exampleFixture('deactivate-teodoro');
  const found = JSON.stringify({ match: 'found', customer: { id: 12, name: 'Teodoro Escarlate' }, candidates: [] });
  const msgs = [
    new HumanMessage(f.turns[0]!.match),
    new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'getCustomer', args: {} }] }),
    new ToolMessage({ tool_call_id: 'c1', content: found }),
  ];
  const r = routeScriptedTurn(f, msgs) as AIMessage;
  assert.deepEqual(r.tool_calls?.map((c) => [c.name, c.args]), [['deactivateCustomer', { id: 12 }]]);
});

test('{{tool:X}} never reads a result from an earlier turn, so a write cannot reuse a stale id', () => {
  const f = exampleFixture('deactivate-teodoro');
  const found = JSON.stringify({ match: 'found', customer: { id: 12, name: 'Teodoro Escarlate' }, candidates: [] });
  const msgs = [
    new HumanMessage(f.turns[0]!.match),
    new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'getCustomer', args: {} }] }),
    new ToolMessage({ tool_call_id: 'c1', content: found }),
    new AIMessage({ content: '', tool_calls: [{ id: 'c2', name: 'deactivateCustomer', args: { id: 12 } }] }),
    new ToolMessage({ tool_call_id: 'c2', content: JSON.stringify({ customer: { id: 12, name: 'Teodoro Escarlate', status: 'inactive' } }) }),
    new AIMessage('done'),
    new HumanMessage(f.turns[0]!.match),
    new AIMessage({ content: '', tool_calls: [{ id: 'c3', name: 'getCustomer', args: {} }] }),
    new ToolMessage({ tool_call_id: 'c3', status: 'error', content: '[UPSTREAM_UNAVAILABLE] The customers API is unavailable right now. Try again shortly.' }),
  ];
  const r = routeScriptedTurn(f, msgs);
  assert.ok(r instanceof FakeScriptMissError, 'the stale id from the first turn must not be used');
  assert.match(r.message, /tool:getCustomer\.customer\.id/);
});

test('[AGT-03] an unresolved placeholder without ifUnresolved, or a step past the script, raises FakeScriptMissError', () => {
  const f = exampleFixture('member-forbidden');
  const ok = [
    new HumanMessage(f.turns[0]!.match),
    new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'createCustomer', args: {} }] }),
    new ToolMessage({ tool_call_id: 'c1', content: toolResult }),
  ];
  const unresolved = routeScriptedTurn(f, ok);
  assert.ok(unresolved instanceof FakeScriptMissError);
  assert.match(unresolved.message, /error:createCustomer/);
  const past = routeScriptedTurn(fixture, [...turn1Messages(), new AIMessage('Cliente Ana Souza cadastrado com id 31.')]);
  assert.ok(past instanceof FakeScriptMissError);
  assert.match(past.message, /step 3/);
});

test('fixtures are validated when loaded', () => {
  assert.equal(fixtureSchema.safeParse({ scenario: 'x', description: 'y', turns: [{ match: 'a', steps: [{}] }] }).success, false);
  assert.equal(fixtureSchema.safeParse({ scenario: 'x', description: 'y', turns: [] }).success, false);
  // A step is either tool calls or a final answer, never both (the router would silently pick one).
  const both = { toolCalls: [{ name: 'getCustomer', args: {} }], final: 'x' };
  assert.equal(fixtureSchema.safeParse({ scenario: 'x', description: 'y', turns: [{ match: 'a', steps: [both] }] }).success, false);
  for (const name of ['create-then-ask-id', 'deactivate-teodoro', 'ambiguous-maria', 'member-forbidden']) assert.equal(exampleFixture(name).scenario, name);
});

test('loadAgentConfig picks fake by default, openrouter with a key, and fails fast without one', () => {
  const base = {};
  assert.equal(loadAgentConfig(base).provider, 'fake');
  assert.equal(loadAgentConfig(base).model, 'openrouter/free');
  assert.equal(loadAgentConfig({ ...base, OPENROUTER_API_KEY: 'k' }).provider, 'openrouter');
  assert.equal(loadAgentConfig({ ...base, OPENROUTER_API_KEY: 'k', LLM_PROVIDER: 'fake' }).provider, 'fake');
  assert.throws(() => loadAgentConfig({ ...base, LLM_PROVIDER: 'openrouter' }), ConfigError);
  assert.throws(() => loadAgentConfig({ ...base, LLM_PROVIDER: 'ollama' }), ConfigError);
  assert.equal(loadAgentConfig({ OPENROUTER_API_KEY: ' k \n', OPENROUTER_MODEL: ' m ' }).model, 'm');
  assert.equal(loadAgentConfig({ OPENROUTER_API_KEY: '', LLM_PROVIDER: '' }).provider, 'fake');
});
