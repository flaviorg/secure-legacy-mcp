# Incidentes

Registro de falhas reais durante a construção e o uso do projeto. Nada aqui é inventado: se não aconteceu, não entra.

## Modelo de post-mortem

```markdown
## AAAA-MM-DD: título curto

- **Impacto:** o que parou ou ficou errado, e por quanto tempo.
- **Detecção:** como e quando foi percebido.
- **Causa raiz:** o mecanismo, não o culpado.
- **Correção:** o que foi feito na hora.
- **Prevenção:** teste, regra ou processo que impede a repetição.
```

## Incidentes ocorridos

O projeto nunca foi publicado nem implantado, então não houve incidente com usuário. Durante a construção houve um incidente de processo:

## 2026-10-04: suíte vermelha deixada por uma execução interrompida

- **Impacto:** `npm test` terminou com 1 falha (`[PKG-03] .vscode/mcp.json is valid JSON ...`, `ENOENT`) até a execução seguinte. As entregas das tarefas 24 a 29 estavam no disco e verdes, mas sem registro no log de progresso.
- **Detecção:** a execução seguinte rodou a suíte antes de qualquer mudança, como manda o processo, e viu a falha.
- **Causa raiz:** a construção roda em blocos de tarefas. Uma execução parou entre o Passo 1 da Tarefa 30 (teste escrito e vermelho, como o TDD pede) e o Passo 3 (criar `.vscode/mcp.json` e `docs/clients/README.md`). O log de progresso só era escrito no fim do bloco, então nada dizia o que estava pela metade.
- **Correção:** o Passo 3 da Tarefa 30 foi feito com o conteúdo do plano, e o teste passou. As tarefas sem registro foram conferidas contra o plano e a spec, e um teste de mutação (48 mutantes) achou 8 lacunas de teste, fechadas com testes vistos falhando contra o mutante.
- **Prevenção:** toda execução começa rodando `npm test` e `npm run typecheck` e conserta o que estiver vermelho antes de seguir. O hook `.githooks/pre-commit` impede um commit com a suíte vermelha.
