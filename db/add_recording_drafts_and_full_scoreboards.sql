alter table games
  add column if not exists scoreboard_extraction jsonb;

alter table games
  add column if not exists selected_self_player_key text;

alter table games
  add column if not exists selected_self_player_name text;

update games
set scoreboard_extraction = case
  when raw_extraction is null then scoreboard_extraction
  when jsonb_typeof(raw_extraction -> 'players') = 'array' then raw_extraction
  when raw_extraction ? 'playerName' then jsonb_build_object(
    'players',
    jsonb_build_array(
      jsonb_build_object(
        'playerName', coalesce(nullif(trim(raw_extraction ->> 'playerName'), ''), player_name),
        'totalScore', raw_extraction -> 'totalScore',
        'frames', coalesce(raw_extraction -> 'frames', '[]'::jsonb)
      )
    )
  )
  else scoreboard_extraction
end
where scoreboard_extraction is null;

update games
set selected_self_player_name = coalesce(selected_self_player_name, player_name),
    selected_self_player_key = coalesce(
      selected_self_player_key,
      regexp_replace(lower(trim(player_name)), '\s+', ' ', 'g')
    )
where player_name is not null;

create table if not exists recording_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mode text not null,
  status text not null default 'active',
  selected_player_keys jsonb not null default '[]'::jsonb,
  target_session_id uuid references bowling_sessions(id) on delete set null,
  name text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_drafts_mode_check
    check (mode in ('upload_session', 'add_multiple_sessions', 'add_existing_session')),
  constraint recording_drafts_status_check
    check (status in ('active', 'finalized', 'discarded'))
);

create unique index if not exists idx_recording_drafts_one_active_per_user_mode
  on recording_drafts(user_id, mode)
  where status = 'active';

create table if not exists recording_draft_groups (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references recording_drafts(id) on delete cascade,
  display_order integer not null default 0,
  name text,
  description text,
  anchor_captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recording_draft_groups_draft_id
  on recording_draft_groups(draft_id, display_order);

create table if not exists recording_draft_games (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references recording_drafts(id) on delete cascade,
  group_id uuid references recording_draft_groups(id) on delete set null,
  capture_order integer not null,
  storage_key text not null,
  captured_at_hint timestamptz,
  captured_at timestamptz,
  sort_at timestamptz,
  status text not null default 'queued',
  extraction jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_draft_games_status_check
    check (status in ('queued', 'processing', 'ready', 'error')),
  constraint recording_draft_games_order_unique unique (draft_id, capture_order)
);

create index if not exists idx_recording_draft_games_draft_id
  on recording_draft_games(draft_id, capture_order);

create index if not exists idx_recording_draft_games_group_id
  on recording_draft_games(group_id, sort_at, capture_order);

alter table analysis_jobs
  add column if not exists recording_draft_id uuid references recording_drafts(id) on delete set null;

alter table analysis_jobs
  add column if not exists recording_draft_game_id uuid references recording_draft_games(id) on delete set null;

alter table analysis_jobs
  drop constraint if exists analysis_jobs_job_type_check;

alter table analysis_jobs
  add constraint analysis_jobs_job_type_check
  check (job_type in ('standard', 'live_session', 'recording_draft'));

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
  live_session_game_id uuid,
  recording_draft_id uuid,
  recording_draft_game_id uuid
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
    analysis_jobs.live_session_game_id,
    analysis_jobs.recording_draft_id,
    analysis_jobs.recording_draft_game_id;
$$;

alter table recording_drafts enable row level security;

drop policy if exists "recording_drafts_select_own" on recording_drafts;
create policy "recording_drafts_select_own"
  on recording_drafts
  for select
  using (auth.uid() = user_id);

drop policy if exists "recording_drafts_insert_own" on recording_drafts;
create policy "recording_drafts_insert_own"
  on recording_drafts
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "recording_drafts_update_own" on recording_drafts;
create policy "recording_drafts_update_own"
  on recording_drafts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "recording_drafts_delete_own" on recording_drafts;
create policy "recording_drafts_delete_own"
  on recording_drafts
  for delete
  using (auth.uid() = user_id);

alter table recording_draft_groups enable row level security;

drop policy if exists "recording_draft_groups_select_own" on recording_draft_groups;
create policy "recording_draft_groups_select_own"
  on recording_draft_groups
  for select
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_groups.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_groups_insert_own" on recording_draft_groups;
create policy "recording_draft_groups_insert_own"
  on recording_draft_groups
  for insert
  with check (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_groups.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_groups_update_own" on recording_draft_groups;
create policy "recording_draft_groups_update_own"
  on recording_draft_groups
  for update
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_groups.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_groups.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_groups_delete_own" on recording_draft_groups;
create policy "recording_draft_groups_delete_own"
  on recording_draft_groups
  for delete
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_groups.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

alter table recording_draft_games enable row level security;

drop policy if exists "recording_draft_games_select_own" on recording_draft_games;
create policy "recording_draft_games_select_own"
  on recording_draft_games
  for select
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_games.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_games_insert_own" on recording_draft_games;
create policy "recording_draft_games_insert_own"
  on recording_draft_games
  for insert
  with check (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_games.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_games_update_own" on recording_draft_games;
create policy "recording_draft_games_update_own"
  on recording_draft_games
  for update
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_games.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_games.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );

drop policy if exists "recording_draft_games_delete_own" on recording_draft_games;
create policy "recording_draft_games_delete_own"
  on recording_draft_games
  for delete
  using (
    exists (
      select 1
      from recording_drafts
      where recording_drafts.id = recording_draft_games.draft_id
        and recording_drafts.user_id = auth.uid()
    )
  );
