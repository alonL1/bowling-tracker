create extension if not exists "pgcrypto";

create table if not exists bowling_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  client_finalize_operation_id text,
  name text,
  description text,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  session_id uuid references bowling_sessions(id) on delete set null,
  client_finalize_operation_id text,
  game_name text,
  player_name text not null,
  total_score integer,
  captured_at timestamptz,
  played_at timestamptz not null default now(),
  status text not null default 'queued',
  raw_extraction jsonb,
  scoreboard_extraction jsonb,
  selected_self_player_key text,
  selected_self_player_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists frames (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  frame_number integer not null,
  is_strike boolean not null default false,
  is_spare boolean not null default false,
  frame_score integer,
  updated_at timestamptz not null default now()
);

create table if not exists shots (
  id uuid primary key default gen_random_uuid(),
  frame_id uuid not null references frames(id) on delete cascade,
  shot_number integer not null,
  pins integer,
  updated_at timestamptz not null default now()
);

create index if not exists idx_games_user_id
  on games(user_id);

create index if not exists idx_games_user_session_order
  on games(user_id, session_id, played_at, created_at, id);

create index if not exists idx_frames_game_id
  on frames(game_id);

create index if not exists idx_shots_frame_id_shot_number
  on shots(frame_id, shot_number);

create table if not exists mobile_sync_tombstones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  deleted_at timestamptz not null default now(),
  constraint mobile_sync_tombstones_entity_type_check
    check (entity_type in ('session', 'game'))
);

create index if not exists idx_mobile_sync_tombstones_user_deleted_at
  on mobile_sync_tombstones(user_id, deleted_at desc);

create unique index if not exists idx_mobile_sync_tombstones_unique_entity
  on mobile_sync_tombstones(user_id, entity_type, entity_id);

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
  client_capture_id text,
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

create unique index if not exists idx_live_session_games_client_capture_id
  on live_session_games(client_capture_id)
  where client_capture_id is not null;

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
  client_group_id text,
  display_order integer not null default 0,
  name text,
  description text,
  anchor_captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recording_draft_groups_draft_id
  on recording_draft_groups(draft_id, display_order);

create unique index if not exists idx_recording_draft_groups_client_group_id
  on recording_draft_groups(draft_id, client_group_id)
  where client_group_id is not null;

create table if not exists recording_draft_games (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references recording_drafts(id) on delete cascade,
  group_id uuid references recording_draft_groups(id) on delete set null,
  client_capture_id text,
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
  constraint recording_draft_games_status_check check (status in ('queued', 'processing', 'ready', 'error')),
  constraint recording_draft_games_order_unique unique (draft_id, capture_order)
);

create index if not exists idx_recording_draft_games_draft_id
  on recording_draft_games(draft_id, capture_order);

create index if not exists idx_recording_draft_games_group_id
  on recording_draft_games(group_id, sort_at, capture_order);

create unique index if not exists idx_recording_draft_games_client_capture_id
  on recording_draft_games(client_capture_id)
  where client_capture_id is not null;

create index if not exists idx_bowling_sessions_client_finalize_operation
  on bowling_sessions(user_id, client_finalize_operation_id)
  where client_finalize_operation_id is not null;

create index if not exists idx_games_client_finalize_operation
  on games(user_id, client_finalize_operation_id)
  where client_finalize_operation_id is not null;

create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete set null,
  session_id uuid references bowling_sessions(id) on delete set null,
  live_session_id uuid references live_sessions(id) on delete set null,
  live_session_game_id uuid references live_session_games(id) on delete set null,
  recording_draft_id uuid references recording_drafts(id) on delete set null,
  recording_draft_game_id uuid references recording_draft_games(id) on delete set null,
  user_id uuid,
  player_name text not null,
  storage_key text not null,
  file_size_bytes bigint,
  timezone_offset_minutes integer,
  captured_at_hint timestamptz,
  job_type text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_jobs_job_type_check check (job_type in ('live_session', 'recording_draft'))
);

create table if not exists mobile_sync_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope text not null,
  operation_key text not null,
  status text not null default 'pending',
  response jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_sync_operations_scope_check
    check (scope in ('live_session_end', 'recording_draft_finalize')),
  constraint mobile_sync_operations_status_check
    check (status in ('pending', 'completed', 'failed'))
);

create unique index if not exists idx_mobile_sync_operations_user_scope_key
  on mobile_sync_operations(user_id, scope, operation_key);

create table if not exists submit_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ip_hash text,
  image_count integer not null default 0,
  total_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_submit_request_logs_user_created_at
  on submit_request_logs(user_id, created_at desc);

create index if not exists idx_submit_request_logs_ip_created_at
  on submit_request_logs(ip_hash, created_at desc)
  where ip_hash is not null;

