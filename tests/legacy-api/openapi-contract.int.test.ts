import test from 'node:test';
import assert from 'node:assert/strict';
import type { HTTPMethods } from 'fastify';
import { createLegacyTestApp } from '../support/legacy-app.ts';
import { readRepoFile } from '../support/repo-files.ts';

type Parameter = { name: string; in: string; required?: boolean; description?: string; schema?: Record<string, unknown> };
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: { type?: string; properties?: Record<string, unknown>; required?: string[] } }> };
  security?: unknown[];
};

const EXPECTED = ['DELETE /v1/customers/:id', 'GET /v1/auth/whoami', 'GET /v1/customers', 'GET /v1/customers/:id', 'GET /v1/health', 'POST /v1/customers', 'PUT /v1/customers/:id'];
const spec = JSON.parse(readRepoFile('docs/legacy-api/openapi.json'));
const ops = Object.entries(spec.paths as Record<string, Record<string, Operation>>)
  .flatMap(([path, item]) => Object.entries(item).map(([m, op]) => ({ method: m.toUpperCase(), url: path.replace(/\{(\w+)\}/g, ':$1'), op })));

// "METHOD /path" for every route Fastify registered, from the printRoutes tree
// (4 columns per level, HEAD left out because Fastify derives it from GET).
function registeredRoutes(tree: string): string[] {
  const prefixes: string[] = [];
  return tree.split('\n').flatMap((line) => {
    const m = /^([│ ]*)[├└]── (\S+) \(([^)]+)\)$/.exec(line);
    if (!m) return [];
    const depth = m[1]!.length / 4;
    const path = (prefixes[depth - 1] ?? '') + m[2]!;
    prefixes[depth] = path;
    return m[3]!.split(', ').filter((method) => method !== 'HEAD').map((method) => `${method} ${path}`);
  });
}

test('[BEN-03] every OpenAPI operation exists in the API and the API has exactly these 7', async () => {
  assert.deepEqual(ops.map((o) => `${o.method} ${o.url}`).sort(), EXPECTED);
  const { app } = await createLegacyTestApp();
  for (const { method, url } of ops) assert.ok(app.hasRoute({ method: method as HTTPMethods, url }), `${method} ${url}`);
  await app.ready();
  assert.deepEqual(registeredRoutes(app.printRoutes({ commonPrefix: false })).sort(), EXPECTED);
});

test('[BEN-03] every operation has operationId and summary', () => {
  assert.ok(ops.every((o) => o.op.operationId && o.op.summary));
  assert.deepEqual(ops.map((o) => o.op.operationId).sort(),
    ['deleteV1CustomersById', 'getV1AuthWhoami', 'getV1Customers', 'getV1CustomersById', 'getV1Health', 'postV1Customers', 'putV1CustomersById']);
});

test('[BEN-03] parameters and bodies carry JSON Schema, and only health is public', () => {
  assert.equal(spec.openapi, '3.1.0');
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, { ...spec.components.securitySchemes.bearerAuth, type: 'http', scheme: 'bearer' });
  assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
  for (const { method, url, op } of ops) {
    const label = `${method} ${url}`;
    assert.ok(op.description, label);
    for (const p of op.parameters ?? []) assert.ok(p.schema && p.description && ['query', 'path'].includes(p.in), `${label} ${p.name}`);
    assert.deepEqual(op.security, url === '/v1/health' ? [] : undefined, label);
    const body = op.requestBody?.content?.['application/json']?.schema;
    if (method === 'POST' || method === 'PUT') {
      assert.equal(body?.type, 'object', label);
      assert.deepEqual(Object.keys(body?.properties ?? {}).sort(), [...(body?.required ?? [])].sort(), label);
    } else {
      assert.equal(op.requestBody, undefined, label);
    }
  }
  const list = ops.find((o) => o.method === 'GET' && o.url === '/v1/customers')!.op.parameters!;
  assert.deepEqual(list.map((p) => p.name), ['nm', 'eml', 'phn', 'sts', 'seg', 'dt_de', 'dt_ate', 'lim', 'off']);
  const schemaOf = (name: string) => list.find((p) => p.name === name)!.schema!;
  assert.deepEqual(schemaOf('sts').enum, ['A', 'I']);
  assert.deepEqual(schemaOf('seg').enum, [1, 2, 3]);
  assert.deepEqual([schemaOf('lim').minimum, schemaOf('lim').maximum, schemaOf('off').minimum], [1, 500, 0]);
  assert.equal(schemaOf('dt_de').pattern, '^\\d{8}$');
});
