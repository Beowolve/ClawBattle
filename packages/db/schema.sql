-- ClawBattle Supabase Schema
-- Idempotent — safe to run multiple times.

-- Helper function for updated_at triggers
create or replace function update_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── runs ────────────────────────────────────────────────────────────────────

create table if not exists public.runs (
  id                  bigserial primary key,
  run_id              text not null,
  benchmark_version   text not null,
  model               text not null,
  provider            text not null,
  prompt_version      text,
  temperature         real,
  attempts_per_target integer,
  started_at          timestamp with time zone,
  finished_at         timestamp with time zone,
  target_id           text not null,
  target_type         text not null,
  attempt             integer not null,
  match               real,
  score               real,
  tokens_used         integer,
  code                text,
  code_length         integer,
  cost                real,
  duration_ms         integer,
  reasoning_effort    text,
  created_at          timestamp with time zone default now()
);

create unique index if not exists idx_runs_unique on public.runs (run_id, target_id, attempt);
create        index if not exists idx_runs_run_id on public.runs (run_id);
create        index if not exists idx_runs_model  on public.runs (model);

alter table public.runs enable row level security;
drop policy if exists "allow_all" on public.runs;
drop policy if exists "allow_select" on public.runs;
create policy "allow_select" on public.runs for select using (true);

-- ─── run_state ───────────────────────────────────────────────────────────────

create table if not exists public.run_state (
  run_id           text primary key,
  model            text not null,
  provider         text not null,
  prompt_version   text,
  reasoning_effort text,
  started_at       timestamp with time zone not null,
  finished_at      timestamp with time zone,
  status           text not null default 'running'
);

alter table public.run_state enable row level security;
drop policy if exists "allow_all" on public.run_state;
drop policy if exists "allow_select" on public.run_state;
create policy "allow_select" on public.run_state for select using (true);

-- ─── battle_targets ──────────────────────────────────────────────────────────

create table if not exists public.battle_targets (
  id            integer not null,
  name          text not null,
  image_url     text not null,
  colors        text[] not null default '{}'::text[],
  battle_number integer not null,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  constraint battle_targets_pkey primary key (id)
);

create index if not exists idx_battle_targets_id on public.battle_targets (id);

drop trigger if exists battle_targets_updated_at on public.battle_targets;
create trigger battle_targets_updated_at
  before update on public.battle_targets
  for each row execute function update_updated_at();

alter table public.battle_targets enable row level security;
drop policy if exists "allow_all" on public.battle_targets;
drop policy if exists "allow_select" on public.battle_targets;
create policy "allow_select" on public.battle_targets for select using (true);

-- ─── daily_targets ───────────────────────────────────────────────────────────

create table if not exists public.daily_targets (
  key        text not null,
  name       text not null,
  image_url  text not null,
  colors     text[] not null default '{}'::text[],
  date       date not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint daily_targets_pkey primary key (key)
);

create index if not exists idx_daily_targets_key  on public.daily_targets (key);
create index if not exists idx_daily_targets_date on public.daily_targets (date);

drop trigger if exists daily_targets_updated_at on public.daily_targets;
create trigger daily_targets_updated_at
  before update on public.daily_targets
  for each row execute function update_updated_at();

alter table public.daily_targets enable row level security;
drop policy if exists "allow_all" on public.daily_targets;
drop policy if exists "allow_select" on public.daily_targets;
create policy "allow_select" on public.daily_targets for select using (true);
