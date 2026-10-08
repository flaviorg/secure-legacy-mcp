# Constituição do secure-legacy-mcp

Princípios que valem para toda feature deste repositório. Um spec ou uma mudança que contrarie um deles precisa dizer por quê, por escrito, antes do código.

## 1. Segurança antes de conveniência

- A API legada é a autoridade de autenticação, papel e limite. O servidor MCP nunca decide papel nem guarda segredo além do próprio `SERVICE_TOKEN`.
- Token só como hash SHA-256 no banco, exibido uma vez. Erro nunca vaza stack, SQL, URL com segredo ou token.
- Menor privilégio: o que é irreversível (delete físico, reativar, emitir token, mudar papel) não existe como tool.

## 2. Ações de negócio, não endpoints

- O MCP expõe o que o usuário quer fazer (resolver, buscar, cadastrar, atualizar contato, desativar), não um espelho das rotas.
- O de-para do legado (nomes crípticos, códigos, `PUT` com objeto completo) fica na `infrastructure`. Regra de negócio fica no service.

## 3. stdout só JSON-RPC

- No processo MCP, stdout é o canal do protocolo. Log é uma linha JSON por evento em stderr.
- `src/mcp` não usa `console.log`, `console.info`, `console.debug` nem `process.stdout.write`; um teste varre o código e outro lê o stdout cru.

## 4. TDD com o ID EARS no nome do teste

- Todo critério de aceite dos `specs/NNN-*/spec.md` tem ID (`API-01`, `MCP-05`) e pelo menos um teste cujo nome começa por `[ID]`. O `conventions.unit` confere.
- O teste falha antes da implementação. Igualdade de texto só para constantes (catálogo de erros, prompts, `instructions`).

## 5. `npm test` sem rede e sem chave

- A guarda `tests/support/no-network.ts` bloqueia conexões fora de loopback, no processo de teste e nos filhos.
- Cada teste cria a própria API `:memory:`, os próprios tokens e o próprio servidor MCP.

## 6. Fake honesto

- O modelo fake do exemplo de agente segue um roteiro, ignora o prompt de sistema e lança erro explícito para entrada sem roteiro. Ele prova a mecânica, não a qualidade de um modelo, e o README diz isso.
- Os valores que o fake devolve vêm dos resultados reais das tools.

## 7. Versões exatas e pouca dependência

- Três dependências de runtime, com versão exata (`.npmrc` com `save-exact=true`), lockfile versionado, nenhum `postinstall`, nenhum servidor MCP de terceiros.

## 8. Nada publicado sem validação do dono

- Nada de `git push`, `npm publish` ou repositório remoto sem o dono do projeto validar antes. O `npm pack` com `npx` do tarball prova o binário sem publicar.

## 9. Idioma

- Textos voltados ao modelo (descrições de tools, erros, resources, prompts do servidor) e código em inglês. README e documentação em português, com resumo em inglês no topo do README.
- Aulas do curso são citadas só por ID e tema; nenhuma transcrição, slide ou material autoral entra no repositório.
