// HTTP adapter for the legacy API (spec 4.4, 5.2 and 6.1). The only module of the MCP
// server that talks HTTP. It builds URLs and headers, applies one timeout per attempt,
// retries reads once, and maps every status to a DomainError of the catalog.
import type { Logger } from '../../shared/logger.ts';
import { maskTokens } from '../../shared/token-pattern.ts';
import type { Customer, CustomerWritable, NewCustomer } from '../domain/customer.ts';
import { DomainError } from '../domain/errors.ts';
import type { ErrorDetails } from '../domain/errors.ts';
import type { CallContext, Caller, CustomerFilter, CustomerGateway, Page } from '../domain/ports.ts';
import { toCaller, toCustomer, toCustomerList, toLegacyQuery, toLegacyWritable, toMutationId } from './legacy-mapper.ts';

type LegacyGatewayDeps = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
  logger: Logger;
  userAgent: string;
};

type Method = 'GET' | 'POST' | 'PUT';
type Call = { method: Method; path: string; query?: Record<string, string>; body?: unknown; ctx: CallContext };
type RawReply = { status: number; headers: Headers; text: string };
type JsonReply = { status: number; json: unknown };

const MAX_PAGE = 50;
const DEFAULT_PAGE = 10;
const MAX_LOGGED_BODY = 500;
const READ_ATTEMPTS = 2;
const BAD_PARAMETERS = 'the customers API rejected the parameters';

// Masks the whole body, then truncates, so the logged text never depends on where the
// cut falls (maskTokens swallows a secret of any length, so a cut token is masked too).
const loggableBody = (text: string) => maskTokens(text).slice(0, MAX_LOGGED_BODY);

const clampPage = (page: Page): Page => ({
  limit: Number.isFinite(page.limit) ? Math.min(MAX_PAGE, Math.max(1, Math.trunc(page.limit))) : DEFAULT_PAGE,
  offset: Number.isFinite(page.offset) ? Math.max(0, Math.trunc(page.offset)) : 0,
});

const intHeader = (headers: Headers, name: string): number | undefined => {
  const value = headers.get(name);
  return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
};

function rateLimitDetails(reply: RawReply): ErrorDetails {
  const details: ErrorDetails = {};
  const retryAfterSeconds = intHeader(reply.headers, 'retry-after');
  const limit = intHeader(reply.headers, 'x-ratelimit-limit');
  const scope = reply.headers.get('x-ratelimit-scope');
  if (retryAfterSeconds !== undefined) details.retryAfterSeconds = retryAfterSeconds;
  if (limit !== undefined) details.limit = limit;
  if (scope === 'ip' || scope === 'token') details.scope = scope;
  details.upstreamStatus = reply.status;
  return details;
}

