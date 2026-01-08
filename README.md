# bowling-tracker

A simple starting point for a bowling tracker webapp. Users upload a scoreboard
image and a player name, we queue a background job, and later store frames and
shots in Postgres.

## What is included

- Next.js App Router UI with a minimal upload flow
- API route that uploads the image to Supabase Storage and queues a job row
- Starter SQL schema for games, frames, shots, and analysis jobs

## Local dev

1. Install dependencies: `npm install`
2. Create a Supabase project and run `db/schema.sql`
3. Create a storage bucket named `scoreboards-temp` (or set `SUPABASE_STORAGE_BUCKET`)
4. Copy `.env.example` to `.env.local` and fill in the values
5. Run the dev server: `npm run dev`
6. Visit `http://localhost:3000`

## API

- `POST /api/submit`: accepts `playerName` and `image` (multipart form).
- `GET /api/status?jobId=...`: returns the job status from `analysis_jobs`.
- `GET /api/game?jobId=...`: fetches game details with frames + shots.
- `GET /api/games?limit=...`: lists recent games.
- `PATCH /api/game`: saves edited shots and total score.
- `POST /api/chat`: asks Gemini about your stats.

## Notes

- For now, `user_id` can be `NULL`. Set `DEV_USER_ID` if you want to associate
  uploads with a specific user UUID.

## Worker (Cloud Run + Gemini)

This worker claims a queued job, downloads the image from Supabase Storage,
calls Gemini, stores frames/shots, and deletes the image.

### 1) Update the database

Run the new function at the bottom of `db/schema.sql` in Supabase SQL Editor to
add `claim_next_job()`.

To enable SQL chat queries, also run the `execute_sql()` function from
`db/schema.sql`.

### 2) Deploy the worker to Cloud Run

From your Google Cloud shell:

```bash
gcloud run deploy bowling-tracker-worker \
  --source ./worker \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,SUPABASE_STORAGE_BUCKET=scoreboards-temp,GEMINI_API_KEY=...,GEMINI_MODEL=gemini-flash-latest,WORKER_AUTH_TOKEN=..."
```

If you set `WORKER_AUTH_TOKEN`, your scheduler must send it as `X-Worker-Token`.

### 3) Schedule it

Create a Cloud Scheduler job to hit your worker every minute:

```bash
gcloud scheduler jobs create http bowling-tracker-worker \
  --schedule="* * * * *" \
  --uri="https://YOUR_CLOUD_RUN_URL/run" \
  --http-method=POST \
  --headers="X-Worker-Token: YOUR_TOKEN" \
  --time-zone="Etc/UTC"
```

If you prefer auth via OIDC, remove `--allow-unauthenticated` and configure an
OIDC token for the scheduler instead of `X-Worker-Token`.

## Database

See `db/schema.sql` for the initial tables.

### Migrations

If you created tables before `played_at` changed to a timestamp, run this in
Supabase SQL Editor:

```sql
alter table games alter column played_at type timestamptz using played_at::timestamptz;
alter table games alter column played_at set default now();
```

If you do not have the `played_at` column yet:

```sql
alter table games add column if not exists played_at timestamptz default now();
```
