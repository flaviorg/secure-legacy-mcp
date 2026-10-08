// Chat model factory (spec 7.1): the scripted fake by default, or a real model through
// OpenRouter's OpenAI-compatible endpoint.
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { AgentConfig } from './config.ts';
import type { Fixture } from './fake/fixture-schema.ts';
import { ScriptedChatModel } from './fake/scripted-chat-model.ts';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function createChatModel(config: AgentConfig, fixture?: Fixture): BaseChatModel {
  if (config.provider === 'openrouter') {
    return new ChatOpenAI({ model: config.model, apiKey: config.apiKey, configuration: { baseURL: OPENROUTER_BASE_URL } });
  }
  if (fixture === undefined) throw new Error('the fake provider needs a fixture (examples/agent/fixtures/*.json)');
  return new ScriptedChatModel({ fixture });
}
