create extension if not exists "pgcrypto";

create table if not exists bowling_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text,
  description text,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  session_id uuid references bowling_sessions(id) on delete set null,
  game_name text,
  player_name text not null,
  total_score integer,
  captured_at timestamptz,
  played_at timestamptz not null default now(),
  status text not null default 'queued',
  raw_extraction jsonb,
  created_at timestamptz not null default now()
);

create table if not exists frames (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  frame_number integer not null,
  is_strike boolean not null default false,
  is_spare boolean not null default false,
  frame_score integer
);

create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  frame_id uuid not null references frames(id) on delete cascade,
  shot_number integer not null,
  pins integer
);

create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete set null,
  session_id uuid references bowling_sessions(id) on delete set null,
  user_id uuid,
  player_name text not null,
  storage_key text not null,
  timezone_offset_minutes integer,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_questions (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique,
  last_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function claim_next_job()
returns table (id uuid, storage_key text, player_name text, user_id uuid, timezone_offset_minutes integer, session_id uuid)
language sql
as $$
  with next_job as (
    select id
    from analysis_jobs
    where status = 'queued'
    order by created_at
    limit 1
    for update skip locked
  )
  update analysis_jobs
  set status = 'processing',
      attempts = attempts + 1,
      updated_at = now()
  where id in (select id from next_job)
  returning analysis_jobs.id,
    analysis_jobs.storage_key,
    analysis_jobs.player_name,
    analysis_jobs.user_id,
    analysis_jobs.timezone_offset_minutes,
    analysis_jobs.session_id;
$$;

create or replace function execute_sql(query text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  execute format('select jsonb_agg(t) from (%s) t', query) into result;
  return coalesce(result, '[]'::jsonb);
end;
$$;
