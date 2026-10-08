// Gateway against real local HTTP servers, for behavior a scripted fetch cannot show.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DomainError } from '../../src/mcp/domain/errors.ts';
import { createLegacyCustomerGateway } from '../../src/mcp/infrastructure/legacy-customer-gateway.ts';
import { createLogger } from '../../src/shared/logger.ts';

const TOKEN = 'slm_k3x9q2ab_' + 'A'.repeat(43);
const ctx = { requestId: '5b2e8f3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b' };
const row = { cst_id: 12, cst_nm: 'Teodoro Escarlate', cst_phn: '11900000012', cst_eml: 'teodoro.escarlate@example.com', cst_sts: 'A', cst_seg: 3, dt_cad: '20240115' };

async function listen(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const requests: { method?: string; url?: string; authorization?: string }[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test('a redirect is never followed, so the bearer token never reaches another host', async (t) => {
  const other = await listen(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(row));
  });
  const api = await listen(t, (_req, res) => {
    res.writeHead(302, { location: `${other.url}/v1/customers/12` }).end();
  });
  const lines: string[] = [];
  const gateway = createLegacyCustomerGateway({ baseUrl: api.url, token: TOKEN, timeoutMs: 2000,
    logger: createLogger({ component: 'mcp', level: 'debug', write: (l) => lines.push(l) }), userAgent: 'secure-legacy-mcp/0.1.0' });

  await assert.rejects(gateway.getById(12, ctx),
    (e: unknown) => e instanceof DomainError && e.code === 'UPSTREAM_CONTRACT' && e.details.upstreamStatus === 302);
  assert.equal(api.requests.length, 1); // a 3xx is not retried
  assert.equal(api.requests[0]!.authorization, `Bearer ${TOKEN}`);
  assert.equal(other.requests.length, 0);
  const failure = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'upstream_failure');
  assert.equal(failure?.upstreamStatus, 302);
  assert.ok(!lines.join('').includes(TOKEN));
});
