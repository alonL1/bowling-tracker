# bowling-tracker

Bowling Tracker is a bowling stats app with:

- a Next.js web app
- an Expo / React Native mobile app in `mobile/`
- a shared Supabase backend
- a Cloud Run worker that processes uploaded scoreboard images with Gemini

Users can upload scoreboard images, review and edit games, chat about their stats, manage friends and leaderboards, and use the same account across web and mobile.

## Repo layout

- `app/`: Next.js App Router UI and API routes
- `mobile/`: Expo app for iPhone and Android
- `db/`: schema and SQL migrations
- `worker/`: Cloud Run image-processing worker

## What is included

- Web app built with Next.js App Router
- Mobile app built with Expo Router and React Native
- Supabase Auth, Postgres, and Storage integration
- Direct-to-Storage scoreboard uploads
- Background image processing via Cloud Run + Gemini
- Game/session editing and chat APIs
- Friends invites and leaderboards

## Tech stack

- Web: Next.js, React, TypeScript
- Mobile: Expo, React Native, Expo Router, TanStack Query
- Backend: Next.js API routes + Supabase
- Worker: Node.js on Cloud Run
- AI/image processing: Gemini

## Local dev

### Prerequisites

- Node.js
- npm
- a Supabase project
- a Google Cloud project if you want to run the worker in production

### 1) Configure the web app

Copy the root env file and fill it in:

```bash
cp .env.example .env.local
```

Important root env values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`
- `GEMINI_API_KEY`
- `WORKER_URL`

Optional:

- `API_CORS_ALLOWED_ORIGINS`
  - useful when the Expo web app on `localhost:8081` needs to call the Next API on `localhost:3000`

### 2) Configure the mobile app

For the native dev-build workflow, populate `mobile/.env.local` from EAS:

```bash
cd mobile
npm run env:pull:preview
```

or:

```bash
npm run env:pull:production
```

If you need a manual override instead, copy `mobile/.env.example` to `mobile/.env.local` and fill in:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`

`APP_VARIANT` is non-secret and is set automatically by the dev-client scripts / EAS build profile.

### 3) Set up Supabase

1. Run `db/schema.sql`
2. Run any needed migration files in `db/`
3. Create a Storage bucket named `scoreboards-temp` or set `SUPABASE_STORAGE_BUCKET`
4. Enable Email auth in Supabase Auth

Recommended Storage insert policy:

```sql
create policy "users upload into own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'scoreboards-temp'
  and split_part(name, '/', 1) = auth.uid()::text
);
```

## Running the apps

### Web app

From the repo root:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

### Mobile app

From `mobile/`:

```bash
npm install
npx eas login
npx eas init
npm run env:pull:preview
npm run build:android:development
npm run start:dev-client
```

Then install the generated APK once and open the `Bowling Tracker Dev` app on Android.

Note:

- Expo web is mainly a dev surface
- Expo Go is no longer the primary native runtime for this repo
- the native development workflow is the installed Expo dev client
- iPhone config is prepared, but Android is the first supported device-build path

## Architecture

### Web app

The Next.js app handles:

- UI
- auth-aware pages
- API routes
- direct upload orchestration
- sessions, games, friends, and chat flows

### Mobile app

The Expo app:

- uses Supabase on-device for auth/session persistence
- uploads scoreboard files directly to Supabase Storage
- calls the Next.js API routes for business logic
- mirrors the main web features in a native app shell

### Supabase

Supabase provides:

- Auth
- Postgres
- Storage

### Worker

The worker:

- claims queued jobs
- downloads uploaded scoreboards from Storage
- calls Gemini
- writes frames/shots/results back to Postgres

## Main API routes

- `POST /api/submit`
  - accepts upload manifests for direct-to-Storage scoreboard uploads
- `GET /api/status?jobId=...`
  - returns processing status for an upload job
- `GET /api/game?gameId=...` or `GET /api/game?jobId=...`
  - fetches a game with frames and shots
- `GET /api/games`
  - lists games used by the Sessions flow
- `PATCH /api/game`
  - saves edited shots and metadata
- `PATCH /api/game/session`
  - moves a game to another session
- `POST /api/chat`
  - asks Gemini about a user’s bowling stats
- `POST /api/friends/invite`
  - returns the user’s persistent invite link
- `GET /api/friends/leaderboard`
  - returns the leaderboard for the user + accepted friends
- `POST /api/auth/claim-guest`
  - moves guest-session data into a real account

## Worker deployment

This worker claims a queued job, downloads the image from Supabase Storage, calls Gemini, stores frames/shots, and deletes the image.

### 1) Update the database

Run the new function at the bottom of `db/schema.sql` in Supabase SQL Editor to add `claim_next_job()`.

To enable SQL chat queries, also run the `execute_sql()` function from `db/schema.sql`.

### 2) Deploy the worker to Cloud Run

From your Google Cloud shell:

```bash
gcloud run deploy bowling-tracker-worker \
  --source ./worker \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances=3 \
  --set-env-vars "SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,SUPABASE_STORAGE_BUCKET=scoreboards-temp,GEMINI_API_KEY=...,GEMINI_MODEL=gemini-flash-latest,WORKER_AUTH_TOKEN=..."
```

`WORKER_AUTH_TOKEN` is required by the worker. Your scheduler must send it as `X-Worker-Token`.

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

If you prefer auth via OIDC, remove `--allow-unauthenticated` and configure an OIDC token for the scheduler instead of `X-Worker-Token`.

## Cost and abuse guardrails

Enforced in `POST /api/submit`:

- max `100` images per request
- max `8 MB` per image
- max `500 MB` total bytes per request
- max `500` images per rolling 24h per user
- max `1 GB` uploaded bytes per rolling 24h per user
- per-user and per-IP rate limits for submit requests
- ownership checks on storage keys (`<userId>/...` prefix + storage owner validation)

Worker bounded by:

- `MAX_JOBS_PER_RUN` default `6`
- `MAX_RUN_DURATION_MS` default `240000`
- Cloud Run `--max-instances=3`

Recommended billing budget alert:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="bowling-tracker-budget" \
  --budget-amount=25USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

## Database

See `db/schema.sql` for the initial tables.

### Migrations

If you created tables before `played_at` changed to a timestamp, run this in Supabase SQL Editor:

```sql
alter table games alter column played_at type timestamptz using played_at::timestamptz;
alter table games alter column played_at set default now();
```

If you do not have the `played_at` column yet:

```sql
alter table games add column if not exists played_at timestamptz default now();
```

## Notes

- API routes authenticate from Supabase bearer token
- `DEV_USER_ID` still exists as a local debugging fallback for the web app
- the mobile app and web app share the same backend and data model
