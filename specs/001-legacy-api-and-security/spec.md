# 001: API legada e camada de segurança

Status: implementado (marcos M1, M2 e M3). Design completo: `docs/legacy-api/README.md`, `docs/security.md` e ADRs 0003 e 0004.

## Contexto

Uma API REST de clientes simulada, hostil a agentes de propósito: campos crípticos (`cst_nm`, `dt_cad`), status `A`/`I`, segmento `1`/`2`/`3`, listagem sem limite e um `PUT` que devolve 500 cru se o corpo trouxer `cst_id`. Por cima dela, uma camada de segurança real: Service Tokens com hash SHA-256 e revogação em `node:sqlite`, CLI local para emitir, listar e revogar, RBAC `member`/`admin` com papel vindo só do banco, e rate limit com dois baldes (token e IP). É a autoridade que o servidor MCP (spec 002) consome.

## Critérios de aceite

**API legada**

- **API-01** Quando receber `GET /v1/customers` com qualquer combinação de `nm`, `eml`, `phn`, `sts`, `seg`, `dt_de` e `dt_ate`, a API deve aplicar todos os filtros na consulta SQL preparada e devolver em `qtd` o total filtrado antes de `lim` e `off`.
- **API-02** Quando `nm` contiver `%` ou `_`, a API deve tratá-los como caracteres literais.
- **API-03** Quando `nm` vier sem acento ou com outra caixa, a API deve encontrar os nomes acentuados correspondentes.
- **API-04** Se o corpo de `PUT /v1/customers/:id` contiver `cst_id`, então a API deve responder 500 com a mensagem bruta do SQLite (armadilha legada documentada).
- **API-05** Quando a API iniciar com a tabela `customers` vazia, ela deve inserir os 30 clientes do seed; quando já houver clientes, não deve inserir nada.
- **API-06** Se um parâmetro conhecido tiver valor inválido, então a API deve responder 400 nomeando o parâmetro; parâmetros desconhecidos devem ser ignorados.
- **API-07** Quando `GET /v1/customers` vier sem `lim`, a API deve devolver todos os clientes filtrados (comportamento legado preservado).
- **API-08** Quando uma requisição autenticada chegar a uma rota que não existe, a API deve responder 404 com `{"msg":"nao encontrado"}`, sem ecoar a URL.

**Segurança**

- **SEC-01** Quando a CLI emitir um token, o sistema deve gravar apenas o SHA-256 do token e exibi-lo em claro uma única vez.
- **SEC-02** Quando uma rota fora da allowlist receber requisição sem Bearer, ou com token malformado, desconhecido, revogado ou expirado, a API deve responder 401 com o mesmo corpo genérico nos cinco casos.
- **SEC-03** Quando um token `member` chamar `POST`, `PUT` ou `DELETE`, a API deve responder 403 com `papel_necessario: "admin"`.
- **SEC-04** A API deve decidir o papel exclusivamente pelo registro do token no banco, ignorando qualquer papel enviado em cabeçalho ou corpo.
- **SEC-05** Quando o mesmo token fizer a 91ª requisição dentro de 60 s, a API deve responder 429 com `retry-after`, `x-ratelimit-limit` e `x-ratelimit-remaining`.
- **SEC-06** Quando um mesmo IP somar a 181ª requisição em 60 s, ainda que distribuída entre tokens diferentes, a API deve responder 429.
- **SEC-07** Quando `revoke <id>` for executado, a próxima requisição com aquele token deve receber 401, sem reiniciar a API.
- **SEC-08** A CLI e a API nunca devem exibir o hash nem, depois da emissão, o token, nem mesmo parte do segredo de um token colado com um caractere a menos ou a mais.
- **SEC-09** Os logs da API não devem conter o valor do cabeçalho `Authorization`, nem um token enviado na query string.
- **SEC-10** Enquanto a data atual for posterior a `expires_at`, a API deve tratar o token como inválido (401).
- **SEC-11** Se `revoke` receber um id inexistente, então a CLI deve sair com código 2 e mensagem clara.
- **SEC-12** A API deve enviar `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-scope` do balde que decidiu a resposta, e `GET /v1/health` não deve consumir nenhum balde.
- **SEC-13** Quando o cabeçalho `x-request-id` recebido não for um UUID, a API deve gerar um UUID novo como `requestId`; quando for, deve adotá-lo e devolvê-lo na resposta.
- **SEC-14** Se uma rota ou um hook falhar com erro inesperado (fora da armadilha de API-04), então a API deve responder 500 com `{"erro":"erro interno"}`, sem mensagem, código ou stack internos, e registrar o detalhe só no log.

