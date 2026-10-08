# ADR 0002: Só stdio, sem transporte HTTP

- **Status:** aceito (2026-10-04)

## Contexto

O SDK 1.32 oferece três transportes: stdio, Streamable HTTP e SSE. O servidor roda na máquina de quem usa o editor ou o agente, ao lado da API legada local. A aula 203492 compara os transportes; stdio é também o transporte de um servidor distribuído como pacote npm e iniciado pelo próprio cliente.

| Transporte | Onde roda | Autenticação do cliente MCP | Situação no SDK 1.32 |
|---|---|---|---|
| stdio | processo filho do cliente, na mesma máquina | não há rede; o processo herda só o `env` que o cliente passa | suportado |
| Streamable HTTP | serviço remoto, várias sessões | a especificação de autorização do MCP pede o servidor como resource server OAuth 2.1 | suportado, transporte atual para remoto |
| SSE | serviço remoto | idem | legado, mantido por compatibilidade |

## Decisão

Só stdio. O servidor recebe um `SERVICE_TOKEN` por variável de ambiente e o usa para falar com a API, que é a autoridade de autenticação, papel e limite. Nada de porta aberta pelo MCP.

## Consequências

- A segurança é demonstrada onde ela mora: na API (tokens com hash, RBAC, dois baldes de limite).
- Um token por processo: o demo sobe um processo MCP por token; cada editor configura o seu.
- Disciplina do stdout vira requisito testado: stdout é o canal JSON-RPC, log vai para stderr (MCP-02, MCP-03).
- Uso remoto, multiusuário, não é atendido. Se for pedido, vira um spec novo.

## Alternativas

- **Streamable HTTP aceitando o Service Token no MCP e repassando à API:** é o anti-padrão *token passthrough* da leitura *Security Best Practices* indicada em 203470: o MCP aceitaria um token que não foi emitido para ele e perderia a fronteira de auditoria. Fazer direito exige OAuth 2.1 com o MCP como resource server, escopo novo para este projeto.
- **SSE:** mesmo problema de autenticação, e é o transporte legado.
