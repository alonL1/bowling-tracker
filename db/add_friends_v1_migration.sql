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
