create table public.runs (
  id bigserial primary key,
  run_id text not null,
  benchmark_version text not null,
  model text not null,
  provider text not null,
  prompt_version text,
  temperature real,
  attempts_per_target integer,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  target_id text not null,
  target_type text not null,
  attempt integer not null,
  match real,
  score real,
  tokens_used integer,
  code text,
  code_length integer,
  cost real,
  duration_ms integer,
  reasoning_effort text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_runs_run_id on public.runs (run_id);
create index if not exists idx_runs_model   on public.runs (model);


create table public.battle_targets (
                                       id integer not null,
                                       name text not null,
                                       image_url text not null,
                                       colors text[] not null default '{}'::text[],
                                       battle_number integer not null,
                                       created_at timestamp with time zone not null default now(),
                                       updated_at timestamp with time zone not null default now(),
                                       constraint battle_targets_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_battle_targets_id on public.battle_targets using btree (id) TABLESPACE pg_default;

create trigger battle_targets_updated_at BEFORE
    update on battle_targets for EACH row
    execute FUNCTION update_updated_at ();


create table public.daily_targets (
                                      key text not null,
                                      name text not null,
                                      image_url text not null,
                                      colors text[] not null default '{}'::text[],
                                      date date not null,
                                      created_at timestamp with time zone not null default now(),
                                      updated_at timestamp with time zone not null default now(),
                                      constraint daily_targets_pkey primary key (key)
) TABLESPACE pg_default;

create index IF not exists idx_daily_targets_date on public.daily_targets using btree (date) TABLESPACE pg_default;

create index IF not exists idx_daily_targets_key on public.daily_targets using btree (key) TABLESPACE pg_default;

create trigger daily_targets_updated_at BEFORE
    update on daily_targets for EACH row
    execute FUNCTION update_updated_at ();