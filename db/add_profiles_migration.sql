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
        'ball_purple'
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
