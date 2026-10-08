// npm run agent:demo (spec 10.3): the create-then-ask-id script with memory on and off,
// against the real MCP server and a fresh in-process legacy API for each run. Uses the
// scripted fake unless OPENROUTER_API_KEY (or LLM_PROVIDER=openrouter) selects a real
// model. No .env needed.
import { fileURLToPath } from 'node:url';
import { startLegacyApi } from '../../src/legacy-api/start-in-process.ts';
import { askWithTrace, connectCustomersMcp, createCustomerAgent } from './agent.ts';
import type { ToolTrace } from './agent.ts';
import { loadAgentConfigFromProcessEnv } from './config.ts';
import type { AgentConfig } from './config.ts';
import { loadFixture } from './fake/fixture-schema.ts';
import { createChatModel } from './model.ts';

const SCENARIO = 'create-then-ask-id';
const TURNS = [
  'crie um cliente chamado Ana Souza, e-mail ana.souza@example.com, telefone 11 98888-7777, segmento smb',
  'qual é o id dele?',
];

const out = (line = '') => { process.stdout.write(`${line}\n`); };

function describeTool(t: ToolTrace): string {
  if (t.error) return `  tool ${t.name} -> ${t.text.split(' (requestId')[0]}`;
  try {
    const id = (JSON.parse(t.text) as { customer?: { id?: number } | null }).customer?.id;
    return `  tool ${t.name} -> ${id === undefined ? 'ok' : `#${id}`}`;
  } catch {
    return `  tool ${t.name} -> ok`;
  }
}

async function runOnce(config: AgentConfig, memory: boolean): Promise<void> {
  const label = config.provider === 'fake' ? `fake (roteiro ${SCENARIO})` : `openrouter (modelo ${config.model})`;
  out(`LLM: ${label} | memória: ${memory ? 'ligada' : 'desligada'}`);
  const api = await startLegacyApi();
  try {
    const token = api.tokens.issue({ name: `agent-demo-${memory ? 'memory' : 'no-memory'}`, role: 'admin' }).token;
    const mcp = await connectCustomersMcp({ serviceToken: token, legacyApiUrl: api.url });
    try {
      const fixture = config.provider === 'fake' ? loadFixture(fileURLToPath(new URL(`./fixtures/${SCENARIO}.json`, import.meta.url))) : undefined;
      const agent = createCustomerAgent({ model: createChatModel(config, fixture), tools: mcp.tools, memory });
      for (const text of TURNS) {
        out(`> ${text}`);
        const { answer, tools } = await askWithTrace(agent, text, 'agent-demo');
        for (const t of tools) out(describeTool(t));
        out(`  < ${answer}`);
      }
    } finally {
      await mcp.close();
    }
  } finally {
    await api.close();
  }
}

try {
  const config = loadAgentConfigFromProcessEnv();
  await runOnce(config, true);
  out();
  await runOnce(config, false);
  if (config.provider === 'fake') {
    out();
    out('O fake segue o roteiro e ignora o prompt de sistema: prova a mecânica (tools, histórico, memória), não a qualidade de um modelo.');
  }
} catch (err) {
  process.stderr.write(`agent:demo falhou: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  process.exitCode = 1;
}
