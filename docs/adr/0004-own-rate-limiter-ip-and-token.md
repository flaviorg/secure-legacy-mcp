# ADR 0004: Limitador próprio, com balde por IP e por token

- **Status:** aceito (2026-10-04)

## Contexto

A aula 203489 limitou 90 requisições por minuto por token com `@fastify/rate-limit`, caindo para o IP quando não havia token. A aula 203490 apontou o contorno: quem tem vários tokens multiplica o limite. O plugin aceita uma chave por registro; o projeto quer dois limites ao mesmo tempo e testes determinísticos.

## Decisão

- Limitador de janela fixa próprio (`fixed-window-limiter.ts`, cerca de 50 linhas), em memória, com relógio injetável. A janela de cada chave começa no primeiro `hit`.
- Dois baldes por requisição: **IP** (180 por 60 s) no primeiro `onRequest`, antes da autenticação, o que também freia força bruta de 401; **token** (90 por 60 s) depois da autenticação.
- Cabeçalhos `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-scope` (`ip` ou `token`) do balde que decidiu a resposta; 429 com `retry-after`.
- `GET /v1/health` fica fora dos dois baldes (D-28): checagem de saúde não deve consumir limite, e o custo de abuso é baixo numa API em `127.0.0.1`.
- O MCP traduz o 429 em `[RATE_LIMITED]` com o limite, os segundos de espera e o escopo no `_meta`.

## Consequências

- Três tokens no mesmo IP são barrados na 181ª requisição (SEC-06).
- Vários clientes locais (editor, Inspector, agente) dividem o balde de IP, porque todos saem de `127.0.0.1`. O `x-ratelimit-scope` mostra qual balde barrou; `docs/security.md` explica.
- O limite zera quando a API reinicia, e não é compartilhado entre instâncias.
- Janela fixa: uma rajada no fim de uma janela somada a outra no começo da seguinte deixa passar até 2 vezes o limite em poucos milissegundos. Aceito para uma API local; janela deslizante ou token bucket fechariam a brecha.

## Alternativas

- **`@fastify/rate-limit`:** maduro, mas uma chave por registro; dois registros com chaves diferentes no mesmo app e o relógio de teste exigiriam contornos. Revisitar se surgir necessidade de store distribuído (D-06).
- **Só por token:** reabre o contorno por vários tokens e deixa a força bruta de token sem freio antes da autenticação.
