create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null unique references bowling_sessions(id) on delete cascade,
  status text not null default 'active',
  selected_player_keys jsonb not null default '[]'::jsonb,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_sessions_status_check check (status in ('active', 'ended'))
);

create unique index if not exists idx_live_sessions_one_active_per_user
  on live_sessions(user_id)
  where status = 'active';

create table if not exists live_session_games (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references live_sessions(id) on delete cascade,
  capture_order integer not null,
  storage_key text not null,
  captured_at_hint timestamptz,
  captured_at timestamptz,
  status text not null default 'queued',
  extraction jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_session_games_status_check check (status in ('queued', 'processing', 'ready', 'error')),
  constraint live_session_games_order_unique unique (live_session_id, capture_order)
);

create index if not exists idx_live_session_games_live_session_id
  on live_session_games(live_session_id, capture_order);

alter table analysis_jobs
  add column if not exists live_session_id uuid references live_sessions(id) on delete set null;

alter table analysis_jobs
  add column if not exists live_session_game_id uuid references live_session_games(id) on delete set null;

alter table analysis_jobs
  add column if not exists job_type text not null default 'standard';

update analysis_jobs
set job_type = 'standard'
where job_type is distinct from 'live_session';

alter table analysis_jobs
  drop constraint if exists analysis_jobs_job_type_check;

alter table analysis_jobs
  add constraint analysis_jobs_job_type_check
  check (job_type in ('standard', 'live_session'));

drop function if exists claim_next_job();

create or replace function claim_next_job()
returns table (
  id uuid,
  storage_key text,
  player_name text,
  user_id uuid,
  timezone_offset_minutes integer,
  session_id uuid,
  captured_at_hint timestamptz,
  job_type text,
  live_session_id uuid,
  live_session_game_id uuid
)
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
    analysis_jobs.session_id,
    analysis_jobs.captured_at_hint,
    analysis_jobs.job_type,
    analysis_jobs.live_session_id,
    analysis_jobs.live_session_game_id;
$$;

alter table live_sessions enable row level security;

drop policy if exists "live_sessions_select_own" on live_sessions;
create policy "live_sessions_select_own"
  on live_sessions
  for select
  using (auth.uid() = user_id);

drop policy if exists "live_sessions_insert_own" on live_sessions;
create policy "live_sessions_insert_own"
  on live_sessions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "live_sessions_update_own" on live_sessions;
create policy "live_sessions_update_own"
  on live_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "live_sessions_delete_own" on live_sessions;
create policy "live_sessions_delete_own"
  on live_sessions
  for delete
  using (auth.uid() = user_id);

alter table live_session_games enable row level security;

drop policy if exists "live_session_games_select_own" on live_session_games;
create policy "live_session_games_select_own"
  on live_session_games
  for select
  using (
    exists (
      select 1
      from live_sessions
      where live_sessions.id = live_session_games.live_session_id
        and live_sessions.user_id = auth.uid()
    )
  );

drop policy if exists "live_session_games_insert_own" on live_session_games;
create policy "live_session_games_insert_own"
  on live_session_games
  for insert
  with check (
    exists (
      select 1
      from live_sessions
      where live_sessions.id = live_session_games.live_session_id
        and live_sessions.user_id = auth.uid()
    )
  );

drop policy if exists "live_session_games_update_own" on live_session_games;
create policy "live_session_games_update_own"
  on live_session_games
  for update
  using (
    exists (
      select 1
      from live_sessions
      where live_sessions.id = live_session_games.live_session_id
        and live_sessions.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from live_sessions
      where live_sessions.id = live_session_games.live_session_id
        and live_sessions.user_id = auth.uid()
    )
  );

drop policy if exists "live_session_games_delete_own" on live_session_games;
create policy "live_session_games_delete_own"
  on live_session_games
  for delete
  using (
    exists (
      select 1
      from live_sessions
      where live_sessions.id = live_session_games.live_session_id
        and live_sessions.user_id = auth.uid()
    )
  );
