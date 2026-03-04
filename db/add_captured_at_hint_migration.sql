alter table analysis_jobs
add column if not exists captured_at_hint timestamptz;

create or replace function claim_next_job()
returns table (
  id uuid,
  storage_key text,
  player_name text,
  user_id uuid,
  timezone_offset_minutes integer,
  session_id uuid,
  captured_at_hint timestamptz
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
    analysis_jobs.captured_at_hint;
$$;
