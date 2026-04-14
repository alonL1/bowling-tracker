create table if not exists chat_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ip_hash text,
  question_chars integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_request_logs_user_created_at
  on chat_request_logs(user_id, created_at desc);

create index if not exists idx_chat_request_logs_ip_created_at
  on chat_request_logs(ip_hash, created_at desc)
  where ip_hash is not null;
