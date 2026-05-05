# Plan for improving the chatbot

## Promblems

Issues:
- uses too many tokens per response
- doesn't always get the correct context/information to answer a response correctly
- much of it is still game focused instead of session focused because it was built before we had sessions
- Still focused on an old naming system of games and sessions although now that differs
- prompts that are complex but still should be easy for the chatbot to answer, are often not fully answered
- unclear direction for chatbot
- unclear prompts
- flow is horrible

Things I still need clarity on:
- what data from the database exactly can the chatbot see

Claude Response:
The chatbot has two distinct levels of database access. Be careful — they're different.

**Pre-loaded into prompts (every request, no LLM action needed):**
- `bowling_sessions` — the user's sessions, but only those that contain at least one game (filtered at [route.ts:2065](../app/api/chat/route.ts#L2065)). Fields visible: `id`, `name`, `description`, `started_at`, `created_at`. Each session is given a label "Session 1", "Session 2", … (oldest first by `created_at`) or its custom name if present.
- `games` — up to **100 most-recent games** (by `played_at desc`) for the signed-in user. Fields visible: `id`, `session_id`, `game_name`, `player_name`, `total_score`, `played_at`, `created_at`. Each game is re-labeled "Game N in Session X" using per-session chronological ordering.
- `frames` — every frame for those 100 games, with `frame_number`, `is_strike`, `is_spare`.
- `shots` — every shot for those frames, with `shot_number`, `pins`. **Only sent in context-mode** (last 15 games, see `CHAT_CONTEXT_RECENT_LIMIT`); SQL-mode prompts only see frame booleans, not raw pin counts.
- Pre-computed aggregates: `summary` (totalGames, averageScore, strikeRate, spareRate, perFrame) and `frameStats` (per frame 1–10: averagePins, strikeRate, spareRate).
- A regex-derived `selection` object describing what the user appears to be asking about (game numbers, frame numbers, session refs, time filters, timezone offset).

