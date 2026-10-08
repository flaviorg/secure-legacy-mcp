# MCP clients: VS Code, Cursor, Claude Desktop and Inspector

> **Summary:** how to connect MCP clients to the `secure-legacy-mcp` stdio server. Only `.vscode/mcp.json` is versioned, and it asks for the service token through a password input. Cursor and Claude Desktop appear here as snippets with the `slm_<id>_<secret>` placeholder: their config files hold the token in plain text, so they never go into a repository.

All clients follow the same three steps: start the legacy API, issue a token through the CLI, and start the MCP server from the client, which passes the token in the `SERVICE_TOKEN` variable. The server needs Node 24 (it runs TypeScript directly, with no build).

## Before any client

```bash
npm run api                                              # API at http://127.0.0.1:9999
npm run tokens -- issue --name vscode --role member      # copy the token now: it is not shown again
```

- Use `member` for read-only (`getCustomer`, `searchCustomers`). The writes (`createCustomer`, `updateCustomerContact`, `deactivateCustomer`) require an `admin` token; with `member`, they return `[FORBIDDEN]`.
- One token per client (`--name vscode`, `--name cursor`, ...) lets the API log say who did what and lets you revoke just one of them with `npm run tokens -- revoke <id>`. Revocation takes effect on the next call, with nothing to restart.
- If the API is down, the MCP server starts anyway and the tools answer `[UPSTREAM_UNAVAILABLE]` until it is back.
- Never configure a client with `npm run mcp` as the command: npm writes the `> secure-legacy-mcp@0.1.0 mcp` banner to stdout before the JSON-RPC and corrupts the channel. Use `node .../src/mcp/main.ts` (as in the snippets below) or the package binary. To run it by hand in a terminal, `npm run -s mcp` does not print the banner.

## VS Code

The versioned config is at [`.vscode/mcp.json`](../../.vscode/mcp.json). It starts `node ${workspaceFolder}/src/mcp/main.ts` with `LEGACY_API_URL=http://127.0.0.1:9999` and asks for the token through an `input` of type `promptString` with `password: true`. VS Code stores the token, outside the file.

1. With the API up and a token issued, open the project folder in VS Code.
2. Open `.vscode/mcp.json` and click **Start** above `secure-legacy-mcp` (or run the **MCP: List Servers** command).
3. Paste the token into the password prompt.
4. Open a **new** chat in agent mode. A chat opened before the server started does not see the tools (a trap seen in lesson 221518, on stdio discipline and editor configs).
5. Ask, for example, "find the customer teodoro". VS Code should call `getCustomer`.

To change the token, clear the stored input with the `MCP:` commands in the command palette and restart the server: VS Code asks for the token again.

## Cursor

Cursor reads `mcpServers` from `.cursor/mcp.json` (in the project) or from `~/.cursor/mcp.json` (global). It has no password input, so the token is written in the file: keep that file out of any repository and prefer a `member` token just for it.

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/secure-legacy-mcp/src/mcp/main.ts"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<secret>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

Use an absolute path in `args`. The env holds only the two variables the server needs; do not inject the whole `.env`, which may have keys for other services.

## Claude Desktop

On macOS, the file is `~/Library/Application Support/Claude/claude_desktop_config.json`. After editing, quit and reopen Claude Desktop.

Today, running from the repository clone:

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/secure-legacy-mcp/src/mcp/main.ts"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<secret>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

After a future npm publication, the same server can start from the package binary:

```json
{
  "mcpServers": {
    "secure-legacy-mcp": {
      "command": "npx",
      "args": ["-y", "secure-legacy-mcp"],
      "env": {
        "SERVICE_TOKEN": "slm_<id>_<secret>",
        "LEGACY_API_URL": "http://127.0.0.1:9999"
      }
    }
  }
}
```

**The `PATH` trap with nvm:** graphical apps do not load the shell profile, so `node` and `npx` installed by nvm are not on Claude Desktop's `PATH`. The symptom is the server showing up as failed right when the app opens. The fix is to use the absolute path: run `which node` (or `which npx`) in the terminal, with Node 24 active, and paste the result into `command`. With `npx`, the process's `PATH` also needs to find the right `node`; if it does not, add `"PATH": "<node 24 folder>:/usr/bin:/bin"` to the `env`.

## Inspector

```bash
npm run mcp:inspect
```

Opens the MCP Inspector in the browser with the server at `node src/mcp/main.ts`, reading `SERVICE_TOKEN` and `LEGACY_API_URL` from the `.env` at the root. The first time, `npx` downloads the Inspector, which needs the network. Without a `.env`, Node writes a missing-file warning to stderr and carries on; in that case the server exits with code 1 and `config_invalid` on stderr, because `SERVICE_TOKEN` is missing.

## Several clients on the same machine

The per-IP limit (180 requests per minute) is applied before authentication and covers all of `127.0.0.1`. VS Code, Cursor, Claude Desktop, Inspector and the demo running together share this bucket. That is why a `[RATE_LIMITED]` with `scope: "ip"` in the `_meta` can show up even with each token under its 90-requests-per-minute limit. The error text already says in how many seconds to try again.