## Non-goals

| Fora do escopo | Motivo |
|---|---|
| Login com usuário e senha, JWT e rota pública de emissão de token | O MCP só usa Service Token; a emissão fica na CLI local com acesso ao arquivo do banco. Menos superfície de ataque |
| Rate limit distribuído (Redis), várias instâncias | Limitador em memória, zera no reinício; documentado em `docs/security.md` |
| CORS e TLS na API | API em `127.0.0.1`, consumida por processo local |
| Framework de migração de banco | Schema idempotente (`CREATE TABLE IF NOT EXISTS`) na inicialização |
| Interface web, Docker | Não aumentam o impacto deste projeto |

## Dúvidas resolvidas

Conferidas nos pacotes instalados (Node 24.21.0, `fastify` 5.12.5) durante a construção:

- `Fastify({ requestIdHeader: false, genReqId(req), bodyLimit: 16384, trustProxy: false })`: o `genReqId` recebe a requisição crua (`req.headers`); `app.inject({ remoteAddress })` muda `request.ip`; `app.hasRoute({ method, url })` existe.
- O Fastify valida o corpo **antes** do `preHandler`. Com o RBAC em `preHandler`, um `member` mandando `{}` receberia 400 e aprenderia o schema. O `requireRole` roda em `preValidation`, que vem depois do parsing e antes da validação.
- `decorateRequest('x', null)` serve para `caller` e `rateLimit`; `printRoutes({ commonPrefix: false })` lista um caminho por linha (usado pelo teste de contrato do OpenAPI); `logger: { level, stream, redact }` aceita `redact` em array; um `onSend` também recebe as respostas enviadas por hooks `onRequest` (401 e 429).
- `node:sqlite`: `new DatabaseSync(path, { timeout: 5000 })`; `PRAGMA journal_mode=WAL` devolve `memory` em `:memory:` e `wal` em arquivo; erros têm `code: 'ERR_SQLITE_ERROR'` e `errcode` (2067 para UNIQUE; o erro de sintaxe da armadilha do `PUT` tem `errcode` 1, não o 2067 da tabela do plano).
- Os schemas de corpo da API não usam `additionalProperties: false`: o `removeAdditional` do Ajv apagaria o `cst_id` e a armadilha do `PUT` (API-04) não dispararia.
- O pino do Fastify escreve no stdout do processo da API. Nos testes e no demo, `startLegacyApi` usa `logger: false`, então o log da API nunca divide stdout com um servidor MCP stdio.
- A expiração vale com `expires_at <= agora` (o milissegundo exato fica do lado inválido).
- Num `setErrorHandler` da raiz, relançar o erro entrega-o ao handler padrão do Fastify: os 4xx do próprio Fastify (validação de corpo, JSON malformado, 413) mantêm o corpo padrão. Rotas desconhecidas passam pelos hooks `onRequest` antes do `setNotFoundHandler`, então um anônimo recebe 401. O handler padrão de 404 ecoa a URL (com a query string) no corpo.
- O Fastify mescla os `serializers` recebidos sobre os seus, e o serializer `req` padrão loga `req.url` com a query string. O `buildApp` usa os mesmos campos do padrão (ou o serializer recebido) e mascara tokens na URL.

## Checklist

| Critério | Teste |
|---|---|
| API-01 a API-08 | `tests/legacy-api/customers.int.test.ts` |
| SEC-01, SEC-07, SEC-08 | `tests/legacy-api/token-store.unit.test.ts`, `tests/legacy-api/tokens-cli.e2e.test.ts` |
| SEC-02, SEC-03, SEC-04, SEC-13, SEC-14 | `tests/legacy-api/auth-rbac.int.test.ts` |
| SEC-05 | `tests/legacy-api/fixed-window-limiter.unit.test.ts`, `tests/legacy-api/rate-limit.int.test.ts` |
| SEC-06, SEC-12 | `tests/legacy-api/rate-limit.int.test.ts` |
| SEC-09 | `tests/legacy-api/auth-rbac.int.test.ts`, `tests/shared/redact.unit.test.ts` |
| SEC-10 | `tests/legacy-api/token-store.unit.test.ts` |
| SEC-11 | `tests/legacy-api/tokens-cli.e2e.test.ts` |
