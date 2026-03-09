alter table analysis_jobs
add column if not exists file_size_bytes bigint;

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
