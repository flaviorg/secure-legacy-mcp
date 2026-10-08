import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ChatOpenAI } from '@langchain/openai';
import { loadFixture } from '../../examples/agent/fake/fixture-schema.ts';
import { ScriptedChatModel } from '../../examples/agent/fake/scripted-chat-model.ts';
import { createChatModel } from '../../examples/agent/model.ts';
import { SYSTEM_PROMPT_V1 } from '../../examples/agent/prompts/v1/system.ts';

const fixture = loadFixture(fileURLToPath(new URL('../../examples/agent/fixtures/create-then-ask-id.json', import.meta.url)));

test('createChatModel builds the OpenRouter client with the configured model and key, offline (spec 7.4)', () => {
  // Building the client makes no request; nothing here touches the network.
  const model = createChatModel({ provider: 'openrouter', apiKey: 'test-key-not-real', model: 'some/model' });
  assert.ok(model instanceof ChatOpenAI);
  assert.equal(model.model, 'some/model');
  assert.equal(model.apiKey, 'test-key-not-real');
  assert.equal((model as unknown as { clientConfig: { baseURL?: string } }).clientConfig.baseURL, 'https://openrouter.ai/api/v1');
});

test('createChatModel returns the scripted fake for the fake provider and requires a fixture', () => {
  const model = createChatModel({ provider: 'fake', model: 'openrouter/free' }, fixture);
  assert.ok(model instanceof ScriptedChatModel);
  assert.equal(model.fixture, fixture);
  assert.throws(() => createChatModel({ provider: 'fake', model: 'openrouter/free' }), /needs a fixture/);
});

test('SYSTEM_PROMPT_V1 carries the rules of spec 7.3', () => {
  for (const rule of [
    /Customer data comes only from the tools/,
    /Never guess an id/,
    /resolve it first with getCustomer/,
    /Before any write/,
    /match "ambiguous", stop/,
    /Reply in English/,
  ]) assert.match(SYSTEM_PROMPT_V1, rule);
});
