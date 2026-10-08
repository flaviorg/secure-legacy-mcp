# ADR 0003: Service Tokens com SHA-256 em SQLite

- **Status:** aceito (2026-10-04)

## Contexto

Na aula 203488 os tokens ficavam num `Map` em memória e eram UUIDs, emitidos por uma rota pública protegida por um segredo fixo. Os próprios riscos foram citados: reinício perde tudo, vazamento de memória ou banco expõe tokens utilizáveis, não há revogação nem expiração. O ambiente não tem Docker; o Node 24 traz `node:sqlite`.

## Decisão

- Formato `slm_<id>_<segredo>`: id de 8 caracteres `[a-z0-9]` (`crypto.randomInt`) e segredo de 32 bytes aleatórios em base64url (43 caracteres, 256 bits). O prefixo `slm_` facilita *secret scanning*.
- O banco guarda só `sha256(token)` em hex, com `name`, `role`, `created_at`, `last_used_at`, `expires_at` e `revoked_at`. O token aparece em claro uma única vez, na emissão.
- Verificação a cada requisição, sem cache: regex, id, busca da linha, `timingSafeEqual` dos hashes, `revoked_at`, `expires_at`; atualiza `last_used_at` (D-14). A revogação vale na requisição seguinte.
- Emissão, listagem e revogação só pela CLI local (`npm run tokens`), com acesso ao arquivo do banco. Sem rota de emissão. Expiração opcional (`--expires-in`), nunca por padrão (D-10).
- `DatabaseSync(path, { timeout: 5000 })` e WAL em arquivo, para a CLI e a API escreverem no mesmo arquivo sem `SQLITE_BUSY`.

## Consequências

- Um vazamento do banco não entrega tokens utilizáveis. A revogação é imediata, sem reinício (SEC-07, testado com a API no ar).
- Quem tem acesso ao arquivo do banco administra tokens: é o "painel com login forte" da aula, trocado por acesso local.
- `last_used_at` escrito a cada requisição custa uma escrita por chamada; aceitável num SQLite local com volume de demo.

## Alternativas

- **argon2 ou bcrypt:** hash lento protege segredos de baixa entropia (senhas). Um segredo de 256 bits aleatórios não é atacável por força bruta, e o hash lento só somaria latência a cada requisição (D-09).
- **HMAC com pepper:** protege contra quem lê o banco mas não o pepper; exigiria gerenciar mais um segredo, sem ganho real para tokens de 256 bits.
- **JWT:** revogação exige lista de bloqueio ou expiração curta; o MCP não precisa de token autocontido.
