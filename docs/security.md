# Segurança

Modelo de ameaça de um servidor MCP local que dá a um agente acesso a uma API legada de clientes. A API é a autoridade de autenticação, papel e limite; o servidor MCP é cliente HTTP dela e nunca toca o banco. Decisões: ADRs 0002 a 0005.

## Risco, mitigação e teste

| Risco | Aula de origem | Mitigação | Teste |
|---|---|---|---|
| Vazamento do banco expõe tokens | 203488 (`Map`, UUID) | Só SHA-256 no banco; token exibido uma vez | `tests/legacy-api/token-store.unit.test.ts` |
| Token vazado no cliente | 203488 | Revogação imediata pela CLI, expiração opcional, prefixo `slm_` para varredura | `tests/legacy-api/tokens-cli.e2e.test.ts` |
| Força bruta de token | | 256 bits; balde por IP antes da autenticação; 401 genérico nos cinco casos | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/legacy-api/rate-limit.int.test.ts` |
| Escalada de papel pelo cliente | 203487 | Papel vem só do registro do token; cabeçalho e corpo com `role` são ignorados | `tests/legacy-api/auth-rbac.int.test.ts` |
| Contorno do limite com vários tokens | 203490 | Balde por IP somado ao balde por token | `tests/legacy-api/rate-limit.int.test.ts` |
| Erro bruto chega ao modelo | 203479, 203483 | Catálogo de erros; detalhe só em stderr | `tests/mcp/tool-errors.e2e.test.ts` (500 e payload inválido injetados pelo harness), `tests/mcp/define-tool.unit.test.ts` |
| Erro interno da API exposto ao cliente HTTP | | Falha inesperada vira 500 `{"erro":"erro interno"}` com o detalhe só no log; rota desconhecida dá 404 no formato legado, depois da autenticação. Só a armadilha do `PUT` (API-04) devolve a mensagem do SQLite, de propósito | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/legacy-api/customers.int.test.ts` |
| `requestId` arbitrário nos logs da API | | `genReqId` aceita só UUID; o resto vira UUID novo | `tests/legacy-api/auth-rbac.int.test.ts` |
| Vários clientes locais dividem o balde de IP | 203490 | Cabeçalho `x-ratelimit-scope` e o aviso abaixo | `tests/legacy-api/rate-limit.int.test.ts` |
| Token aparece em log | | Redação por nome de campo e por padrão (`slm_<id>_***`, também para um token truncado ou com caractere a mais); `redact` do `Authorization` no logger da API, provado com um serializer que loga os cabeçalhos de propósito; token colado na query string (`?token=`) mascarado na URL que a API loga | `tests/mcp/stdout-clean.e2e.test.ts`, `tests/legacy-api/auth-rbac.int.test.ts`, `tests/shared/redact.unit.test.ts` |
| Senha da API no log do MCP | | `LEGACY_API_URL` com `usuario:senha@` é recusada na inicialização (`config_invalid`, sem ecoar o valor); o `fetch` recusaria a URL de todo modo | `tests/mcp/config.unit.test.ts`, `tests/mcp/startup.e2e.test.ts` |
| Protocolo stdio corrompido | 203479, 221518 | Logger em stderr, `console.*` redirecionado, teste que lê o stdout cru | `tests/mcp/stdout-clean.e2e.test.ts` |
| SQL injection via filtros | 221515 | Só prepared statements; `LIKE` com `ESCAPE` | `tests/legacy-api/customers.int.test.ts` |
| Agente age sobre o cliente errado | 221525 | `ambiguous` sem escolha, faixa 3 com `destructiveHint`, prompt com confirmação, sem delete físico; um homônimo com dado legado sujo continua entre os candidatos | `tests/mcp/tools-read.e2e.test.ts`, `tests/agent/agent-memory.e2e.test.ts` |
| Agente repete uma escrita já aplicada | 221517 | Releitura que falha depois de uma escrita aceita vira `[READBACK_FAILED]` com o id e `retryable: false`, em vez de um erro que convida a repetir | `tests/mcp/customer-service.unit.test.ts`, `tests/mcp/tool-errors.e2e.test.ts` |
| Prompt injection por dado de cliente | 203473, 203470, 221517 | O servidor não interpreta dados; `instructions` e `service-info` avisam que campos de cliente são dados não confiáveis; um token `member` não escreve, e com `admin` a escrita passa pela faixa 3 | Ilustrado no passo 10 do `npm run demo` (cliente de seed com nome que parece instrução, devolvido como JSON comum). Como defesa, não é testável sem modelo real |
| Entrada gigante | | `bodyLimit` de 16 KiB, `maxToolInputElements: 64`, limites de string nos schemas | `tests/legacy-api/customers.int.test.ts`, `tests/mcp/tools-read.e2e.test.ts` |
| Nome em branco ou com caractere invisível gravado pelo agente | 200963 | Campos de nome das tools aparam as pontas antes do mínimo de 2 caracteres e recusam caracteres de controle e de formatação bidirecional, sem custo no JSON Schema | `tests/mcp/customer-schemas.unit.test.ts`, `tests/mcp/tools-write.e2e.test.ts` |
| Pacote com arquivos indevidos | 203491 | Whitelist `files` e manifesto testado | `tests/repo/pack-manifest.unit.test.ts` |
| Segredo versionado | | `.env` no `.gitignore`; só `.vscode/mcp.json` versionado, com input de senha; varredura do padrão de token em todo arquivo fora de `tests/` | `tests/repo/conventions.unit.test.ts` |

