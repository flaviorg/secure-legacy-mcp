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
  'create a customer named Ana Souza, email ana.souza@example.com, phone 11 98888-7777, segment smb',
  'what is her id?',
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
  const label = config.provider === 'fake' ? `fake (script ${SCENARIO})` : `openrouter (model ${config.model})`;
  out(`LLM: ${label} | memory: ${memory ? 'on' : 'off'}`);
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
    out('The fake follows the script and ignores the system prompt: it proves the mechanics (tools, history, memory), not the quality of a model.');
  }
} catch (err) {
  process.stderr.write(`agent:demo failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  process.exitCode = 1;
}
