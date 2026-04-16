delete from analysis_jobs
where job_type = 'standard';

alter table analysis_jobs
  alter column job_type drop default;

alter table analysis_jobs
  drop constraint if exists analysis_jobs_job_type_check;

alter table analysis_jobs
  add constraint analysis_jobs_job_type_check
  check (job_type in ('live_session', 'recording_draft'));
