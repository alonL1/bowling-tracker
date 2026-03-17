# bowling-tracker

Bowling Tracker now uses:

- an Expo / React Native frontend in `mobile/` for iPhone, Android, and web
- a Next.js app at the repo root for `/api` routes and server-side backend logic
- Supabase for auth, Postgres, and storage
- a Cloud Run worker for scoreboard processing

The old separate Next web UI has been retired. Browser users now run the same Expo frontend route tree as mobile.

## Repo layout

- `mobile/`: canonical product frontend for native and web
- `app/api/`: Next.js API routes and backend helpers
- `db/`: schema and SQL migrations
- `worker/`: Cloud Run image-processing worker
- `scripts/sync-expo-web.mjs`: exports the Expo web app into the root static assets for Next/Vercel hosting

## Environment

Root `.env.local` should include:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_API_BASE_URL=
GEMINI_API_KEY=
WORKER_AUTH_TOKEN=
GEMINI_MODEL=
DEV_USER_ID=
CHAT_DEBUG=
CHAT_MODE=
CHAT_SHOW_METHOD=
CHAT_SHOW_TIMING=
WORKER_URL=
CHAT_THINKING_MODE=
WORKER_THINKING_MODE=
API_CORS_ALLOWED_ORIGINS=
```

Notes:

- `EXPO_PUBLIC_*` values are now the browser/mobile frontend source of truth.
- For the deployed web app, `EXPO_PUBLIC_API_BASE_URL` can be omitted if you want browser requests to use same-origin `/api` via runtime origin detection.
- Native dev-client flows in `mobile/` can still use `mobile/.env.local` / EAS env pulls.

## Local development

### Production-like browser app through Next

From the repo root:

```bash
npm install
npm run dev
```

This will:

1. export the Expo web frontend from `mobile/`
2. copy it into the root static assets
3. start `next dev`

Open:

```text
http://localhost:3000
```

### Faster frontend-only Expo web iteration

From the repo root:

```bash
npm run dev:expo-web
```

This uses Expo’s web dev server instead of the production-like Next-hosted path.

### Native mobile development

From `mobile/`:

```bash
npm install
npx eas login
npx eas init
npm run env:pull:preview
npm run build:android:development
npm run start:dev-client
```

## Production build

From the repo root:

```bash
npm run build
```

The root build now:

1. exports the Expo web frontend
2. syncs it into the root static assets
3. builds the Next backend/API app

In production, one Vercel deployment serves:

- Expo web for browser routes like `/sessions`, `/chat`, `/record/live`, `/games/[gameId]`
- Next API routes under `/api/**`

## Architecture

### Frontend

The frontend source of truth is `mobile/src/`.

That codebase provides:

- Expo Router routes
- shared UI/components
- Supabase auth/session handling
- browser/mobile calls into the Next API backend

### Backend

The root Next app now exists for:

- `/api/**`
- auth-aware backend logic
- business rules and orchestration
- hosting the exported Expo web frontend in the same deployment

### Worker

The worker:

- claims queued jobs
- downloads uploaded scoreboards from Storage
- calls Gemini
- writes frames/shots/results back to Postgres

## Main API routes

- `POST /api/submit`
- `GET /api/status?jobId=...`
- `GET /api/game?gameId=...`
- `GET /api/games`
- `PATCH /api/game`
- `PATCH /api/game/session`
- `POST /api/chat`
- `POST /api/friends/invite`
- `GET /api/friends/leaderboard`
- `POST /api/auth/claim-guest`
- `GET/PATCH /api/live-session`
- `POST /api/live-session/capture`
- `PATCH/DELETE /api/live-session/game`
- `POST /api/live-session/end`

## Supabase setup

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

## Worker deployment

This worker claims a queued job, downloads the image from Supabase Storage, calls Gemini, stores frames/shots, and deletes the image.

Run the current DB schema and migrations before redeploying the worker if backend structures changed.
