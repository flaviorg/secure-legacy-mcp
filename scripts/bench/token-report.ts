// Token comparison report (spec 9.1, BEN-01, BEN-02): REST mirror generated from the
// OpenAPI document against the 5 business actions and against the whole OpenAPI
// document in the prompt. Every run starts fresh legacy APIs (:memory: with the seed),
// so two runs over the same code produce the same bytes.
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { startLegacyApi } from '../../src/legacy-api/start-in-process.ts';
import { createCustomerService } from '../../src/mcp/application/customer-service.ts';
import { createLegacyCustomerGateway } from '../../src/mcp/infrastructure/legacy-customer-gateway.ts';
import { createMcpServer } from '../../src/mcp/server.ts';
import { VERSION } from '../../src/mcp/version.ts';
import { createLogger } from '../../src/shared/logger.ts';
import { listOperations, openApiToMirrorTools } from './mirror-tools.ts';
import type { OpenApiDocument } from './mirror-tools.ts';
import { SCENARIOS } from './scenarios.ts';
import type { ScenarioStep } from './scenarios.ts';
import { countTokens } from './tokenize.ts';

export const BLOCK_START = '<!-- token-table:start -->';
export const BLOCK_END = '<!-- token-table:end -->';

const OPENAPI_TEXT = readFileSync(new URL('../../docs/legacy-api/openapi.json', import.meta.url), 'utf8');

type Measured = { calls: number; argTokens: number; resultTokens: number };
type Definitions = { tools: number; text: string };
type VariantRun = { definitions: Definitions; scenarios: Map<string, Measured> };
type Invoke = (tool: string, args: Record<string, unknown>) => Promise<string>;

const resolveArgs = (step: ScenarioStep, previous: unknown[]) => (typeof step.args === 'function' ? step.args(previous) : step.args);

async function runSteps(steps: ScenarioStep[], invoke: Invoke): Promise<Measured> {
  const previous: unknown[] = [];
  const measured: Measured = { calls: 0, argTokens: 0, resultTokens: 0 };
  for (const step of steps) {
    const args = resolveArgs(step, previous);
    const text = await invoke(step.tool, args);
    measured.calls += 1;
    measured.argTokens += countTokens(JSON.stringify(args)).o200k;
    measured.resultTokens += countTokens(text).o200k;
    previous.push(JSON.parse(text));
  }
  return measured;
}

// Mirror: each call goes straight to the API (method and path from the operationId,
// `id` in the path, the rest in the query for GET and in the body otherwise). The
// measured result is the raw legacy body, what a pass-through tool would return.
async function runMirror(spec: OpenApiDocument): Promise<VariantRun> {
  const routes = new Map<string, { method: string; path: string }>();
  for (const { path, method, op } of listOperations(spec)) routes.set(op.operationId, { method: method.toUpperCase(), path });
  const api = await startLegacyApi();
  try {
    const token = api.tokens.issue({ name: 'bench-mirror', role: 'admin' }).token;
    const invoke: Invoke = async (tool, args) => {
      const route = routes.get(tool);
      if (route === undefined) throw new Error(`unknown mirror operation ${tool}`);
      const { id, ...rest } = args;
      const url = new URL(api.url + route.path.replace('{id}', String(id)));
      const init: RequestInit = { method: route.method, headers: { authorization: `Bearer ${token}` } };
      if (route.method === 'GET') {
        for (const [k, v] of Object.entries(rest)) url.searchParams.set(k, String(v));
      } else {
        init.body = JSON.stringify(rest);
        init.headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      }
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`mirror ${tool} answered ${res.status}: ${text.slice(0, 200)}`);
      return text;
    };
    const scenarios = new Map<string, Measured>();
    for (const s of SCENARIOS) scenarios.set(s.id, await runSteps(s.mirror, invoke));
    const tools = openApiToMirrorTools(spec);
    return { definitions: { tools: tools.length, text: JSON.stringify(tools) }, scenarios };
  } finally {
    await api.close();
  }
}

// Business actions: the real MCP server over an in-memory transport, its service
// pointed at a fresh API. The measured result is content[0].text of each call.
async function runBusiness(): Promise<VariantRun & { fullListText: string }> {
  const api = await startLegacyApi();
  const logger = createLogger({ component: 'mcp', level: 'error', write: () => {} });
  const token = api.tokens.issue({ name: 'bench-business', role: 'admin' }).token;
  const gateway = createLegacyCustomerGateway({ baseUrl: api.url, token, timeoutMs: 5000, logger, userAgent: `secure-legacy-mcp/${VERSION}` });
  const server = createMcpServer({ service: createCustomerService({ gateway }), logger, version: VERSION, apiBaseUrl: api.url });
  const client = new Client({ name: 'secure-legacy-mcp-bench', version: VERSION });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    const invoke: Invoke = async (tool, args) => {
      const r = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
      const text = (r.content[0] as { text?: string } | undefined)?.text ?? '';
      if (r.isError) throw new Error(`business ${tool} failed: ${text}`);
      return text;
    };
    const scenarios = new Map<string, Measured>();
    for (const s of SCENARIOS) if (s.business !== null) scenarios.set(s.id, await runSteps(s.business, invoke));
    const definitions = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    return { definitions: { tools: tools.length, text: JSON.stringify(definitions) }, scenarios, fullListText: JSON.stringify(tools) };
  } finally {
    await client.close();
    await server.close();
    await api.close();
  }
}

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;

