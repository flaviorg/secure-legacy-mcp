import type { preValidationHookHandler } from 'fastify';
import type { Role } from './token-store.ts';

const RANK: Record<Role, number> = { member: 1, admin: 2 };

// Route-level role check. Registered as `preValidation` (not `preHandler`) so a
// caller without the role gets 403 before Fastify validates the body: otherwise a
// member sending an incomplete body would learn about the schema through a 400.
export function requireRole(role: Role): preValidationHookHandler {
  return function roleHook(request, reply, done) {
    const caller = request.caller;
    if (caller === null || RANK[caller.role] < RANK[role]) {
      reply.code(403).send({ erro: 'proibido', papel_necessario: role });
      return;
    }
    done();
  };
}
