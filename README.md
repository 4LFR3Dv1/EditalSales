# Edital Sales

Aplicação frontend React com backend Python local para Radar de Editais, CRM de Oportunidades, Base de Artistas e Fontes de Ingestão.

## Execução

```bash
npm i
npm run backend
npm run dev
```

## Backend

O backend roda em `http://localhost:8000` e expõe a API em `/api/v1`.

### Persistência

O backend suporta duas estratégias:

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: persiste o estado via API HTTP do Supabase.
- `DATABASE_URL`: fallback para conexão Postgres direta.

Para usar o Supabase HTTP, crie a tabela abaixo no SQL editor:

```sql
create table if not exists public.app_state (
  state_key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

Depois configure:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua-service-role-key-ou-secret-key>
SUPABASE_STATE_TABLE=app_state
SUPABASE_STATE_KEY=default
```

### Endpoints principais

- `GET /health`
- `GET /api/v1/summary`
- `GET /api/v1/editais`
- `POST /api/v1/editais`
- `POST /api/v1/editais/import`
- `GET /api/v1/editais/:id`
- `POST /api/v1/editais/:id/analyze`
- `GET /api/v1/oportunidades`
- `POST /api/v1/oportunidades`
- `PATCH /api/v1/oportunidades/:id`
- `GET /api/v1/artistas`
- `POST /api/v1/artistas`
- `GET /api/v1/artistas/:id`
- `GET /api/v1/projetos`
- `POST /api/v1/projetos`
- `GET /api/v1/documentos`
- `POST /api/v1/documentos`
- `GET /api/v1/sources`
- `POST /api/v1/sources`
- `PATCH /api/v1/sources/:id`
- `POST /api/v1/sources/:id/sync`
- `POST /api/v1/sources/sync`
- `GET /api/v1/ingestions`
- `GET /api/v1/chat/edital/:id/messages`
- `POST /api/v1/chat/edital/:id/messages`
- `GET /api/v1/chat/oportunidade/:id/messages`
- `POST /api/v1/chat/oportunidade/:id/messages`

## Estrutura

- `backend/app/main.py`: servidor HTTP e rotas.
- `backend/app/store.py`: persistência JSON local.
- `backend/app/seed.py`: base inicial do sistema.
- `backend/app/ingest.py`: coleta e normalização de fontes.
- `backend/app/services.py`: análise, oportunidades e chat.

## Observação

O polling automático das fontes é opt-in via variável de ambiente:

```bash
SOURCE_POLLING_ENABLED=1
```

Sem isso, as fontes ficam cadastradas e o sync fica disponível manualmente pela UI.

Para ativar o enriquecimento automático via OpenAI Responses API:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_SECONDS=90
```

Se a chave não estiver definida, o backend usa o fallback local e mantém o funcionamento normal.
