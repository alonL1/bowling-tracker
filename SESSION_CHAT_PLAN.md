# Session-Aware Chat Plan

Goal: make chat understand bowling sessions with minimal changes to the current chat flow. Sessions are already on the UI and in the DB; we will wire them into chat prompts, selection logic, and (where needed) filtering.

## Step 1 — Add Session Index + Labels (no behavioral change yet)

**Why:** We need a stable mapping that matches the UI naming and ordering.

**Plan:**
- In `app/api/chat/route.ts`, load sessions for the user alongside games (single query or a separate `bowling_sessions` query).
- Build a **Session Index** that mirrors the UI labeling:
  - Ordering by `bowling_sessions.created_at` ASC (oldest first), with `id` tie-breaker.
  - Label: `name` if present, otherwise `Session X` where X is the index in that ordering.
- Add `session_id`, `sessionLabel`, and `sessionName` to each game’s index entry.

**No filtering yet.** This step only adds data to prompts so the model sees sessions.

**Validation:**
- Confirm Session Index matches the UI ordering and “Session X” labels.
- Prompt: "List the sessions you know about."
- Expected: A list that matches the session order and names seen in the UI, including "Session X" for unnamed sessions.

---

## Step 2 — Parse Session References in the Question

**Why:** We need a small parser so chat can target specific sessions without heavy logic.

**Plan:**
- Add parsing helpers (mirroring existing game parsing):
  - `extractSessionNumbers(question)` for “session 2”, “sessions 1-3”.
  - `extractSessionNameMatches(question, knownSessionNames)` for named sessions.
  - Detect “sessionless” / “no session” keywords.
- Produce `selectedSessionIds` based on:
  - Session number → Session Index label
  - Session name → exact match (case-insensitive) against `name`
  - “sessionless” → special marker

**Validation:**
- Prompt: "What is my average in sessions 1 to 3?"
- Expected: Answer references only sessions 1–3.
- Prompt: "Compare League Night vs Practice."
- Expected: Answer references those two named sessions only.
- Prompt: "What is my sessionless games average?"
- Expected: Answer is based only on sessionless games.

---

## Step 3 — Apply Session Filters to Selection

**Why:** The selection object should reflect sessions before running SQL/context.

**Plan:**
- Filter `orderedGames` by `selectedSessionIds` (and/or sessionless) before applying game numbers/time filters.
- Ensure the **Game Index** the SQL prompt sees already reflects the session selection (similar to the time filter behavior).
- Update `scope`/`selection` metadata with session info:
  - `selectedSessionLabels` (labels from Session Index)
  - `selectedSessionNames` (explicit names when provided)
  - `isSessionless`

**Validation:**
- Prompt: "Average in session 2."
- Expected: Uses only session 2 games.
- Prompt: "Average in sessionless games."
- Expected: Uses only games with `session_id = null`.

---

## Step 4 — Update Prompts to Include Sessions

**Why:** LLM needs explicit schema + index info to generate correct SQL and context answers.

**Plan:**
- SQL schema string: add `bowling_sessions(id uuid, user_id uuid, name text, description text, started_at timestamptz, created_at timestamptz)` and `games.session_id`.
- SQL prompt additions:
  - Mention Session Index with labels.
  - Instruct: “If user references Session N or a session name, use Session Index to map to `session_id` and filter by it.”
- Context + Summary prompts:
  - Add Session Index block.
  - Include `sessionLabel` per game in context payload.

**Validation:**
- Prompt: "List games in Session 3."
- Expected: Answer lists only games from Session 3.
- Prompt: "Which session has my best average?"
- Expected: Answer names the session with the highest average.

---

## Step 5 — Align Game Numbering With Sessions

**Why:** UI numbers games within each session (Game 1, Game 2). Chat should match that.

**Plan:**
- Compute game numbers **per session**, using `played_at` ascending within each session (same as UI).
- When sessions are selected:
  - “Game 1” refers to the first game within each selected session.
- If no session is specified, keep current behavior but add a small clarification to prompts: “Game labels are per session; ask with session if needed.”

**Validation:**
- Prompt: "Game 1 in session 2 average score."
- Expected: Uses only the first game in session 2.
- Prompt: "Average of Game 1 across all sessions."
- Expected: Uses the first game from each session.

---

## Step 6 — Keep Game Index Unfiltered + Treat Selection as a Hint

**Why:** Filtering the Game Index caused the model to assume missing games didn’t exist (e.g., Session 3 appeared to have only one game). We now keep the Game Index complete and treat the selection block as a hint only.

**Plan:**
- Always build the Game Index from all games (no filtering by session/time).
- Keep `selection` metadata, but mark it in prompts as a hint that may be incomplete for complex questions.
- Continue filtering **actual calculations** by session/time in SQL or context, not by truncating the Game Index.

**Validation:**
- Prompt: "How many spares did I have in Game 1 in Session 3?"
- Expected: SQL uses Session 3 + Game 1 correctly (does not assume Session 3 has only one game).

---

## Step 7 — Update Offline/Shortcut Logic To Respect Sessions (Optional)

**Why:** Offline mode should not ignore sessions if the online path fails.

**Plan:**
- Extend `buildSelectionLabel` to include session label(s) so offline answers read correctly.
- Filter offline games by `selectedSessionIds` before shortcut logic.

**Validation:**
- Prompt (force offline by triggering an online error): "Average score in session 2."
- Expected: Offline answer includes the session label, e.g., “Your average score in session 2 is **…**.”

---

## Step 8 — Add Examples + Light UI Hints (Optional)

**Plan:**
- Add a few examples in `ChatPanel`:
  - “Average score in **Session 2**”
  - “Compare **League Night** vs **Practice**”
  - “How did I bowl in **sessionless games**?”

---

## Step 9 — Manual QA Checklist

- SQL mode:
  - Session numbers, names, and sessionless filtering.
  - Mixed session + game number queries.
- Prompt: "How many games are in Session 4?"
- Expected: Correct count for Session 4.
- Context mode:
  - Session info appears and influences answer.
- Prompt: "Give me coaching tips based on Session 2."
- Expected: Tips reference Session 2 only.
- Offline mode:
  - Session labels appear in answer (no regressions).
- Prompt (offline): "Average in sessionless games."
- Expected: Sessionless label appears in the answer.

---

## Notes / Minimal-Change Approach

- The data model already supports sessions; we only add session-aware parsing + prompt context.
- We do not change the chat API contract, only the internal selection/index and prompts.
- The Session Index should **mirror the UI** (created_at ordering + “Session X” labels) to avoid confusion.