## Ciclo de vida do token

```bash
npm run tokens -- issue --name vscode-flavio --role member --expires-in 30d   # exibe slm_<id>_<segredo> uma única vez
npm run tokens -- list                                                         # id, nome, papel, criado, último uso, expira, status
npm run tokens -- revoke <id>                                                  # vale na próxima requisição, sem reiniciar a API
```

1. **Emissão:** pela CLI local, com acesso ao arquivo do banco (`--db`, `DATABASE_PATH` ou `./data/legacy.db`). Não existe rota de emissão. Escolha o menor papel que serve: `member` lê, `admin` também escreve.
2. **Entrega:** copie o token direto para o input de senha do VS Code (`.vscode/mcp.json`) ou para o `.env` local (fora do Git). Nunca num arquivo versionado.
3. **Uso:** cada requisição verifica o hash, a revogação e a expiração no banco, sem cache, e atualiza o último uso. `list` mostra tokens parados há muito tempo.
4. **Revogação:** `revoke <id>` (se colarem o token inteiro, a CLI usa só o id e nunca ecoa o segredo; um token colado com um caractere a menos ou a mais aparece como `slm_<id>_***`). É idempotente; id inexistente sai com código 2.
5. **Expiração:** opcional, por `--expires-in <n>d|<n>h`. Sem expiração por padrão: um token de serviço local é revogado quando sai de uso.

## Balde de IP compartilhado entre clientes locais

O limite por IP (180 por minuto) conta todas as requisições de `127.0.0.1`. VS Code, Cursor, Claude Desktop, Inspector e o agente rodando ao mesmo tempo dividem esse balde, mesmo com tokens diferentes. Quando a tool devolve `[RATE_LIMITED]`, o `_meta` traz `scope`: `token` quer dizer que aquele token passou de 90 por minuto; `ip` quer dizer que a soma dos clientes locais passou de 180. Os limites são configuráveis na API (`RATE_LIMIT_PER_TOKEN`, `RATE_LIMIT_PER_IP`, `RATE_LIMIT_WINDOW_MS`).

## O que não é coberto

- **TLS e CORS:** a API escuta em `127.0.0.1` e é consumida por processos locais. Expor a API fora do loopback exige TLS, revisão de CORS e rever a exceção do `/v1/health` (D-28).
- **Limitador distribuído:** o limite é em memória, zera no reinício e não é dividido entre instâncias.
- **Rajada na fronteira da janela:** a janela fixa zera o contador quando expira, então até o dobro do limite passa em poucos milissegundos (90 pedidos no fim de uma janela e mais 90 no começo da seguinte). Aceitável para uma API em `127.0.0.1`; uma janela deslizante ou um token bucket fechariam a brecha (`tests/legacy-api/fixed-window-limiter.unit.test.ts` prova o comportamento).
- **Defesa contra prompt injection:** o servidor marca os dados como não confiáveis e limita o estrago por papel e por faixa, mas não impede que um modelo siga um texto malicioso. Isso depende do cliente e do modelo.
- **Transporte remoto:** só stdio (ADR 0002). Um MCP remoto precisaria ser resource server OAuth 2.1.
- **Comprometimento da máquina local:** quem lê o `.env` ou o arquivo do banco administra os tokens.
- **Concorrência entre clientes:** as escritas leem o cliente e mandam o objeto inteiro no `PUT` (exigência do legado, sem ETag nem `If-Match`). Uma mudança feita por outro cliente entre a leitura e o `PUT` é sobrescrita.
