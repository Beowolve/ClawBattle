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

-- run_state was removed in the queue refactor — Supabase only stores done
-- attempts, and queue state lives in local SQLite on each runner process.
drop table if exists public.run_state cascade;

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

-- ─── Additional indexes ───────────────────────────────────────────────────────
-- Safe to run on an existing DB — all use IF NOT EXISTS.

create index if not exists idx_runs_target     on public.runs (target_id, target_type);
create index if not exists idx_runs_created_at on public.runs (created_at);
create index if not exists idx_runs_prompt     on public.runs (prompt_version);

drop view if exists public.leaderboard cascade;
drop view if exists public.leaderboard_by_version cascade;
drop view if exists public.target_difficulty cascade;
drop view if exists public.model_consistency cascade;
drop view if exists public.cost_efficiency cascade;
drop view if exists public.match_distribution cascade;
alter table public.runs drop column if exists reasoning_max_tokens;

-- ─── Leaderboard views ────────────────────────────────────────────────────────

-- leaderboard: one row per (model, reasoning_effort) — aggregates across ALL prompt versions.
-- prompt_versions[] column lets the UI populate its version filter dropdown.
create or replace view public.leaderboard with (security_invoker = true) as
with best_per_target as (
  -- Pick the single highest-scoring attempt per model+target combination.
  select distinct on (model, reasoning_effort, target_id, target_type)
    model, reasoning_effort, target_id, target_type, provider,
    score, match, duration_ms
  from public.runs
  order by model, reasoning_effort, target_id, target_type, score desc nulls last
),
model_costs as (
  select
    model,
    reasoning_effort,
    sum(cost)  filter (where cost           is not null) as total_cost,
    count(*)                                             as attempt_count,
    array_agg(distinct prompt_version order by prompt_version)
               filter (where prompt_version is not null) as prompt_versions
  from public.runs
  group by model, reasoning_effort
)
select
  b.model,
  b.reasoning_effort,
  max(b.provider)                                                    as provider,
  c.prompt_versions,
  count(*)                                                           as targets,
  avg(b.score)                                                       as avg_score,
  avg(b.match)                                                       as avg_match,
  avg(b.duration_ms)                                                 as avg_duration_ms,
  count(*) filter (where b.match >= 100)                             as perfect_count,
  case when count(*) > 0
    then count(*) filter (where b.match >= 100)::real / count(*)
    else null end                                                    as perfect_rate,
  c.total_cost,
  case when c.attempt_count > 0
    then c.total_cost / c.attempt_count
    else null end                                                    as avg_cost,
  c.attempt_count
from best_per_target b
join model_costs c
  on  b.model            = c.model
  and b.reasoning_effort is not distinct from c.reasoning_effort
group by b.model, b.reasoning_effort, c.prompt_versions, c.total_cost, c.attempt_count;

grant select on public.leaderboard to anon, authenticated;

-- leaderboard_by_version: same but one row per (model, reasoning_effort, prompt_version).
-- Used when the UI filters to a specific prompt version.
create or replace view public.leaderboard_by_version with (security_invoker = true) as
with best_per_target as (
  select distinct on (model, reasoning_effort, target_id, target_type, prompt_version)
    model, reasoning_effort, target_id, target_type, prompt_version, provider,
    score, match, duration_ms
  from public.runs
  order by model, reasoning_effort, target_id, target_type, prompt_version, score desc nulls last
),
model_version_costs as (
  select
    model,
    reasoning_effort,
    prompt_version,
    sum(cost) filter (where cost is not null) as total_cost,
    count(*)                                  as attempt_count
  from public.runs
  group by model, reasoning_effort, prompt_version
)
select
  b.model,
  b.reasoning_effort,
  b.prompt_version,
  max(b.provider)                                                    as provider,
  count(*)                                                           as targets,
  avg(b.score)                                                       as avg_score,
  avg(b.match)                                                       as avg_match,
  avg(b.duration_ms)                                                 as avg_duration_ms,
  count(*) filter (where b.match >= 100)                             as perfect_count,
  case when count(*) > 0
    then count(*) filter (where b.match >= 100)::real / count(*)
    else null end                                                    as perfect_rate,
  c.total_cost,
  case when c.attempt_count > 0
    then c.total_cost / c.attempt_count
    else null end                                                    as avg_cost,
  c.attempt_count
