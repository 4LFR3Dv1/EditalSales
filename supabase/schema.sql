create table if not exists public.app_state (
  state_key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
