// Tool wrapper (spec 5.6): every handler runs here, with its own requestId, one
// `tool_call` log line and a total try/catch. Nothing is thrown to the SDK, so the
// model only ever sees the catalog text, never a raw exception message.
import { randomUUID } from 'node:crypto';
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { Logger } from '../../shared/logger.ts';
import { DomainError, errorMessage, RETRYABLE } from '../domain/errors.ts';
import type { ErrorCode, ErrorDetails } from '../domain/errors.ts';
import type { CallContext } from '../domain/ports.ts';

export type ToolDeps = { logger: Logger; newRequestId?: () => string }; // default: crypto.randomUUID

const ERROR_META_KEY = 'secure-legacy-mcp/error';

type ToolErrorMeta = {
  code: ErrorCode;
  retryable: boolean;
  requestId: string;
  retryAfterSeconds?: number;
  scope?: 'ip' | 'token';
};

function errorResult(code: ErrorCode, details: ErrorDetails, requestId: string): CallToolResult {
  const meta: ToolErrorMeta = { code, retryable: RETRYABLE[code], requestId };
  if (details.retryAfterSeconds !== undefined) meta.retryAfterSeconds = details.retryAfterSeconds;
  if (details.scope !== undefined) meta.scope = details.scope;
  return {
    isError: true,
    content: [{ type: 'text', text: errorMessage(code, details, requestId) }],
    _meta: { [ERROR_META_KEY]: meta },
  };
}

export async function executeTool<O extends object>(toolName: string, deps: ToolDeps, run: (ctx: CallContext) => Promise<O>): Promise<CallToolResult> {
  const requestId = (deps.newRequestId ?? randomUUID)();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const out = await run({ requestId });
    deps.logger.info('tool_call', { tool: toolName, requestId, durationMs: elapsed(), outcome: 'ok' });
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out as Record<string, unknown> };
  } catch (err) {
    if (err instanceof DomainError) {
      deps.logger.warn('tool_call', {
        tool: toolName, requestId, durationMs: elapsed(), outcome: 'error', errorCode: err.code, upstreamStatus: err.details.upstreamStatus,
      });
      return errorResult(err.code, err.details, requestId);
    }
    // Unexpected: the detail (message and stack, redacted by the logger) stays in stderr.
    deps.logger.error('tool_internal_error', { tool: toolName, requestId, error: err });
    deps.logger.error('tool_call', { tool: toolName, requestId, durationMs: elapsed(), outcome: 'error', errorCode: 'INTERNAL' });
    return errorResult('INTERNAL', {}, requestId);
  }
}

export type ToolDefinition<I extends z.ZodObject, O extends z.ZodObject> = {
  name: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  annotations: ToolAnnotations;
  handler(input: z.output<I>, ctx: CallContext): Promise<z.output<O>>;
};

// The SDK types the callback through a conditional type that stays unresolved for a
// generic schema, so registration uses the base ZodObject and narrows the input back:
// the SDK has already parsed it with def.inputSchema before calling the callback.
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(server: McpServer, deps: ToolDeps, def: ToolDefinition<I, O>): void {
  const callback: ToolCallback<z.ZodObject> = (input) => executeTool(def.name, deps, (ctx) => def.handler(input as z.output<I>, ctx));
  server.registerTool<z.ZodObject, z.ZodObject>(
    def.name,
    { description: def.description, inputSchema: def.inputSchema, outputSchema: def.outputSchema, annotations: def.annotations },
    callback,
  );
}
