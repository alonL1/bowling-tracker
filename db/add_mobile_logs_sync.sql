alter table bowling_sessions
  add column if not exists updated_at timestamptz not null default now();

alter table games
  add column if not exists updated_at timestamptz not null default now();

alter table frames
  add column if not exists updated_at timestamptz not null default now();

alter table shots
  add column if not exists updated_at timestamptz not null default now();

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
