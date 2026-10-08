import test from 'node:test';
import assert from 'node:assert/strict';
import { openApiToMirrorTools } from '../../scripts/bench/mirror-tools.ts';
import { readRepoFile } from '../support/repo-files.ts';

test('[BEN-03] maps summary, description, parameters and requestBody', () => {
  const spec = { paths: { '/v1/x/{id}': { put: { operationId: 'putX', summary: 'Atualiza', description: 'Objeto completo',
    parameters: [{ name: 'id', in: 'path', required: true, description: 'id', schema: { type: 'integer' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } } } } } } };
  assert.deepEqual(openApiToMirrorTools(spec), [{ name: 'putX', description: 'Atualiza\nObjeto completo',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'id' }, a: { type: 'string' } }, required: ['id', 'a'] } }]);
});

test('[BEN-03] generates one definition per operation of the real OpenAPI document', () => {
  const tools = openApiToMirrorTools(JSON.parse(readRepoFile('docs/legacy-api/openapi.json')));
  assert.equal(tools.length, 7);
  assert.deepEqual(tools.map((x) => x.name), ['getV1Health', 'getV1AuthWhoami', 'getV1Customers', 'postV1Customers', 'getV1CustomersById', 'putV1CustomersById', 'deleteV1CustomersById']);
  const put = tools.find((x) => x.name === 'putV1CustomersById')!;
  for (const k of ['id', 'cst_nm', 'cst_phn', 'cst_eml', 'cst_sts', 'cst_seg']) assert.ok(k in put.inputSchema.properties, k);
});

test('[BEN-03] operations without inputs get empty properties and no required list; header parameters and path-level keys are skipped', () => {
  const spec = { paths: { '/h': {
    summary: 'Path item summary', parameters: [{ name: 'shared', in: 'query', schema: { type: 'string' } }],
    get: { operationId: 'getH', summary: 'Health', description: '' },
    post: { operationId: 'postH', parameters: [{ name: 'x-trace', in: 'header', schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' } }] },
  } } };
  assert.deepEqual(openApiToMirrorTools(spec), [
    { name: 'getH', description: 'Health', inputSchema: { type: 'object', properties: {} } },
    { name: 'postH', description: '', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  ]);
});