export function createLegacyCustomerGateway(deps: LegacyGatewayDeps): CustomerGateway {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const baseUrl = deps.baseUrl.replace(/\/+$/, '');
  const log = deps.logger;

  const logFailure = (call: Call, reply: RawReply, attempt?: number) => log.warn('upstream_failure', {
    requestId: call.ctx.requestId, method: call.method, path: call.path, attempt,
    upstreamStatus: reply.status, upstreamBody: loggableBody(reply.text),
  });

  // One attempt with its own timeout signal. Network errors, timeouts and a body that
  // cannot be read all become UPSTREAM_UNAVAILABLE.
  async function attemptOnce(call: Call, attempt: number): Promise<RawReply> {
    const url = new URL(baseUrl + call.path);
    for (const [key, value] of Object.entries(call.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      authorization: `Bearer ${deps.token}`,
      'x-request-id': call.ctx.requestId,
      accept: 'application/json',
      'user-agent': deps.userAgent,
    };
    if (call.body !== undefined) headers['content-type'] = 'application/json';
    const started = performance.now();
    try {
      const response = await doFetch(url, {
        method: call.method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
        signal: AbortSignal.timeout(deps.timeoutMs),
        redirect: 'manual',
      });
      const text = await response.text();
      log.debug('upstream_call', { requestId: call.ctx.requestId, method: call.method, path: call.path, attempt, upstreamStatus: response.status, durationMs: Math.round(performance.now() - started) });
      return { status: response.status, headers: response.headers, text };
    } catch (err) {
      const e = err as { name?: unknown; message?: unknown; cause?: { code?: unknown } };
      log.warn('upstream_unreachable', {
        requestId: call.ctx.requestId, method: call.method, path: call.path, attempt,
        errorName: String(e?.name ?? 'Error'), errorMessage: maskTokens(String(e?.message ?? err)),
        errorCode: e?.cause?.code === undefined ? undefined : String(e.cause.code),
        durationMs: Math.round(performance.now() - started),
      });
      throw new DomainError('UPSTREAM_UNAVAILABLE', {}, { cause: err });
    }
  }

  // GET is retried once, without waiting, on network error, timeout or 5xx (MCP-10).
  // Writes are never retried.
  async function send(call: Call): Promise<RawReply> {
    const attempts = call.method === 'GET' ? READ_ATTEMPTS : 1;
    for (let attempt = 1; ; attempt++) {
      let reply: RawReply;
      try {
        reply = await attemptOnce(call, attempt);
      } catch (err) {
        if (attempt < attempts) continue;
        throw err;
      }
      if (reply.status >= 500) {
        logFailure(call, reply, attempt);
        if (attempt < attempts) continue;
      }
      return reply;
    }
  }

  const contractError = (call: Call, reply: RawReply, cause?: unknown): DomainError => {
    logFailure(call, reply);
    return new DomainError('UPSTREAM_CONTRACT', { upstreamStatus: reply.status }, { cause });
  };

  // 2xx -> parsed JSON; 404 -> returned when the caller handles it; anything else
  // -> the DomainError of the catalog (spec 5.6).
  async function request(call: Call, opts: { allowNotFound?: boolean } = {}): Promise<JsonReply> {
    const reply = await send(call);
    const upstreamStatus = reply.status;
    if (upstreamStatus >= 200 && upstreamStatus < 300) {
      try {
        return { status: upstreamStatus, json: JSON.parse(reply.text) as unknown };
      } catch (err) {
        throw contractError(call, reply, err);
      }
    }
    switch (upstreamStatus) {
      case 400: throw new DomainError('INVALID_INPUT', { rule: BAD_PARAMETERS, upstreamStatus });
      case 401: throw new DomainError('AUTH_INVALID', { upstreamStatus });
      case 403: throw new DomainError('FORBIDDEN', { upstreamStatus });
      case 404:
        if (opts.allowNotFound) return { status: 404, json: null };
        throw contractError(call, reply);
      case 409: throw new DomainError('CONFLICT', { upstreamStatus });
      case 429: throw new DomainError('RATE_LIMITED', rateLimitDetails(reply));
    }
    if (upstreamStatus >= 500) throw new DomainError('UPSTREAM_ERROR', { upstreamStatus });
    throw contractError(call, reply);
  }

  // Runs a mapper over a 2xx body; a payload outside the legacy schema is logged and
  // becomes UPSTREAM_CONTRACT with the upstream status (MCP-15).
  function mapReply<T>(call: Call, reply: JsonReply, map: (raw: unknown) => T): T {
    try {
      return map(reply.json);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'UPSTREAM_CONTRACT') {
        throw contractError(call, { status: reply.status, headers: new Headers(), text: JSON.stringify(reply.json) ?? '' }, err.cause);
      }
      throw err;
    }
  }

  const customerPath = (id: number) => `/v1/customers/${encodeURIComponent(String(id))}`;

  return {
    async getById(id: number, ctx: CallContext): Promise<Customer | null> {
      const call: Call = { method: 'GET', path: customerPath(id), ctx };
      const reply = await request(call, { allowNotFound: true });
      return reply.status === 404 ? null : mapReply(call, reply, toCustomer);
    },

    async search(filter: CustomerFilter, page: Page, ctx: CallContext): Promise<{ items: Customer[]; total: number }> {
      const { limit, offset } = clampPage(page);
      const query = { ...toLegacyQuery(filter), lim: String(limit), off: String(offset) };
      const call: Call = { method: 'GET', path: '/v1/customers', query, ctx };
      const { items, total } = mapReply(call, await request(call), toCustomerList);
      return { items, total };
    },

    async create(input: NewCustomer, ctx: CallContext): Promise<{ id: number }> {
      const { cst_sts: _status, ...body } = toLegacyWritable({ ...input, status: 'active' }); // POST takes no status
      const call: Call = { method: 'POST', path: '/v1/customers', body, ctx };
      return { id: mapReply(call, await request(call), toMutationId) };
    },

    async replace(id: number, data: CustomerWritable, ctx: CallContext): Promise<void> {
      const call: Call = { method: 'PUT', path: customerPath(id), body: toLegacyWritable(data), ctx };
      const reply = await request(call, { allowNotFound: true });
      if (reply.status === 404) throw new DomainError('NOT_FOUND', { id, upstreamStatus: 404 });
      mapReply(call, reply, toMutationId);
    },

    async whoami(ctx: CallContext): Promise<Caller> {
      const call: Call = { method: 'GET', path: '/v1/auth/whoami', ctx };
      return mapReply(call, await request(call), toCaller);
    },
  };
}
