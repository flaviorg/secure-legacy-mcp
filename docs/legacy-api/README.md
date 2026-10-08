# API legada simulada

> **English summary:** a deliberately awkward legacy REST API (Fastify 5 + `node:sqlite`) with a real security layer: hashed service tokens, member/admin RBAC and two rate-limit buckets (per IP and per token). The MCP server in `src/mcp` is an HTTP client of this API. Contract: [`openapi.json`](./openapi.json), checked against the registered routes by `tests/legacy-api/openapi-contract.int.test.ts`.

A API imita um sistema antigo de cadastro de clientes: nomes de campo crípticos (`cst_nm`, `dt_cad`), códigos (`A`/`I`, `1`/`2`/`3`), mensagens sem acento e algumas armadilhas de propósito. Ela é a autoridade de autenticação, papel e limite; o servidor MCP nunca acessa o banco.

## Como subir

```bash
npm run api
```

Sobe em `http://127.0.0.1:9999` com o banco em `./data/legacy.db` (criado com 30 clientes fictícios na primeira vez). O `npm run api` lê um `.env` na raiz, se existir.

| Variável | Padrão | Validação |
|---|---|---|
| `PORT` | `9999` | inteiro de 1 a 65535 |
| `HOST` | `127.0.0.1` | texto |
| `DATABASE_PATH` | `./data/legacy.db` | caminho; `:memory:` para um banco descartável |
| `RATE_LIMIT_PER_TOKEN` | `90` | inteiro >= 1 |
| `RATE_LIMIT_PER_IP` | `180` | inteiro >= 1 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | inteiro >= 1000 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

Com valor inválido a API não sobe: sai com código 1 e escreve em stderr só o nome da variável e o motivo, nunca o valor.

## Como emitir um token

Os tokens são emitidos pela CLI, direto no arquivo do banco (a API pode estar rodando):

```bash
npm run tokens -- issue --name meu-cliente --role member --expires-in 30d
npm run tokens -- list
npm run tokens -- revoke <id>
```

- `issue` mostra o token completo **uma única vez**; o banco guarda só o SHA-256 dele. Papéis: `member` (só leitura) e `admin` (leitura e escrita). Sem `--expires-in` (`<n>d` ou `<n>h`), o token não expira.
- `list` mostra id, nome, papel, datas e status (`ativo`, `revogado`, `expirado`); `--json` devolve a mesma lista em JSON. Nunca mostra hash nem token.
- `revoke` vale na requisição seguinte, sem reiniciar a API (a verificação consulta o banco a cada pedido). Revogar de novo devolve 0; id inexistente devolve 2.
- `--db <caminho>` escolhe o banco; sem ele, vale `DATABASE_PATH` e depois `./data/legacy.db`.

O formato é `slm_<id>_<segredo>`: `<id>` tem 8 caracteres públicos e `<segredo>` tem 43 caracteres base64url (256 bits aleatórios). O prefixo facilita a varredura de segredos.

## Exemplos com `curl`

```bash
export SLM_TOKEN='slm_<id>_<segredo>'   # o valor impresso pelo issue

curl -s http://127.0.0.1:9999/v1/health
curl -s http://127.0.0.1:9999/v1/auth/whoami -H "Authorization: Bearer $SLM_TOKEN"
curl -s 'http://127.0.0.1:9999/v1/customers?nm=teodoro&lim=6' -H "Authorization: Bearer $SLM_TOKEN"
curl -s 'http://127.0.0.1:9999/v1/customers?sts=A&seg=3&dt_de=20240101&dt_ate=20241231&lim=10' -H "Authorization: Bearer $SLM_TOKEN"
curl -s http://127.0.0.1:9999/v1/customers/12 -H "Authorization: Bearer $SLM_TOKEN"

# escrita: exige token admin
curl -s -X POST http://127.0.0.1:9999/v1/customers -H "Authorization: Bearer $SLM_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"cst_nm":"Cliente Novo","cst_phn":"11900000099","cst_eml":"cliente.novo@example.com","cst_seg":2}'
```

Use `curl -i` para ver os cabeçalhos `x-request-id` e `x-ratelimit-*`.

## Rotas

| Método e rota | Papel | Respostas |
|---|---|---|
| `GET /v1/health` | pública | 200 `{"status":"UP"}` |
| `GET /v1/auth/whoami` | qualquer | 200 `{"tokenId","name","role"}` |
| `GET /v1/customers` | qualquer | 200 `{"qtd": <total filtrado>, "dados": [...]}`; 400 `{"erro":"parametro invalido: <nome>"}` |
| `GET /v1/customers/:id` | qualquer | 200 com o objeto do cliente; 404 `{"msg":"nao encontrado"}` |
| `POST /v1/customers` | admin | 201 `{"id": n, "msg": "cadastrado"}`; 409 `{"erro":"email duplicado"}`; 400 (corpo padrão do Fastify, armadilha 9) |
| `PUT /v1/customers/:id` | admin | 200 `{"id": n, "msg": "atualizado"}`; 404; 409; 400 |
| `DELETE /v1/customers/:id` | admin | 200 `{"id": n, "msg": "removido"}`; 404 |

