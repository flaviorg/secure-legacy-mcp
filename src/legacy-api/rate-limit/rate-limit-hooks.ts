import type { FastifyReply, onRequestHookHandler, onSendHookHandler } from 'fastify';
import type { Clock } from '../../shared/clock.ts';
import type { Limits } from '../app.ts';
import { isPublicRoute } from '../auth/auth-hook.ts';
import { createFixedWindowLimiter } from './fixed-window-limiter.ts';
import type { HitResult } from './fixed-window-limiter.ts';

type RateLimitDecision = HitResult & { scope: 'ip' | 'token' };

declare module 'fastify' {
  interface FastifyRequest {
    // Result of the last bucket that decided this request; null on public routes.
    rateLimit: RateLimitDecision | null;
  }
}

function tooManyRequests(reply: FastifyReply, result: HitResult): void {
  reply.code(429).header('retry-after', String(result.retryAfterSeconds)).send({ erro: 'limite excedido' });
}

// Two buckets (spec 5.2): per IP before authentication (it also counts requests that
// end in 401) and per token after it. Public routes touch neither. The headers come
// from whichever bucket decided last: `ip` for an IP 429 or a 401, `token` otherwise.
export function createRateLimitHooks(deps: { limits: Limits; clock: Clock }): {
  ipHook: onRequestHookHandler;
  tokenHook: onRequestHookHandler;
  headersHook: onSendHookHandler;
} {
  const { limits, clock } = deps;
  const perIp = createFixedWindowLimiter({ max: limits.perIp, windowMs: limits.windowMs, clock });
  const perToken = createFixedWindowLimiter({ max: limits.perToken, windowMs: limits.windowMs, clock });

  const ipHook: onRequestHookHandler = (request, reply, done) => {
    request.rateLimit = null;
    if (isPublicRoute(request)) return done();
    const result = perIp.hit(request.ip);
    request.rateLimit = { ...result, scope: 'ip' };
    if (!result.allowed) return tooManyRequests(reply, result);
    done();
  };

  const tokenHook: onRequestHookHandler = (request, reply, done) => {
    if (request.caller === null || isPublicRoute(request)) return done();
    const result = perToken.hit(request.caller.tokenId);
    request.rateLimit = { ...result, scope: 'token' };
    if (!result.allowed) return tooManyRequests(reply, result);
    done();
  };

  const headersHook: onSendHookHandler = (request, reply, payload, done) => {
    const decision = request.rateLimit;
    if (decision) {
      reply.header('x-ratelimit-limit', String(decision.limit));
      reply.header('x-ratelimit-remaining', String(decision.remaining));
      reply.header('x-ratelimit-scope', decision.scope);
    }
    done(null, payload);
  };

  return { ipHook, tokenHook, headersHook };
}
