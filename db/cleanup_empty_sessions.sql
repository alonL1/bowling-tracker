-- One-time backfill: remove orphan bowling_sessions rows that have no games.
-- The bowling_sessions_record_mobile_sync_tombstone trigger will fire for each
-- delete, propagating the removal to mobile clients on next sync.

delete from public.bowling_sessions s
where not exists (
  select 1 from public.games g
  where g.session_id = s.id
);
