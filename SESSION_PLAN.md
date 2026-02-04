# Bowling Session Grouping Plan (Step-By-Step)

Goal: add “bowling sessions” to group games together, show sessions in the UI, and name games by order within each session (Game 1, Game 2, … based on played_at). We will implement **one step at a time**, validate it works, then move to the next.

---

## Step 0 — UI-only mock (no DB changes yet)
**Purpose:** Prove the UI layout and grouping behavior before we change the database.

- Add temporary mock session data on the frontend only.
- Render session headers + grouped games.
- Apply per-session game naming (Game 1..n).
- Include “Sessionless games” group if session_id is null.

**Validation:**
- UI renders multiple sessions correctly.
- Game labels reset per session.
- Sessionless group renders as expected.

---

## Step 1 — Database schema for sessions
**Purpose:** Introduce a sessions table + link games to sessions.

### Schema changes
- Create `bowling_sessions` table:
  - `id` uuid primary key default gen_random_uuid()
  - `user_id` uuid
  - `name` text
  - `description` text
  - `created_at` timestamptz default now()
- Add `games.session_id` uuid references bowling_sessions(id) on delete set null.

### Backfill
- Existing games keep `session_id = null` (will appear in “Sessionless games”).

**Validation:**
- Query games and confirm session_id exists.
- Schema caches refresh cleanly.

---

## Step 2 — Manually update DB and confirm UI still works
**Purpose:** Confirm UI reads real session data.

- Manually create a session row in Supabase.
- Manually attach a few games to that session (update `games.session_id`).
- Update `/api/games` to include session data and verify UI reflects grouping.

**Validation:**
- UI groups real games by session.
- Session labels show from DB.

---

## Step 3 — Add session selector in “Log a game”
**Purpose:** Let user choose where new games go.

- Add dropdown of available sessions.
- Require a session selection before uploading images.
- Add a “Create new session” button (minimal UI).

**Validation:**
- If no session selected, upload is blocked.
- New session appears immediately in dropdown.

---

## Step 4 — Wire logging flow to selected session
**Purpose:** Ensure new jobs/games attach to the selected session.

- `/api/submit` accepts `sessionId`.
- Analysis jobs store `session_id`.
- Worker attaches `session_id` to newly created games.

**Validation:**
- Newly logged games show under the correct session.

---

## Step 5 — Manual log flow uses selected session
**Purpose:** Keep manual games consistent.

- `/api/game` (manual) accepts `sessionId`.
- Manual game inserts include `session_id`.

**Validation:**
- Manually created games show in correct session.

---

## Step 6 — Session naming rules (frontend)
**Purpose:** Ensure labels are clear and consistent.

- If `bowling_sessions.name` is present → display it.
- Otherwise label by order (Session 1, Session 2, …) using created_at.
- Show session date based on first game’s played_at (optional but recommended).

**Validation:**
- Sessions with no name render as “Session X”.
- Session order matches created_at.

---

## Step 7 — Optional polish
**Purpose:** Quality of life.

- Show number of games + average score per session.
- Collapsible session groups.
- Inline rename session (backend later).

---

## Decisions we already made
- Frontend naming uses “Session”.
- Backend uses table name `bowling_sessions`.
- Sessions should be editable later (not in the first steps).
