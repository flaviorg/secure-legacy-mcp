# Clientes MCP: VS Code, Cursor, Claude Desktop e Inspector

> **English summary:** how to connect MCP clients to the `secure-legacy-mcp` stdio server. Only `.vscode/mcp.json` is versioned, and it asks for the service token through a password input. Cursor and Claude Desktop appear here as snippets with the `slm_<id>_<segredo>` placeholder: their config files hold the token in plain text, so they never go into a repository.

Todos os clientes seguem os mesmos três passos: subir a API legada, emitir um token pela CLI e iniciar o servidor MCP pelo cliente, que passa o token na variável `SERVICE_TOKEN`. O servidor precisa de Node 24 (roda TypeScript direto, sem build).

## Antes de qualquer cliente

```bash
npm run api                                              # API em http://127.0.0.1:9999
npm run tokens -- issue --name vscode --role member      # copie o token agora: ele não aparece de novo
```

- Use `member` para só leitura (`getCustomer`, `searchCustomers`). As escritas (`createCustomer`, `updateCustomerContact`, `deactivateCustomer`) exigem um token `admin`; com `member`, elas devolvem `[FORBIDDEN]`.
- Um token por cliente (`--name vscode`, `--name cursor`, ...) deixa o log da API dizer quem fez o quê e permite revogar só um deles com `npm run tokens -- revoke <id>`. A revogação vale na chamada seguinte, sem reiniciar nada.
- Se a API estiver fora do ar, o servidor MCP sobe assim mesmo e as tools respondem `[UPSTREAM_UNAVAILABLE]` até ela voltar.
- Nunca configure um cliente com `npm run mcp` como comando: o npm escreve o banner `> secure-legacy-mcp@0.1.0 mcp` no stdout antes do JSON-RPC e corrompe o canal. Use `node .../src/mcp/main.ts` (como nos trechos abaixo) ou o binário do pacote. Para rodar à mão no terminal, `npm run -s mcp` não imprime o banner.

## VS Code

A config versionada está em [`.vscode/mcp.json`](../../.vscode/mcp.json). Ela inicia `node ${workspaceFolder}/src/mcp/main.ts` com `LEGACY_API_URL=http://127.0.0.1:9999` e pede o token por um `input` do tipo `promptString` com `password: true`. O token fica guardado pelo VS Code, fora do arquivo.

1. Com a API no ar e um token emitido, abra a pasta do projeto no VS Code.
2. Abra `.vscode/mcp.json` e clique em **Start** acima de `secure-legacy-mcp` (ou rode o comando **MCP: List Servers**).
3. Cole o token no prompt de senha.
4. Abra um chat **novo** no modo agente. Um chat aberto antes de o servidor subir não enxerga as tools (armadilha vista na aula 221518, sobre a disciplina do stdio e as configs de editor).
5. Peça, por exemplo, "procure o cliente teodoro". O VS Code deve chamar `getCustomer`.

Para trocar o token, limpe o input guardado pelos comandos `MCP:` da paleta de comandos e reinicie o servidor: o VS Code pede o token de novo.

## Cursor

O Cursor lê `mcpServers` de `.cursor/mcp.json` (no projeto) ou de `~/.cursor/mcp.json` (global). Ele não tem input de senha, então o token fica escrito no arquivo: mantenha esse arquivo fora de qualquer repositório e prefira um token `member` só para ele.

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "node",
      "args": ["/caminho/absoluto/para/secure-legacy-mcp/src/mcp/main.ts"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<segredo>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

Use caminho absoluto em `args`. O env contém só as duas variáveis de que o servidor precisa; não injete o `.env` inteiro, que pode ter chaves de outros serviços.

## Claude Desktop

No macOS, o arquivo é `~/Library/Application Support/Claude/claude_desktop_config.json`. Depois de editar, feche e abra o Claude Desktop.

Hoje, rodando do clone do repositório:

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "/caminho/absoluto/para/node",
      "args": ["/caminho/absoluto/para/secure-legacy-mcp/src/mcp/main.ts"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<segredo>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

Depois de uma publicação futura no npm, o mesmo servidor pode subir pelo binário do pacote:

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "npx",
      "args": ["-y", "secure-legacy-mcp"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<segredo>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

**Armadilha do `PATH` com nvm:** apps de interface gráfica não carregam o perfil do shell, então `node` e `npx` instalados pelo nvm não estão no `PATH` do Claude Desktop. O sintoma é o servidor aparecer como falho logo ao abrir. A correção é usar o caminho absoluto: `which node` (ou `which npx`) no terminal, com o Node 24 ativo, e colar o resultado em `command`. Com `npx`, o `PATH` do processo também precisa achar o `node` certo; se não achar, acrescente `"PATH": "<pasta do node 24>:/usr/bin:/bin"` ao `env`.

## Inspector

```bash
npm run mcp:inspect
```

Abre o MCP Inspector no navegador com o servidor em `node src/mcp/main.ts`, lendo `SERVICE_TOKEN` e `LEGACY_API_URL` do `.env` na raiz. Na primeira vez, o `npx` baixa o Inspector, o que exige rede. Sem `.env`, o Node escreve no stderr um aviso de arquivo ausente e segue; nesse caso o servidor sai com código 1 e `config_invalid` no stderr, porque falta `SERVICE_TOKEN`.

## Vários clientes na mesma máquina

O limite por IP (180 pedidos por minuto) é aplicado antes da autenticação e vale para `127.0.0.1` inteiro. VS Code, Cursor, Claude Desktop, Inspector e o demo rodando juntos dividem esse balde. Por isso um `[RATE_LIMITED]` com `scope: "ip"` no `_meta` pode aparecer mesmo com cada token abaixo do seu limite de 90 pedidos por minuto. O texto do erro já traz em quantos segundos tentar de novo.
