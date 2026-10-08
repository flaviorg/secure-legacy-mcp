import type { FastifyInstance } from 'fastify';

// Any valid token. The auth hook has already answered 401 when there is no caller.
export function registerWhoamiRoutes(app: FastifyInstance): void {
  app.get('/v1/auth/whoami', async (request, reply) => {
    const caller = request.caller;
    if (caller === null) return reply.code(401).send({ erro: 'nao autorizado' });
    return { tokenId: caller.tokenId, name: caller.name, role: caller.role };
  });
}