from best_per_target b
join model_version_costs c
  on  b.model            = c.model
  and b.reasoning_effort is not distinct from c.reasoning_effort
  and b.prompt_version   is not distinct from c.prompt_version
group by b.model, b.reasoning_effort, b.prompt_version, c.total_cost, c.attempt_count;

grant select on public.leaderboard_by_version to anon, authenticated;

-- ─── Insights views ───────────────────────────────────────────────────────────

-- target_difficulty: average best match per target per prompt_version.
-- Joins battle_targets / daily_targets for name + image_url so the UI
-- doesn't need a separate targets fetch.
create or replace view public.target_difficulty with (security_invoker = true) as
with best_per_model as (
  select distinct on (model, target_id, target_type, prompt_version)
    model, target_id, target_type, prompt_version, match
  from public.runs
  order by model, target_id, target_type, prompt_version, match desc nulls last
)
select
  d.target_id,
  d.target_type,
  d.prompt_version,
  avg(d.match)                                                       as avg_match,
  coalesce(bt.name, dt.name, d.target_id)                           as name,
  coalesce(bt.image_url, dt.image_url)                               as image_url
from best_per_model d
left join public.battle_targets bt
  on d.target_type = 'battle' and round(d.target_id::numeric)::integer = bt.id
left join public.daily_targets dt
  on d.target_type = 'daily'  and d.target_id          = dt.key
group by d.target_id, d.target_type, d.prompt_version,
         bt.name, bt.image_url, dt.name, dt.image_url;

grant select on public.target_difficulty to anon, authenticated;

-- model_consistency: std deviation + avg match per model reasoning config per prompt_version.
-- stddev_pop is native PostgreSQL — no client-side computation needed.
create or replace view public.model_consistency with (security_invoker = true) as
select
  model,
  reasoning_effort,
  prompt_version,
  avg(match)        as avg_match,
  stddev_pop(match) as std_dev,
  count(*)          as n
from public.runs
where match is not null
group by model, reasoning_effort, prompt_version;

grant select on public.model_consistency to anon, authenticated;

-- cost_efficiency: best score per target averaged per model reasoning config per prompt_version,
-- alongside average cost per attempt.
create or replace view public.cost_efficiency with (security_invoker = true) as
with best_per_target as (
  select distinct on (model, reasoning_effort, target_id, target_type, prompt_version)
    model, reasoning_effort, target_id, target_type, prompt_version, score, cost
  from public.runs
  order by model, reasoning_effort, target_id, target_type, prompt_version, score desc nulls last
)
select
  model,
  reasoning_effort,
  prompt_version,
  avg(score)                              as avg_score,
  avg(cost) filter (where cost is not null) as avg_cost
from best_per_target
group by model, reasoning_effort, prompt_version;

grant select on public.cost_efficiency to anon, authenticated;

-- match_distribution: attempt counts bucketed by match% per model per prompt_version.
-- Bucket labels use an en-dash (–) to match the existing JS range strings.
create or replace view public.match_distribution with (security_invoker = true) as
select
  model,
  prompt_version,
  case
    when match >= 100 then '100'
    when match >=  90 then '90–99'
    when match >=  80 then '80–89'
    when match >=  70 then '70–79'
    when match >=  60 then '60–69'
    when match >=  50 then '50–59'
    when match >=  40 then '40–49'
    when match >=  30 then '30–39'
    when match >=  20 then '20–29'
    when match >=  10 then '10–19'
    else                   '0–9'
  end as bucket,
  count(*) as count
from public.runs
where match is not null
group by model, prompt_version, bucket;

grant select on public.match_distribution to anon, authenticated;
