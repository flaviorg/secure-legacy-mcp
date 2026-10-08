import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ToolCallLimitExceededError } from 'langchain';
import { ask } from '../../examples/agent/agent.ts';
import type { Fixture } from '../../examples/agent/fake/fixture-schema.ts';
import type { Role } from '../../src/legacy-api/auth/token-store.ts';
import { CREATE_ANA as T1, exampleFixture, searches, startAgent, testFixture } from '../support/agent-harness.ts';
import type { TestApi } from '../support/api-harness.ts';

const setup = (t: TestContext, fixture: Fixture, role: Role = 'admin', memory = true) => startAgent(t, fixture, { role, memory });
const statuses = (api: TestApi) => api.db.prepare('SELECT cst_id, cst_sts FROM customers ORDER BY cst_id').all();

test('[AGT-01] with memory, "qual é o id dele?" answers the real id from createCustomer', async (t) => {
  const { api, agent } = await setup(t, exampleFixture('create-then-ask-id'));
  const first = await ask(agent, T1, 'th-1');
  const id = (api.db.prepare('SELECT cst_id FROM customers WHERE cst_eml = ?').get('ana.souza@example.com') as { cst_id: number }).cst_id;
  assert.equal(first, `Cliente Ana Souza cadastrado com id ${id}.`);
  assert.ok((await ask(agent, 'qual é o id dele?', 'th-1')).includes(String(id)));
});

test('[AGT-02] without memory, the second turn answers the ifUnresolved text', async (t) => {
  const { api, agent } = await setup(t, exampleFixture('create-then-ask-id'), 'admin', false);
  await ask(agent, T1, 'th-1');
  assert.equal(await ask(agent, 'qual é o id dele?', 'th-1'), 'Não sei a qual cliente você se refere. Pode me dizer o nome ou o e-mail?');
  assert.equal((api.db.prepare('SELECT COUNT(*) AS n FROM customers WHERE cst_eml = ?').get('ana.souza@example.com') as { n: number }).n, 1);
});

test('[AGT-02] memory is per thread: another thread_id does not see the first conversation', async (t) => {
  const { agent } = await setup(t, exampleFixture('create-then-ask-id'));
  await ask(agent, T1, 'th-1');
  assert.equal(await ask(agent, 'qual é o id dele?', 'th-2'), 'Não sei a qual cliente você se refere. Pode me dizer o nome ou o e-mail?');
});

test('[AGT-04] a runaway loop stops at the ceiling with an error', async (t) => {
  const { api, agent } = await setup(t, testFixture('runaway-loop'));
  await assert.rejects(ask(agent, 'liste todos os clientes', 'th-1'), ToolCallLimitExceededError);
  // The tool-call ceiling (4 per turn) stops the turn before a 5th search reaches the API.
  assert.equal(searches(api), 4);
});

test('[AGT-03] an input without a fixture fails the turn with FakeScriptMissError', async (t) => {
  const { agent } = await setup(t, exampleFixture('create-then-ask-id'));
  await assert.rejects(ask(agent, 'apague tudo', 'th-1'), (err: Error) => {
    assert.match(err.message, /no turn matches "apague tudo"/);
    return true;
  });
});

test('[AGT-05] ambiguous-maria never calls deactivateCustomer and the database is unchanged', async (t) => {
  const { api, agent } = await setup(t, exampleFixture('ambiguous-maria'));
  const before = statuses(api);
  const answer = await ask(agent, 'desative a maria silva', 'th-1');
  assert.deepEqual(statuses(api), before);
  assert.equal(api.requests.filter((r) => r.method === 'PUT').length, 0);
  assert.match(answer, /Qual deles/);
});

test('deactivate-teodoro sets cst_sts to I', async (t) => {
  const { api, agent } = await setup(t, exampleFixture('deactivate-teodoro'));
  const id = (api.db.prepare("SELECT cst_id FROM customers WHERE cst_nm = 'Teodoro Escarlate'").get() as { cst_id: number }).cst_id;
  const answer = await ask(agent, 'desative o cliente teodoro', 'th-1');
  assert.equal((api.db.prepare('SELECT cst_sts FROM customers WHERE cst_id = ?').get(id) as { cst_sts: string }).cst_sts, 'I');
  assert.ok(answer.includes(`id ${id}`) && answer.includes('inactive'));
  assert.equal(api.requests.filter((r) => r.method === 'PUT').length, 1);
});

test('member-forbidden relays [FORBIDDEN] and keeps the database unchanged', async (t) => {
  const { api, agent } = await setup(t, exampleFixture('member-forbidden'), 'member');
  const answer = await ask(agent, 'cadastre a cliente ana souza, e-mail ana.souza@example.com, telefone 11 98888-7777, segmento smb', 'th-1');
  assert.ok(answer.includes('[FORBIDDEN]'), answer);
  assert.equal((api.db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n, 30);
});
