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
  file_size_bytes bigint,
  timezone_offset_minutes integer,
  captured_at_hint timestamptz,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create or replace function claim_next_job()
returns table (id uuid, storage_key text, player_name text, user_id uuid, timezone_offset_minutes integer, session_id uuid, captured_at_hint timestamptz)
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
    analysis_jobs.captured_at_hint;
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