create table if not exists chat_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ip_hash text,
  question_chars integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_request_logs_user_created_at
  on chat_request_logs(user_id, created_at desc);

create index if not exists idx_chat_request_logs_ip_created_at
  on chat_request_logs(ip_hash, created_at desc)
  where ip_hash is not null;

create table if not exists chat_questions (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique,
  last_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  friend_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint friendships_user_friend_unique unique (user_id, friend_user_id),
  constraint friendships_no_self check (user_id <> friend_user_id)
);

create index if not exists idx_friendships_user_id
  on friendships(user_id);

create index if not exists idx_friendships_friend_user_id
  on friendships(friend_user_id);

create table if not exists friend_invite_links (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null unique,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_friend_invite_links_token
  on friend_invite_links(token);

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  username_normalized text,
  first_name text,
  last_name text,
  avatar_kind text not null default 'initials',
  avatar_preset_id text,
  avatar_storage_key text,
  avatar_updated_at timestamptz,
  avatar_onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format_check
    check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_username_normalized_check
    check (
      (username is null and username_normalized is null) or
      (username is not null and username_normalized = lower(username))
    ),
  constraint profiles_avatar_kind_check
    check (avatar_kind in ('initials', 'preset', 'uploaded')),
  constraint profiles_avatar_preset_id_check
    check (
      avatar_preset_id is null or
      avatar_preset_id in (
        'happy_pin',
        'thinking_pin',
        'idea_pin',
        'ball_blue',
        'ball_red',
        'ball_orange',
        'ball_purple',
        'ball_coconut',
        'sink',
        'leaf',
        'peanut_butter_jar',
        'beach_chair'
      )
    )
);

create unique index if not exists idx_profiles_username_normalized
  on profiles(username_normalized)
  where username_normalized is not null;

create index if not exists idx_profiles_avatar_storage_key
  on profiles(avatar_storage_key)
  where avatar_storage_key is not null;

create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row
execute function public.touch_profiles_updated_at();

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  next_first_name text := nullif(trim(coalesce(metadata->>'first_name', metadata->>'given_name', '')), '');
  next_last_name text := nullif(trim(coalesce(metadata->>'last_name', metadata->>'family_name', '')), '');
  raw_username text := nullif(trim(both from coalesce(metadata->>'username', metadata->>'preferred_username', '')), '');
  next_username text;
begin
  if raw_username is not null then
    next_username := lower(regexp_replace(raw_username, '^@+', ''));
    if next_username !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'Username must be 3-20 characters and use only lowercase letters, numbers, and underscores.';
    end if;
  end if;

  insert into public.profiles (
    user_id,
    username,
    username_normalized,
    first_name,
    last_name,
    avatar_kind
  )
  values (
    new.id,
    next_username,
    next_username,
    next_first_name,
    next_last_name,
    'initials'
  )
  on conflict (user_id) do update
    set username = coalesce(public.profiles.username, excluded.username),
        username_normalized = coalesce(public.profiles.username_normalized, excluded.username_normalized),
        first_name = coalesce(public.profiles.first_name, excluded.first_name),
        last_name = coalesce(public.profiles.last_name, excluded.last_name);

  return new;
end;
$$;

drop trigger if exists sync_profile_from_auth_user_trigger on auth.users;
create trigger sync_profile_from_auth_user_trigger
after insert or update of raw_user_meta_data on auth.users
for each row
execute function public.sync_profile_from_auth_user();

alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own"
  on profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own"
  on profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bowling_sessions_touch_updated_at on public.bowling_sessions;
create trigger bowling_sessions_touch_updated_at
before update on public.bowling_sessions
for each row
execute function public.touch_updated_at();

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
before update on public.games
for each row
execute function public.touch_updated_at();

drop trigger if exists frames_touch_updated_at on public.frames;
create trigger frames_touch_updated_at
before update on public.frames
for each row
execute function public.touch_updated_at();

drop trigger if exists shots_touch_updated_at on public.shots;
create trigger shots_touch_updated_at
before update on public.shots
for each row
execute function public.touch_updated_at();

create or replace function public.touch_game_from_frame()
returns trigger
language plpgsql
as $$
begin
  update public.games
  set updated_at = now()
  where id = coalesce(new.game_id, old.game_id);
  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists frames_touch_parent_game on public.frames;
create trigger frames_touch_parent_game
after insert or update or delete on public.frames
for each row
execute function public.touch_game_from_frame();

create or replace function public.touch_frame_and_game_from_shot()
returns trigger
language plpgsql
as $$
declare
  target_frame_id uuid;
  target_game_id uuid;
begin
  target_frame_id = coalesce(new.frame_id, old.frame_id);

  update public.frames
  set updated_at = now()
  where id = target_frame_id
  returning game_id into target_game_id;

  if target_game_id is not null then
    update public.games
    set updated_at = now()
    where id = target_game_id;
  end if;

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists shots_touch_parent_frame_and_game on public.shots;
create trigger shots_touch_parent_frame_and_game
after insert or update or delete on public.shots
for each row
execute function public.touch_frame_and_game_from_shot();