**Reachable via SQL (only when SQL mode generates a query):**
Through the `execute_sql(query text)` Postgres function ([db/schema.sql:634](../db/schema.sql#L634)). The model is told the schema explicitly:
```
bowling_sessions(id, user_id, name, description, started_at, created_at)
games(id, session_id, game_name, player_name, total_score, played_at, created_at, user_id)
frames(id, game_id, frame_number, is_strike, is_spare)
shots(id, frame_id, shot_number, pins)
```
The SQL is validated server-side: SELECT only, no `;`, no DDL/DML keywords, auto-`LIMIT 200`. The RPC runs as `service_role` if no user token is forwarded, so RLS may not always be the gate — the only enforced filter is whatever the LLM chooses to put in `WHERE user_id = …`. **This is a real risk worth fixing in the rewrite.**

- what can it not see

Claude Response:
- Any game beyond the **100 most-recent**. If you have 250 games and ask about your first session, the model has no rows for it in context-mode. SQL-mode can still reach them via the RPC but the Game Index it uses for labeling will be missing them.
- **Empty sessions** (no games) — filtered out at [route.ts:2065](../app/api/chat/route.ts#L2065) and the prompts explicitly tell the model to ignore them.
- **Other users' data** — the request resolves a single `effectiveUserId` and all queries filter by it (mostly).
- `chat_request_logs` — used for rate limiting only; not in the schema given to the LLM.
- `live_sessions` / `recording_drafts` / any of the in-progress capture tables — completely invisible.
- Friends' sessions, leaderboard data, account data, mobile logs sync metadata — invisible.
- Anything stored only on the device that hasn't been synced back to Supabase yet. The chatbot is server-side and reads Supabase, not the local SQLite mirror.
- Conversation history — the API never sees prior turns.

- Since sessions are also stored locally, do we really need to query the database? or would it be easier to query the local data.

Claude Response:
**Recommendation: keep the server-side data path as the source of truth, but trim what the server pulls.** Going local-first for chat sounds appealing but trades real problems for new ones:

Why server-side wins for the rewrite:
1. **Local-first means no LLM keys on device.** Putting the Gemini key in the React Native bundle exposes it. Anyone who decompiles the app can extract it and burn your quota. So you'd need a thin proxy anyway → you're back to a server.
2. **Local SQLite ([local-logs-db.native.ts](../mobile/src/lib/local-logs-db.native.ts)) is mobile-only.** Web users (`localLogsSupported === false`) would need a different path. Two implementations is worse than one good one.
3. **`useLoggedDataSync` is best-effort.** It only refreshes every 60s and bails on error ([use-logged-data.ts:51](../mobile/src/hooks/use-logged-data.ts#L51)). You can ask "what was my best score yesterday?" right after recording a game on the web and the local cache might not know about it yet.
4. **Cross-device freshness.** You record on phone A, you ask on phone B — local data on phone B is stale until next sync. Server is always current.

What to do instead — the *real* token problem isn't where the data lives, it's that **we ship 100 games' worth of metadata in every prompt**. Fix that on the server:
- Move from "load 100 games then filter in memory" to "look at the parsed selection, then run the minimum query needed."
- For coaching/advice questions, send only the summary + frame aggregates (which are tiny).
- Use Gemini implicit caching for the schema + system instructions so we don't pay for them on every turn.

If you really want to use local data, the right hybrid is: keep the LLM call server-side, but accept a `client_data_digest` from the mobile client (a small precomputed summary). Skip this for v1 — it's complexity you don't need yet.

Unchat related but could help with chat: **[RESOLVED — see commit removing empty sessions]**
- Why do we keep empty sessions but not show them to the user?

Claude Response:
There's no deliberate reason — it's an artifact of how the codebase grew:

1. **Live sessions DO get cleaned up.** [`cleanupLiveSessionIfEmpty`](../app/api/live-session/server.ts#L85) runs when the last game in a live session is removed and deletes the empty session row.
2. **Regular sessions don't.** [`/api/game/route.ts`](../app/api/game/route.ts) deletes a game without checking whether the parent session is now empty. Same for the bulk delete-data path. So if you ever:
   - delete every game in a session manually
   - upload a session and then delete its games
   - have a failed mid-flow that created the session row before the games
   …you end up with an orphan session row.
3. The UI defends against this by filtering empty sessions out in display layers (mobile sessions tab, the chat's `sessionsWithGames`).

So "we keep empty sessions" is a bug, not a feature. The chat code even has to work around it by re-filtering.

- Would it not be better to just fully remove empty sessions from the database as well once they are empty?

Claude Response:
**Yes — do it. This is a strict win.** Three places to add the cleanup, plus one optional sweep:

1. **Game deletion.** In [`app/api/game/route.ts`](../app/api/game/route.ts) DELETE handler, after deleting the game, check if any games remain for that `session_id` and `user_id`; if zero, delete the `bowling_sessions` row. Mirror the pattern from [`cleanupLiveSessionIfEmpty`](../app/api/live-session/server.ts#L85).
2. **Session DELETE endpoint.** Already cascades, fine as-is.
3. **Bulk deletes** ([`/api/account/shared.ts`](../app/api/account/shared.ts), `delete-data` flows). Add the same orphan check after batch game deletes.
4. **One-time backfill migration.** A SQL migration that runs `DELETE FROM bowling_sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM games WHERE session_id IS NOT NULL)` per user. Cleans up the existing orphans.

Knock-on benefits beyond chat:
- The `sessionsWithGames` filter in the chat route disappears — the data is already correct.
- Session numbering ("Session 1, Session 2, …") becomes stable and matches what the user sees on the sessions tab. Right now it can drift if there are filtered-out empty sessions older than visible ones.
- Mobile sync payload shrinks slightly.
- One fewer "ignore empty sessions" rule we have to teach the LLM.

Worth doing **before** the chatbot rewrite — it removes a whole category of edge cases the new system would otherwise have to handle.

## Solution proposal (to be looked over and fixed by AI)

- having it be more of a single agent instead of a bunch of prompts
- it should be an agent with functions that it can use (such as an sql database one) so that i don't have to manually transfer context from prompt to prompt
- it should also use Gemini's caching so that it doesn't have to give it all of the information every time.
