import type { FastifyInstance } from 'fastify';

// Public route (outside the auth allowlist and the rate-limit buckets).
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/v1/health', async () => ({ status: 'UP' }));
}