// How a compares with b, as the report's sentence says it (rounded to the nearest percent).
export function relativeDifference(a: number, b: number): string {
  if (a === b) return 'o mesmo número de';
  const pct = Math.round((Math.abs(a - b) / b) * 100);
  return a > b ? `${pct}% mais` : `${pct}% menos`;
}

// Markdown block shared by the README and docs/token-comparison.md.
export async function buildTokenReport(): Promise<string> {
  const spec = JSON.parse(OPENAPI_TEXT) as OpenApiDocument;
  const mirror = await runMirror(spec);
  const business = await runBusiness();
  const openApiMinified = JSON.stringify(JSON.parse(OPENAPI_TEXT));

  const mirrorDefs = countTokens(mirror.definitions.text);
  const businessDefs = countTokens(business.definitions.text);
  const openApiDefs = countTokens(openApiMinified);
  const fullList = countTokens(business.fullListText);

  const lines = [
    'Tokenizador: `o200k_base` (gpt-tokenizer) | estimativa: caracteres/4',
    '',
    '**Definições** (`JSON.stringify` do array `{ name, description, inputSchema }` de um `tools/list`)',
    '',
    row(['Variante', 'Tools', 'Tokens (o200k)', 'Estimativa (chars/4)']),
    '|---|---:|---:|---:|',
    row(['Espelho REST (gerado do OpenAPI)', mirror.definitions.tools, mirrorDefs.o200k, mirrorDefs.chars4]),
    row(['Ações de negócio', business.definitions.tools, businessDefs.o200k, businessDefs.chars4]),
    row(['Spec OpenAPI inteira no prompt', '-', openApiDefs.o200k, openApiDefs.chars4]),
    '',
    `As definições das ações de negócio custam ${relativeDifference(businessDefs.o200k, mirrorDefs.o200k)} tokens que as do espelho. ` +
      `Com \`outputSchema\` e \`annotations\`, que o \`tools/list\` real também devolve, as ações de negócio somam ${fullList.o200k} tokens (o200k); ` +
      'o espelho gerado não tem esquema de saída.',
    '',
    '**Cenários** (sequência mínima correta, sem erros do modelo, contra a API com o seed de 30 clientes)',
    '',
    row(['Cenário', 'Variante', 'Chamadas', 'Tokens de argumentos', 'Tokens de resultados']),
    '|---|---|---:|---:|---:|',
  ];
  for (const s of SCENARIOS) {
    const label = `${s.id} ${s.title}`;
    const m = mirror.scenarios.get(s.id)!;
    lines.push(row([label, 'Espelho REST', m.calls, m.argTokens, m.resultTokens]));
    const b = business.scenarios.get(s.business === null ? 'C2a' : s.id)!;
    lines.push(row([label, s.business === null ? 'Ações de negócio (mesma chamada de C2a)' : 'Ações de negócio', b.calls, b.argTokens, b.resultTokens]));
  }
  lines.push(
    '',
    'C2a é a comparação justa: os dois lados limitados a 10 itens. C2b mostra um erro possível do modelo, não um baseline: ' +
      'sem `lim`, a API legada devolve tudo o que casa com o filtro. O custo dos outros erros do espelho (códigos `A`/`I` e `1`/`2`/`3`, ' +
      '`cst_id` no corpo do `PUT`) não entra na medição. Outros modelos tokenizam diferente; vale a comparação relativa. ' +
      'Metodologia e ressalvas: [docs/token-comparison.md](docs/token-comparison.md).',
  );
  return lines.join('\n') + '\n';
}

// Replaces what lies between the two markers; throws if either marker is missing.
export function replaceBlock(readme: string, block: string): string {
  const start = readme.indexOf(BLOCK_START);
  if (start === -1) throw new Error(`marker ${BLOCK_START} not found`);
  const end = readme.indexOf(BLOCK_END, start);
  if (end === -1) throw new Error(`marker ${BLOCK_END} not found`);
  return `${readme.slice(0, start + BLOCK_START.length)}\n${block.trim()}\n${readme.slice(end)}`;
}

