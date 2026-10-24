# Sinaly

Plataforma de gestão colaborativa de problemas urbanos. O cidadão registra ocorrências no mapa; a prefeitura aprova, prioriza e atualiza o andamento.

## Estrutura

| Pasta | O que é |
| --- | --- |
| `apps/api` | API Fastify + TypeScript + Drizzle (Postgres/PostGIS) |
| `apps/painel` | Painel da prefeitura (Next.js) |
| `apps/app` | App do cidadão (Expo: Android + web) |
| `packages/shared` | Tipos e schemas Zod usados pelos três |
| `infra/` | Inicialização do Postgres |

## Subir o ambiente (staging ou local)

```bash
cp .env.example .env      # troque TODAS as senhas
docker compose up -d --build
curl http://localhost:3333/health   # {"status":"ok"}
```

O `docker compose` sobe Postgres+PostGIS, MinIO (fotos), aplica as migrations e inicia a API. Tudo é configurado pelo `.env`.

Em servidor público, mantenha `BIND_ADDR=127.0.0.1` (banco e MinIO não ficam expostos) e coloque a API atrás de um proxy HTTPS (Caddy ou Nginx) com domínio.

## Desenvolvimento

```bash
pnpm install
docker compose up -d postgres            # só o banco
export DATABASE_URL=postgres://sinaly:SENHA@localhost:5432/sinaly
pnpm db:migrate
pnpm dev:api        # http://localhost:3333
pnpm dev:painel     # http://localhost:3000
pnpm dev:app        # Expo
```

Após mudar `apps/api/src/db/schema.ts`: `pnpm db:generate` e commitar a pasta `apps/api/drizzle`.

## Convenções importantes

- Coordenadas: sempre WGS84 (SRID 4326), `x = longitude`, `y = latitude`. Consultas do mapa usam bounding box (`location && ST_MakeEnvelope(...)`) para aproveitar o índice GiST.
- Rota pública do mapa filtra `status` em `PUBLIC_STATUSES` (`packages/shared`) direto no SQL.
- Segredos só em `.env` (ignorado pelo git).

## Autenticação

| Rota | Quem | Observação |
| --- | --- | --- |
| `POST /auth/register` | público | Sempre cria **cidadão** (papel nunca vem do cliente) |
| `POST /me/onboarding` | cidadão | Nome, sobrenome, telefone, CPF e endereço; uma única vez |
| `POST /auth/login` | cidadão | 10/min por IP; 5 erros bloqueiam a conta por 15 min |
| `POST /auth/staff/login` | funcionário | Senha **+ código TOTP**; 10/15 min por IP; 5 erros bloqueiam por 1 h |
| `POST /auth/refresh` | todos | Rotaciona o refresh token; reuso derruba a sessão inteira |
| `POST /auth/logout` | todos | Invalida a sessão na hora |
| `GET /me` | todos | Inclui `onboardingComplete` |

**Não existe rota HTTP para criar funcionário.** Crie no servidor, com acesso ao banco:

```bash
# fora do Docker
pnpm staff:create --email maria@prefeitura.gov.br --name "Maria Silva" --role servidor   # ou gestor
# dentro do Docker
docker compose run --rm api node --import tsx dist/scripts/create-staff.js --email ... --name "..." --role gestor
```

O comando mostra, uma única vez, a senha gerada e o segredo TOTP (cadastre no Google Authenticator/Authy).

Gere os segredos do `.env` com `openssl rand -base64 48` (JWT e pepper) e `openssl rand -base64 32` (chave de cifragem). **Faça backup da `DATA_ENCRYPTION_KEY`**: sem ela os CPFs cifrados não podem ser lidos.

## Testes

```bash
export DATABASE_URL=postgres://...@localhost:5432/sinaly_test   # banco de TESTE (as tabelas são apagadas!)
pnpm db:migrate && pnpm test
```