Qualquer rota: 500 `{"erro":"erro interno"}` numa falha inesperada (o detalhe vai só para o log; a armadilha 6 é a única exceção) e, para uma rota que não existe, 404 `{"msg":"nao encontrado"}` depois da autenticação.

Filtros da listagem: `nm` (trecho do nome, sem acento e sem caixa), `eml` (exato, sem caixa), `phn` (só dígitos, exato), `sts` (`A`/`I`), `seg` (`1` retail, `2` smb, `3` enterprise), `dt_de` e `dt_ate` (`YYYYMMDD`, inclusivos), `lim` (1 a 500) e `off` (>= 0). Ordem: nome normalizado e `cst_id`.

## Armadilhas deliberadas

Comportamentos de sistema legado mantidos de propósito; o servidor MCP é que as esconde atrás das ações de negócio.

1. `GET /v1/customers` sem `lim` devolve **todos** os clientes filtrados.
2. Parâmetros desconhecidos (por exemplo `name=`) são **ignorados em silêncio**: a listagem volta sem aquele filtro.
3. A listagem tem envelope (`qtd`, `dados`); o `GET /v1/customers/:id` devolve o objeto **sem envelope**.
4. O `POST` devolve só o id, não o objeto criado.
5. O `PUT` exige o objeto **completo** (`cst_nm`, `cst_phn`, `cst_eml`, `cst_sts`, `cst_seg`); falta de campo dá 400.
6. Se o corpo do `PUT` contiver `cst_id`, a API responde **500 com a mensagem bruta do SQLite**, como no caso de atualização com identificador no corpo visto na aula 203485 (`PUT` com objeto completo).
7. O `DELETE` é físico. O servidor MCP não o expõe.
8. Nomes de campo crípticos e mensagens sem acento (`nao encontrado`, `parametro invalido`).
9. Os erros de corpo (400 de validação ou de JSON malformado, 413) vêm no formato padrão do Fastify, em inglês (`statusCode`, `code`, `error` e `message`, que na validação nomeia o campo), diferente do `{"erro": ...}` das outras respostas.

## Segurança

Ordem dos hooks em cada pedido: balde por IP, autenticação, balde por token e, nas rotas de escrita, o papel.

- **401** `{"erro":"nao autorizado"}`: o mesmo corpo para token ausente, malformado, desconhecido, revogado ou expirado.
- **403** `{"erro":"proibido","papel_necessario":"admin"}`: token `member` em `POST`, `PUT` ou `DELETE`. O papel vem só do registro do token no banco; cabeçalhos ou campos `role` enviados pelo cliente são ignorados.
- **429** `{"erro":"limite excedido"}` com `retry-after` em segundos.
- **Limites:** 90 pedidos por token e 180 por IP a cada 60 s, em janela fixa (na virada da janela, até o dobro passa em sequência; ver `docs/security.md`). O balde de IP conta antes da autenticação, inclusive os pedidos que terminam em 401. `GET /v1/health` fica fora dos dois baldes.
- **Cabeçalhos de limite:** toda resposta de rota protegida traz `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-scope` (`ip` ou `token`) do balde que decidiu: `ip` num 429 de IP e num 401; `token` no resto.
- **Clientes na mesma máquina:** VS Code, Inspector, demo e agente rodando localmente dividem os 180 pedidos por minuto de `127.0.0.1`. Um 429 com `x-ratelimit-scope: ip` pode aparecer mesmo com cada token abaixo de 90.
- **`x-request-id`:** a API adota o valor recebido só se for um UUID; caso contrário gera um novo. O valor final volta no cabeçalho da resposta e aparece nos logs.
- **Logs:** uma linha JSON por evento (pino), com o cabeçalho `Authorization` redigido, tokens mascarados na URL logada (`?token=slm_<id>_***`, se alguém colar o token na query string; ele não autentica) e uma linha `audit` por escrita (`tokenId`, `role`, método, rota e status).
- **Porta ocupada:** a API sai com código 1 e uma linha curta (`porta 9999 em uso em 127.0.0.1; escolha outra com PORT`), sem stack.
- **Corpo:** no máximo 16 KiB (413 acima disso). O IP vem do socket; `X-Forwarded-For` é ignorado.
