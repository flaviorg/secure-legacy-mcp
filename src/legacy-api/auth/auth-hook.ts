import type { FastifyRequest, onRequestHookHandler } from 'fastify';
import type { Role, TokenStore } from './token-store.ts';

export type Caller = { tokenId: string; name: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

// Routes reachable without a token. They also stay out of both rate-limit buckets.
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/v1/health']);

// Matches on the registered route pattern, so unknown URLs are never public.
export function isPublicRoute(request: FastifyRequest): boolean {
  const url = request.routeOptions.url;
  return url !== undefined && PUBLIC_ROUTES.has(url);
}

const UNAUTHORIZED = { erro: 'nao autorizado' } as const;
const BEARER = /^Bearer +(\S+) *$/i;

// onRequest hook: attaches request.caller from a valid Bearer token or answers 401
// with the same generic body whether the token is missing, malformed, unknown,
// revoked or expired. The role comes only from the token record.
export function createAuthHook(tokens: TokenStore): onRequestHookHandler {
  return function authHook(request, reply, done) {
    request.caller = null;
    if (isPublicRoute(request)) return done();
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    const record = token === undefined ? null : tokens.verify(token);
    if (record === null) {
      reply.code(401).send(UNAUTHORIZED);
      return;
    }
    request.caller = { tokenId: record.id, name: record.name, role: record.role };
    done();
  };
}