// docs/token-comparison.md: methodology, the caveats required by spec 9.1 and the
// same generated block as the README.
export function renderComparisonDoc(report: string): string {
  return `# Comparativo de tokens

Arquivo gerado por \`npm run bench:tokens\` (\`scripts/bench/measure-tool-tokens.ts --write\`). Não edite à mão: o \`npm test\` compara este bloco e o do README com a saída do medidor (BEN-02).

## O que se mede

Três formas de dar a um modelo acesso ao cadastro de clientes:

1. **Espelho REST**: uma tool por operação de \`docs/legacy-api/openapi.json\` (7 operações), gerada pela função pura \`openApiToMirrorTools\` (\`scripts/bench/mirror-tools.ts\`): nome do \`operationId\`, descrição de \`summary\` e \`description\`, \`inputSchema\` dos \`parameters\` e do \`requestBody\`. Ninguém escreveu essas definições à mão, então ninguém as piorou de propósito. Não existe servidor MCP para o espelho: ele só ecoaria as mesmas definições. Cada chamada do roteiro vai direto à API com \`fetch\`, e o resultado medido é o corpo legado cru, que é o que uma tool de repasse devolveria.
2. **Ações de negócio**: as 5 tools reais, lidas por um \`Client\` do SDK sobre \`InMemoryTransport\` ligado a \`createMcpServer\`, com o service apontando para a API em processo. O resultado medido é o \`content[0].text\` de cada chamada (JSON compacto).
3. **Spec OpenAPI inteira no prompt**: \`openapi.json\` minificado, a alternativa sem MCP.

Definições são medidas como \`JSON.stringify\` do array \`{ name, description, inputSchema }\`, os três campos que as duas variantes de tools têm. Nos cenários, "tokens de argumentos" é a soma de \`JSON.stringify(args)\` de cada chamada (o que o modelo precisa gerar) e "tokens de resultados" é a soma do que volta para o contexto. O nome da tool em cada chamada não entra na conta de nenhum dos lados.

Tokenizador: \`o200k_base\` do \`gpt-tokenizer\` 4.0.0, offline, mais a estimativa de caracteres/4 (aula 221522). Cada execução sobe APIs novas com SQLite \`:memory:\` e o seed de 30 clientes, uma para o espelho e outra para as ações de negócio, de modo que a escrita do C3 de um lado não afeta o outro e duas execuções dão a mesma saída byte a byte (BEN-01).

## Cenários

| Cenário | Espelho REST | Ações de negócio |
|---|---|---|
| C1 "telefone do cliente com e-mail X" | \`getV1Customers {eml}\` | \`getCustomer {email}\` |
| C2a "clientes enterprise ativos cadastrados em 2024" (comparação justa) | \`getV1Customers {sts, seg, dt_de, dt_ate, lim: 10}\` | \`searchCustomers {status, segment, createdFrom, createdTo}\` (limite padrão 10) |
| C2b mesmo pedido, espelho ingênuo | \`getV1Customers {sts, seg, dt_de, dt_ate}\` sem \`lim\`, como um modelo poderia montar a partir da spec | mesma chamada de C2a |
| C3 "desative o Teodoro" | \`getV1Customers {nm}\` e \`putV1CustomersById\` com o objeto completo montado do resultado anterior | \`getCustomer {name}\` e \`deactivateCustomer {id}\` |

O roteiro é a sequência mínima correta, sem LLM e sem erros do modelo (\`scripts/bench/scenarios.ts\`).

## Ressalvas

- Outros modelos tokenizam diferente. O número absoluto muda de um provedor para outro; a comparação relativa é o que importa.
- Os provedores reformatam as definições de tools antes de pôr no prompt. O JSON medido aqui é uma aproximação do que entra no contexto, não o valor faturado.
- O custo dos erros do espelho REST (códigos \`A\`/\`I\` e \`1\`/\`2\`/\`3\`, \`cst_id\` no corpo do \`PUT\`, que dá 500, listar tudo sem \`lim\`) **não** entra na medição. A exceção é a linha C2b, rotulada como erro do modelo. Com o seed de 30 clientes só 3 casam com o filtro, então o C2b custa aqui quase o mesmo que o C2a; numa tabela real, sem \`lim\`, o resultado cresce com o cadastro.
- O JSON Schema das ações de negócio usa os helpers de campo \`emailField\` e \`isoDateField\` (D-25), com \`pattern\` curto. O ADR \`docs/adr/0001-business-actions-not-endpoint-mirror.md\` registra quanto o padrão do Zod 4 (\`z.email()\` e \`z.iso.date()\`) custaria a mais nas definições.
- Os números publicados são os que o script der. Se as ações de negócio custarem mais em definições, a tabela mostra isso: o projeto troca descrições mais ricas (que ajudam o modelo a acertar de primeira) por menos chamadas e resultados menores, sem campos crípticos para o modelo decodificar.

## Resultado

${report.trim()}
`;
}
