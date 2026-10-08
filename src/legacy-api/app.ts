import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../shared/clock.ts';
import { maskTokens } from '../shared/token-pattern.ts';
import { createAuthHook } from './auth/auth-hook.ts';
import { createTokenStore } from './auth/token-store.ts';
import { createCustomerRepository } from './db/customer-repository.ts';
import { createRateLimitHooks } from './rate-limit/rate-limit-hooks.ts';
import { registerCustomerRoutes } from './routes/customers.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerWhoamiRoutes } from './routes/whoami.ts';

export type Limits = { perToken: number; perIp: number; windowMs: number };
export const DEFAULT_LIMITS: Limits = { perToken: 90, perIp: 180, windowMs: 60_000 };

const BODY_LIMIT_BYTES = 16 * 1024;
// Only a UUID received in x-request-id becomes the request id (spec 4.4, SEC-13).
const REQUEST_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACTED_PATHS = ['req.headers.authorization'];
const INTERNAL_ERROR = { erro: 'erro interno' } as const;
const NOT_FOUND = { msg: 'nao encontrado' } as const;

type LoggedRequest = { method: string; url: string; headers?: Record<string, unknown>; host?: string; ip?: string; socket?: { remotePort?: number } };
type ReqSerializer = (req: LoggedRequest) => unknown;
type LoggerBase = { redact?: string[] | { paths: string[] }; serializers?: Record<string, unknown> & { req?: ReqSerializer } };

// The same fields as Fastify's default request serializer.
const fastifyReqFields: ReqSerializer = (req) => ({
  method: req.method,
  url: req.url,
  version: req.headers?.['accept-version'],
  host: req.host,
  remoteAddress: req.ip,
  remotePort: req.socket?.remotePort,
});

// A token pasted into the query string (`?token=slm_...`) is refused, but Fastify logs
// the URL: any token-shaped text in it becomes `slm_<id>_***` (SEC-09).
function maskingUrl(serialize: ReqSerializer): ReqSerializer {
  return (req) => {
    const out = serialize(req);
    if (out === null || typeof out !== 'object' || typeof (out as { url?: unknown }).url !== 'string') return out;
    return { ...out, url: maskTokens((out as { url: string }).url) };
  };
}

// Adds the Authorization redaction and the URL masking to any logger options; `false`
// stays off.
function loggerOptions(logger: boolean | object): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  const base = (logger === true ? {} : logger) as LoggerBase;
  const redact = Array.isArray(base.redact)
    ? [...base.redact, ...REDACTED_PATHS]
    : base.redact ? { ...base.redact, paths: [...base.redact.paths, ...REDACTED_PATHS] } : REDACTED_PATHS;
  const serializers = { ...base.serializers, req: maskingUrl(base.serializers?.req ?? fastifyReqFields) };
  return { ...base, redact, serializers } as FastifyServerOptions['logger'];
}

// Composes hooks and routes. Does not call ready() or listen(): the caller can still
// register hooks (only the test harness does that).
export async function buildApp(deps: { db: DatabaseSync; clock: Clock; limits: Limits; logger: boolean | object }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(deps.logger),
    requestIdHeader: false,
    genReqId(req) {
      const received = req.headers['x-request-id'];
      return typeof received === 'string' && REQUEST_ID_UUID.test(received) ? received : randomUUID();
    },
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: false,
  });

  const tokens = createTokenStore(deps.db, deps.clock);
  const rateLimit = createRateLimitHooks({ limits: deps.limits, clock: deps.clock });
  app.decorateRequest('caller', null);
  app.decorateRequest('rateLimit', null);

  // onRequest order (spec 4.1): IP bucket, authentication, token bucket. The role
  // check is per route, in preValidation (see require-role.ts).
  app.addHook('onRequest', rateLimit.ipHook);
  app.addHook('onRequest', createAuthHook(tokens));
  app.addHook('onRequest', rateLimit.tokenHook);

  app.addHook('onSend', rateLimit.headersHook);
  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('x-request-id', request.id);
    done(null, payload);
  });

  // One audit line per write attempt; never the Authorization value.
  app.addHook('onResponse', (request, reply, done) => {
    if (WRITE_METHODS.has(request.method)) {
      request.log.info({
        audit: true,
        tokenId: request.caller?.tokenId ?? null,
        role: request.caller?.role ?? null,
        method: request.method,
        route: request.routeOptions.url ?? null,
        status: reply.statusCode,
      }, 'audit');
    }
    done();
  });

  // Client errors raised by Fastify itself (body validation, malformed JSON, 413)
  // keep its default body: rethrowing hands them to the default handler. Anything else
  // is a 500 with a generic body; the detail goes only to the log (SEC-14). The PUT
  // trap (API-04) answers by itself and never reaches this handler.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) throw error;
    request.log.error({ err: error }, 'unexpected error');
    return reply.code(500).send(INTERNAL_ERROR);
  });
  // Unknown routes run the onRequest hooks first, so an anonymous caller gets 401.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(NOT_FOUND));

  const repository = createCustomerRepository(deps.db, deps.clock);
  registerHealthRoutes(app);
  registerWhoamiRoutes(app);
  registerCustomerRoutes(app, { repository, db: deps.db });

  return app;
}
