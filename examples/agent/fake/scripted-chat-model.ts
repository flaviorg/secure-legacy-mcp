// Thin chat model over the scripted router (spec 7.1): bindTools returns the same
// instance (the router does not need the tool list) and _generate either returns the
// routed AIMessage or throws FakeScriptMissError. The system prompt is ignored.
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { Fixture } from './fixture-schema.ts';
import { contentText, FakeScriptMissError, routeScriptedTurn } from './scripted-router.ts';

export class ScriptedChatModel extends BaseChatModel {
  readonly fixture: Fixture;

  constructor(fields: { fixture: Fixture }) {
    super({});
    this.fixture = fields.fixture;
  }

  _llmType(): 'scripted' {
    return 'scripted';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const reply = routeScriptedTurn(this.fixture, messages);
    if (reply instanceof FakeScriptMissError) throw reply;
    return { generations: [{ message: reply, text: contentText(reply.content) }] };
  }
}
