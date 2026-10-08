// Scripted router of the fake model (spec 7.2): a pure function from (fixture,
// messages) to the next AIMessage. It picks the reply by the input, never by call
// order, and takes every value (id, name) from the real tool results it receives.
//
// 1. The turn key is the last HumanMessage, normalized (lowercase, collapsed spaces).
// 2. The step is the number of AIMessages after that HumanMessage.
// 3. {{tool:X.path}} reads the latest successful result of tool X in the current turn;
//    {{history:X.path}} reads it anywhere in the received history; {{error:X}} is the
//    text of the latest error ToolMessage of X in the current turn.
// 4. An unresolved placeholder uses the step's ifUnresolved, or raises.
// 5. A turn without a fixture raises FakeScriptMissError with the known keys.
import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Fixture, FixtureStep } from './fixture-schema.ts';

export class FakeScriptMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeScriptMissError';
  }
}

export const normalizeKey = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

type ToolResult = { tool: string; text: string; error: boolean; inTurn: boolean };

const PLACEHOLDER = /\{\{(tool|history|error):([^}]+)\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{(tool|history|error):([^}]+)\}\}$/;
const UNRESOLVED = Symbol('unresolved');

// Message content as plain text: a string, or the text of its { type: 'text' } blocks.
export function contentText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((block) => {
    if (typeof block === 'string') return block;
    const b = block as { type?: string; text?: unknown };
    return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
  }).join('');
}

// Tool results in order. The tool name of each ToolMessage comes from the tool_calls of
// the AIMessages before it, matched by tool_call_id.
function collectToolResults(messages: BaseMessage[], turnStart: number): ToolResult[] {
  const nameById = new Map<string, string>();
  const results: ToolResult[] = [];
  messages.forEach((m, index) => {
    if (m.type === 'ai') {
      for (const call of (m as AIMessage).tool_calls ?? []) if (call.id !== undefined) nameById.set(call.id, call.name);
    } else if (m.type === 'tool') {
      const tm = m as BaseMessage & { tool_call_id: string; status?: 'success' | 'error' };
      const tool = nameById.get(tm.tool_call_id);
      if (tool !== undefined) results.push({ tool, text: contentText(tm.content), error: tm.status === 'error', inTurn: index > turnStart });
    }
  });
  return results;
}

function readPath(json: string, path: string[]): unknown {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return UNRESOLVED;
  }
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return UNRESOLVED;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : UNRESOLVED;
}

function resolvePlaceholder(kind: string, ref: string, results: ToolResult[]): unknown {
  const [tool, ...path] = ref.trim().split('.');
  const latest = (pick: (r: ToolResult) => boolean) => results.filter((r) => r.tool === tool && pick(r)).at(-1);
  if (kind === 'error') return latest((r) => r.error && r.inTurn)?.text ?? UNRESOLVED;
  const found = latest((r) => !r.error && (kind === 'history' || r.inTurn));
  return found === undefined ? UNRESOLVED : readPath(found.text, path);
}

// Resolves every placeholder in a value. A string that is a single placeholder keeps the
// type of the resolved value (an id stays a number in tool arguments).
function resolveValue(value: unknown, results: ToolResult[], missing: string[]): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(value);
    if (whole !== null) {
      const resolved = resolvePlaceholder(whole[1]!, whole[2]!, results);
      if (resolved === UNRESOLVED) missing.push(`${whole[1]}:${whole[2]}`);
      return resolved === UNRESOLVED ? value : resolved;
    }
    return value.replace(PLACEHOLDER, (text, kind: string, ref: string) => {
      const resolved = resolvePlaceholder(kind, ref, results);
      if (resolved === UNRESOLVED) missing.push(`${kind}:${ref}`);
      return resolved === UNRESOLVED ? text : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, results, missing));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, results, missing)]));
  }
  return value;
}

function stepReply(fixture: Fixture, key: string, stepIndex: number, step: FixtureStep, results: ToolResult[], idPrefix: string): AIMessage | FakeScriptMissError {
  const missing: string[] = [];
  const reply = 'final' in step
    ? new AIMessage(String(resolveValue(step.final, results, missing)))
    : new AIMessage({
      content: '',
      tool_calls: step.toolCalls.map((call, i) => ({
        id: `${idPrefix}_${i}`,
        name: call.name,
        args: resolveValue(call.args, results, missing) as Record<string, unknown>,
        type: 'tool_call' as const,
      })),
    });
  if (missing.length === 0) return reply;
  if (step.ifUnresolved !== undefined) return new AIMessage(step.ifUnresolved);
  return new FakeScriptMissError(`unresolved placeholder ${missing.map((m) => `{{${m}}}`).join(', ')} in step ${stepIndex + 1} of turn "${key}" in scenario ${fixture.scenario}`);
}

export function routeScriptedTurn(fixture: Fixture, messages: BaseMessage[]): AIMessage | FakeScriptMissError {
  let turnStart = messages.length - 1; // findLastIndex is ES2023; the project targets ES2022
  while (turnStart >= 0 && messages[turnStart]!.type !== 'human') turnStart -= 1;
  if (turnStart === -1) return new FakeScriptMissError(`no human message in the input of scenario ${fixture.scenario}`);
  const key = normalizeKey(contentText(messages[turnStart]!.content));
  const turn = fixture.turns.find((t) => normalizeKey(t.match) === key);
  if (turn === undefined) {
    const known = fixture.turns.map((t) => `"${normalizeKey(t.match)}"`).join(', ');
    return new FakeScriptMissError(`no turn matches "${key}" in scenario ${fixture.scenario}; known: [${known}]`);
  }
  const stepIndex = messages.slice(turnStart + 1).filter((m) => m.type === 'ai').length;
  const step = turn.steps[stepIndex];
  if (step === undefined) {
    return new FakeScriptMissError(`turn "${key}" in scenario ${fixture.scenario} has no step ${stepIndex + 1} (scripted steps: ${turn.steps.length})`);
  }
  // Ids unique within a thread: the history only grows between model calls.
  return stepReply(fixture, key, stepIndex, step, collectToolResults(messages, turnStart), `fake_${messages.length}`);
}
