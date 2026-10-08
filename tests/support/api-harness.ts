// Real legacy API for the MCP e2e tests: in-process, :memory: database with the seed,
// ephemeral port on 127.0.0.1, a log of the requests that passed IP, auth and token
// checks, and optional injected faults (spec 5.6, D-26). Both live in one onRequest
// hook registered through beforeListen, so it runs after the security hooks and
// before the per-route role check. buildApp knows nothing about faults.
import type { TestContext } from 'node:test';
import type { Limits } from '../../src/legacy-api/app.ts';
import type { Role } from '../../src/legacy-api/auth/token-store.ts';
import { startLegacyApi } from '../../src/legacy-api/start-in-process.ts';
import type { RunningApi } from '../../src/legacy-api/start-in-process.ts';

export type Fault = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pathPattern: RegExp;                   // matched against request.url without the query string
  times: number;                         // how many requests to affect; then the API is back to normal
  respond: { status: number; body: string; contentType?: string };
};

export type TestApi = RunningApi & {
  requests: { method: string; url: string }[];
  issueToken(role: Role, name?: string): string;
};

export async function startTestApi(t: TestContext, opts: { faults?: Fault[]; limits?: Partial<Limits> } = {}): Promise<TestApi> {
  const requests: { method: string; url: string }[] = [];
  const faults = (opts.faults ?? []).map((fault) => ({ ...fault, remaining: fault.times }));
  const api = await startLegacyApi({
    limits: opts.limits,
    beforeListen(app) {
      app.addHook('onRequest', async (request, reply) => {
        requests.push({ method: request.method, url: request.url });
        const path = request.url.split('?')[0]!;
        const fault = faults.find((f) => f.remaining > 0 && f.method === request.method && f.pathPattern.test(path));
        if (fault === undefined) return;
        fault.remaining -= 1;
        return reply.code(fault.respond.status).type(fault.respond.contentType ?? 'application/json').send(fault.respond.body);
      });
    },
  });
  t.after(() => api.close());
  return {
    ...api,
    requests,
    issueToken: (role, name = `test-${role}`) => api.tokens.issue({ name, role }).token,
  };
}
