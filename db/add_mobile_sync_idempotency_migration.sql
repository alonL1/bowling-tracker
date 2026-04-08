alter table bowling_sessions
  add column if not exists client_finalize_operation_id text;

create index if not exists idx_bowling_sessions_client_finalize_operation
  on bowling_sessions(user_id, client_finalize_operation_id)
  where client_finalize_operation_id is not null;

alter table games
  add column if not exists client_finalize_operation_id text;

create index if not exists idx_games_client_finalize_operation
  on games(user_id, client_finalize_operation_id)
  where client_finalize_operation_id is not null;

alter table live_session_games
  add column if not exists client_capture_id text;

create unique index if not exists idx_live_session_games_client_capture_id
  on live_session_games(client_capture_id)
  where client_capture_id is not null;

alter table recording_draft_groups
  add column if not exists client_group_id text;

create unique index if not exists idx_recording_draft_groups_client_group_id
  on recording_draft_groups(draft_id, client_group_id)
  where client_group_id is not null;

alter table recording_draft_games
  add column if not exists client_capture_id text;

create unique index if not exists idx_recording_draft_games_client_capture_id
  on recording_draft_games(client_capture_id)
  where client_capture_id is not null;

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
