-- Adds the closed-set `tags` column to games, live_session_games, and
-- recording_draft_games. Tags are populated from the mobile UI; the friends
-- leaderboard's no-warmup metrics and the chatbot's include-warmup toggle
-- both read this column.

alter table public.games
  add column if not exists tags text[] not null default '{}'::text[];
alter table public.live_session_games
  add column if not exists tags text[] not null default '{}'::text[];
alter table public.recording_draft_games
  add column if not exists tags text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'games_tags_allowed'
  ) then
    alter table public.games
      add constraint games_tags_allowed
      check (tags <@ array['warmup','league','tournament']::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'live_session_games_tags_allowed'
  ) then
    alter table public.live_session_games
      add constraint live_session_games_tags_allowed
      check (tags <@ array['warmup','league','tournament']::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'recording_draft_games_tags_allowed'
  ) then
    alter table public.recording_draft_games
      add constraint recording_draft_games_tags_allowed
      check (tags <@ array['warmup','league','tournament']::text[]);
  end if;
end $$;

create index if not exists idx_games_tags_gin
  on public.games using gin (tags);