create or replace function public.record_mobile_sync_session_tombstone()
returns trigger
language plpgsql
as $$
begin
  insert into public.mobile_sync_tombstones (user_id, entity_type, entity_id, deleted_at)
  values (old.user_id, 'session', old.id, now())
  on conflict (user_id, entity_type, entity_id)
  do update set deleted_at = excluded.deleted_at;
  return old;
end;
$$;

drop trigger if exists bowling_sessions_record_mobile_sync_tombstone on public.bowling_sessions;
create trigger bowling_sessions_record_mobile_sync_tombstone
before delete on public.bowling_sessions
for each row
execute function public.record_mobile_sync_session_tombstone();

create or replace function public.record_mobile_sync_game_tombstone()
returns trigger
language plpgsql
as $$
begin
  insert into public.mobile_sync_tombstones (user_id, entity_type, entity_id, deleted_at)
  values (old.user_id, 'game', old.id, now())
  on conflict (user_id, entity_type, entity_id)
  do update set deleted_at = excluded.deleted_at;
  return old;
end;
$$;

drop trigger if exists games_record_mobile_sync_tombstone on public.games;
create trigger games_record_mobile_sync_tombstone
before delete on public.games
for each row
execute function public.record_mobile_sync_game_tombstone();

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

-- Row Level Security for bowling_sessions
alter table bowling_sessions enable row level security;

drop policy if exists "bowling_sessions_select_own" on bowling_sessions;
create policy "bowling_sessions_select_own"
  on bowling_sessions
  for select
  using (auth.uid() = user_id);

drop policy if exists "bowling_sessions_insert_own" on bowling_sessions;
create policy "bowling_sessions_insert_own"
  on bowling_sessions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "bowling_sessions_update_own" on bowling_sessions;
create policy "bowling_sessions_update_own"
  on bowling_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "bowling_sessions_delete_own" on bowling_sessions;
create policy "bowling_sessions_delete_own"
  on bowling_sessions
  for delete
  using (auth.uid() = user_id);

-- Row Level Security for live_sessions
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

-- Row Level Security for live_session_games
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

-- Row Level Security for recording_drafts
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

-- Row Level Security for recording_draft_groups
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

-- Row Level Security for recording_draft_games
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

-- Row Level Security for mobile_sync_operations
alter table mobile_sync_operations enable row level security;

drop policy if exists "mobile_sync_operations_select_own" on mobile_sync_operations;
create policy "mobile_sync_operations_select_own"
  on mobile_sync_operations
  for select
  using (auth.uid() = user_id);

drop policy if exists "mobile_sync_operations_insert_own" on mobile_sync_operations;
create policy "mobile_sync_operations_insert_own"
  on mobile_sync_operations
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "mobile_sync_operations_update_own" on mobile_sync_operations;
create policy "mobile_sync_operations_update_own"
  on mobile_sync_operations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "mobile_sync_operations_delete_own" on mobile_sync_operations;
create policy "mobile_sync_operations_delete_own"
  on mobile_sync_operations
  for delete
  using (auth.uid() = user_id);

-- Row Level Security for friendships
alter table friendships enable row level security;

drop policy if exists "friendships_select_own" on friendships;
create policy "friendships_select_own"
  on friendships
  for select
  using (auth.uid() = user_id);

drop policy if exists "friendships_insert_own" on friendships;
create policy "friendships_insert_own"
  on friendships
  for insert
  with check (auth.uid() = user_id and user_id <> friend_user_id);

drop policy if exists "friendships_delete_own" on friendships;
create policy "friendships_delete_own"
  on friendships
  for delete
  using (auth.uid() = user_id);

-- Row Level Security for friend_invite_links
alter table friend_invite_links enable row level security;

drop policy if exists "friend_invite_links_select_own" on friend_invite_links;
create policy "friend_invite_links_select_own"
  on friend_invite_links
  for select
  using (auth.uid() = inviter_user_id);

drop policy if exists "friend_invite_links_insert_own" on friend_invite_links;
create policy "friend_invite_links_insert_own"
  on friend_invite_links
  for insert
  with check (auth.uid() = inviter_user_id);

drop policy if exists "friend_invite_links_update_own" on friend_invite_links;
create policy "friend_invite_links_update_own"
  on friend_invite_links
  for update
  using (auth.uid() = inviter_user_id)
  with check (auth.uid() = inviter_user_id);

drop policy if exists "friend_invite_links_delete_own" on friend_invite_links;
create policy "friend_invite_links_delete_own"
  on friend_invite_links
  for delete
  using (auth.uid() = inviter_user_id);
