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

## Ocorrências, mapa, auditoria e notificações

| Rota | Quem | Observação |
| --- | --- | --- |
| `POST /occurrences` | cidadão com onboarding | multipart: `category`, `description`, `lat`, `lng`, `photo` (opcional). Status inicial: `nao_verificado` |
| `GET /occurrences/map?bbox=minLng,minLat,maxLng,maxLat` | público | só `em_analise`, `em_atendimento` e `resolvido` (resolvido some após 5 dias; `includeResolved=true` traz todos) |
| `GET /occurrences/:id` e `/photo` | público, dono ou prefeitura | não verificadas/recusadas: só dono e prefeitura (os demais recebem 404) |
| `GET /me/occurrences` | cidadão | todas as suas, qualquer status |
| `GET /staff/occurrences` | prefeitura | fila com filtros `status`, `category`, `bbox` |
| `PATCH /staff/occurrences/:id` | prefeitura | status (com transições válidas), categoria, descrição, local; motivo obrigatório ao recusar |
| `PUT /staff/occurrences/:id/photo` | prefeitura | troca a foto |
| `GET /staff/occurrences/:id/audit` | prefeitura | trilha de auditoria |
| `GET /me/notifications`, `POST /me/notifications/:id/read`, `POST /me/notifications/read-all` | logado | avisos de mudança de status |

- **Auditoria:** tabela `occurrence_audit` (quem, quando, o que mudou de/para). Um trigger do Postgres bloqueia `UPDATE` e `DELETE`.
- **Fotos:** gravadas em disco (`UPLOAD_DIR`, volume Docker `uploads`), reprocessadas com `sharp` (valida o conteúdo, remove EXIF/GPS, 1600 px + miniatura de 400 px). Nunca servidas como arquivo estático: sempre pela rota, que checa a visibilidade. Para trocar por S3/R2, reescreva só `apps/api/src/storage.ts`.
- **Página de teste com mapa:** `tools/teste-ocorrencias.html` (Leaflet + OpenStreetMap).
- **Faça backup do volume `uploads`** junto com o banco.

## Painel da prefeitura (apps/painel)

Next.js 15 + Tailwind v4 + componentes no padrão shadcn/ui (azul cobalto, fonte Geist). Telas: login (senha + TOTP), visão geral com números, fila de ocorrências com mapa, detalhe com mudança de status e histórico de auditoria.

- `docker compose up -d --build` sobe o painel em http://localhost:3000 (variável `PAINEL_PORT`).
- Sem Docker: `pnpm dev:painel` (com `API_URL=http://localhost:3333`).
- **Tokens nunca chegam ao JavaScript do navegador.** O painel guarda o JWT e o refresh em cookies `httpOnly` + `SameSite=Strict` e fala com a API por um proxy próprio (`/api/proxy/*`) que só aceita rotas de uma lista branca. Mutações exigem `Origin` igual ao do painel.
- Em produção, sirva por HTTPS e defina `COOKIE_SECURE=true` e `PAINEL_URL=https://...`.
- Criar o primeiro funcionário: `docker compose exec api node --import tsx dist/scripts/create-staff.js --email ... --name "..." --role gestor` (ou `pnpm staff:create` fora do Docker).
- Rota nova na API: `GET /staff/stats` (contagens por status/categoria, tempo médio de resolução, criadas por dia).

### Planilha e cadastro manual (painel)

- **/planilha**: tabela com filtros (status, categoria, período, busca) e **Exportar CSV** (todas as linhas do filtro, não só a página; UTF-8 com BOM e separador `;`, abre direto no Excel em português). Células que começariam com `= + - @` ganham um apóstrofo para não virarem fórmula.
- **Nova ocorrência** (botão nas telas Ocorrências e Planilha): para registrar ligações e atendimentos de balcão. Local escolhido clicando no mapa, foto **opcional**, status inicial à escolha (padrão "Em análise"), e contato de quem relatou (nome e telefone, **cifrados** no banco e visíveis só para funcionários). Rota: `POST /staff/occurrences` (multipart). A origem fica registrada como "Prefeitura" e a criação entra na auditoria.
- A exportação contém dados pessoais (contato de quem ligou): trate o arquivo conforme a LGPD.

### Configuração e relatórios (painel)

- **/configuracao** (só gestor): categorias (nome, cor, ícone, ativa, ordem) e status (nome, cor, ativo, ordem). Tudo é lido do banco (`GET /meta`, público e com cache curto): pinos, legenda, filtros, planilha e relatórios usam esses valores. Cada alteração grava em `config_audit` (somente inserção, o banco recusa UPDATE/DELETE).
- **As regras seguem o *tipo* do status, não o nome**: `initial` (não verificado, fora do mapa), `active` (em andamento, no mapa), `resolved` (some do mapa depois de 5 dias; filtro "resolvidos" mostra) e `rejected` (exige motivo). Status criados pela prefeitura são sempre `active`. Os 5 status e 5 categorias originais são "do sistema": só aceitam nome, cor e ordem (categorias podem ser desativadas; status do sistema não). Itens já usados em ocorrências não são excluídos, só desativados.
- **/relatorios**: totais, tempo médio e mediana de resolução, por bairro, categoria, status, faixa de tempo e período (dia a dia até ~3 meses, depois mês a mês), com filtros e **CSV por tabela** (`GET /staff/reports`; só números agregados, sem dados pessoais).
- **Bairro automático**: ocorrência sem bairro é consultada pelo ponto no mapa (Nominatim/OpenStreetMap) em segundo plano, 1 consulta por 1,1 s, e a ação entra na auditoria como `geocode_auto`. O gestor reprocessa as antigas em Configuração, aba "Bairro automático" (`POST /staff/geocode/backfill`). Variáveis: `GEOCODER_ENABLED`, `GEOCODER_URL`, `GEOCODER_USER_AGENT`. O serviço público é só para demo; em produção aponte `GEOCODER_URL` para um geocoder próprio ou pago.
- Migração `0004_dynamic_config`: transforma os enums `category`/`status` em tabelas, preservando os dados existentes.
