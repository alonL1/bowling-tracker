# Bowling Tracker Chatbot — End-to-End Reference

This document describes how the in-app bowling stats chatbot works: from the moment a user types a message in the mobile app, through the routing/dispatch logic on the server, the prompts that get sent to the LLM, the data the LLM has access to, and how answers are returned to the user.

It is intended to be the source of truth for anyone trying to **optimize, debug, or extend** the chatbot.

---

## 1. High-level architecture

```
 Mobile UI                      Next.js API                          Postgres / Supabase            Google Gemini
 (React Native)        ─────►    /api/chat (POST)         ─────►     bowling_sessions / games /     (gemini-flash-*)
   chat.tsx                       app/api/chat/route.ts              frames / shots / chat_logs
   chat-history-store.ts                │                                   ▲
        ▲                               │                                   │
        │                               ├── load games (top 100)            │
        │                               ├── load sessions                   │
        │ JSON                          ├── parse question (regex)          │
        └────  ChatResponse  ◄──────────┤── build indexes / summary         │
                                        ├── route ───► SQL  ── prompt #3 ───┤
                                        │             validateSql           │
                                        │             execute_sql RPC ──────┘
                                        │             prompt #4
                                        │
                                        ├── route ───► CONTEXT ── prompt #2
                                        │
                                        └── fallback ─► OFFLINE shortcut (regex-driven canned answers)
```

Two important properties of this design:

1. **The chatbot is single-turn.** Prior chat messages are stored *only on the device* and are never sent back to the server. Every request rebuilds the user's data context from scratch.
2. **There is no tool calling / function calling.** The LLM is steered with prompt-only instructions. SQL is produced by asking Gemini to *return JSON*; the server then executes that SQL itself via a Supabase RPC.

---

## 2. Files involved

| Concern | File |
|---|---|
| Mobile chat screen | [mobile/src/app/(tabs)/chat.tsx](mobile/src/app/(tabs)/chat.tsx) |
| Mobile API client | [mobile/src/lib/backend.ts](mobile/src/lib/backend.ts) |
| Local chat history (AsyncStorage) | [mobile/src/lib/chat-history-store.ts](mobile/src/lib/chat-history-store.ts) |
| Mobile offline fallback | [mobile/src/lib/offline-chat.ts](mobile/src/lib/offline-chat.ts) |
| API route (the brain) | [app/api/chat/route.ts](app/api/chat/route.ts) |
| `execute_sql` RPC definition | [db/schema.sql](db/schema.sql) (lines 634–644) |

---

## 3. Mobile entry point

`ChatScreen` in [mobile/src/app/(tabs)/chat.tsx](mobile/src/app/(tabs)/chat.tsx) renders the chat. Highlights:

- Messages are kept in React state and persisted to AsyncStorage at `pinpoint-chat-history-v1:user:{userId}`.
- A hard cap of 100 messages is enforced (`CHAT_HISTORY_MESSAGE_LIMIT`).
- Status states: `'idle' | 'loading' | 'error'`.
- A "what can I ask?" modal contains canned `EXAMPLES` to seed user intent.

The send call is just:

```ts
// mobile/src/lib/backend.ts
export async function sendChat(question: string, gameId?: string | null) {
  return apiJson<ChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      gameId,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    }),
  });
}
```

`ChatResponse` shape:

```ts
type ChatResponse = {
  answer?: string;        // online success
  meta?: string;          // method/timing diagnostics (when enabled)
  onlineError?: string;   // online failure reason
  offlineAnswer?: string; // fallback string if online failed
  offlineMeta?: string;
  offlineNote?: string;   // visible warning that this came from offline shortcuts
  scope?: string;         // e.g. "all games for the signed-in user"
};
```

> **Note:** The API never receives prior chat turns. There is no conversation memory on the model side.

---

## 4. The API route

[app/api/chat/route.ts](app/api/chat/route.ts) — `export async function POST(request)` starts at line 1782.

### 4.1 Environment knobs

| Env var | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Required. Google Generative Language API key. | — |
| `GEMINI_MODEL` | Model id. | `gemini-flash-latest` |
| `CHAT_MODE` | `"sql" \| "context" \| "mix"` — picks routing strategy. | `mix` |
| `CHAT_DEBUG` | `"true"` logs every prompt + response to server console. | off |
| `CHAT_SHOW_METHOD` | Append `Method: sql/context/offline` to `meta`. | off |
| `CHAT_SHOW_TIMING` | Append per-stage timings to `meta`. | off |
| `CHAT_THINKING_MODE` | `minimal \| low \| medium \| high` (Gemini thinking budget: 0/128/512/2048). | `minimal` |
| `CHAT_CONTEXT_RECENT_LIMIT` | Max recent games injected into context-mode prompts. | 15 |
| `CHAT_MAX_QUESTION_CHARS` | Max chars allowed in a question. | 400 |
| `CHAT_MAX_REQUESTS_PER_USER_PER_MINUTE` | Rate limit. | 3 |
| `CHAT_MAX_REQUESTS_PER_USER_PER_TEN_MINUTES` | Rate limit. | 10 |
| `CHAT_MAX_REQUESTS_PER_USER_PER_24H` | Rate limit. | 40 |
| `CHAT_MAX_REQUESTS_PER_IP_PER_MINUTE` | Rate limit. | 12 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | DB access. | — |
| `DEV_USER_ID` | Optional dev override for auth. | — |

### 4.2 Sequence per request

```
1.  Read env (api key, model, mode, rate limits, …)
2.  Parse JSON body { question, gameId?, timezoneOffsetMinutes? }
3.  Validate question non-empty + ≤ CHAT_MAX_QUESTION_CHARS
4.  Resolve user from auth header (reject guests)
5.  Look up rate-limit counts in `chat_request_logs` (per user 1m/10m/24h, per IP 1m)
6.  Insert a new `chat_request_logs` row for this request
7.  Load games:
       - if gameId given: that single game (with frames + shots)
       - else: 100 most recent games for this user (with frames + shots)
8.  Load all bowling_sessions for this user
9.  Build:
       - sessionIndex      (label sessions "Session 1"/"Session 2"… or by name)
       - orderedGames      (chronological labeling per session: "Game N in Session X")
       - selection         (regex extraction from question: game #, frame #, session #, time filter)
       - summary           (totalGames, averageScore, strikeRate, spareRate, perFrame)
       - frameStats        (per frame 1–10: averagePins, strikeRate, spareRate)
       - index             (full game index for prompt labeling)
10. Dispatch by chatMode:
       - "sql"     → attemptSql()
       - "context" → attemptContext()
       - "mix"     → attemptSql(); if null/fallback → attemptContext()
11. If both online attempts fail → tryShortcut() (offline regex answers)
12. Return JSON response.
```

The implementation lives entirely in the single function `POST` plus its helpers.

---

## 5. Data the chatbot has access to

### 5.1 Database tables

The schema string passed to the SQL prompt is exact ([route.ts:1670–1674](app/api/chat/route.ts#L1670-L1674)):

```
bowling_sessions(id uuid, user_id uuid, name text, description text, started_at timestamptz, created_at timestamptz)
games(id uuid, session_id uuid, game_name text, player_name text, total_score int, played_at timestamptz, created_at timestamptz, user_id uuid)
frames(id uuid, game_id uuid, frame_number int, is_strike boolean, is_spare boolean)
shots(id uuid, frame_id uuid, shot_number int, pins int)
Note: 10th-frame X 9 / uses shots 1=10, 2=9, 3=1; count it as a spare conversion from shots when answering spare-count or spare-rate questions.
```

> The `chat_request_logs` table is used by the server for rate limiting only — it is *not* exposed to the LLM.

### 5.2 Loading limits

- Up to **100 most-recent games** (by `played_at desc`) per request.
- All sessions for the user (filtered down to those that contain games).
- Frames + shots are nested in the same select, so each game payload includes its 10 frames and shots.

### 5.3 Pre-computed structures injected into prompts

Every prompt sees JSON-serialized versions of:

- **`scope`** — short string ("all games for the signed-in user", "current game only", "games in Session 1 and Session 3").
- **`sessionIndex`** — `[{ sessionId, sessionLabel, sessionName, createdAt }, …]`.
- **`index`** (a.k.a. Game Index) — every game with id, label ("Game N in Session X" or custom name), totalScore, playedAt (UTC), createdAt, sessionId, sessionName, sessionLabel.
- **`selection`** — regex-derived hints: `selectedGameNumbers`, `selectedFrameNumbers`, `selectedSessionIds`, `selectedSessionLabels`, `sessionless`, `timeFilter`, `timezoneOffsetMinutes`.
- **`summary`** — `totalGames`, `scoredGames`, `averageScore`, `totalFrames`, `strikeRate`, `spareRate`, `perFrame[]`.
- **`frameStats`** — per frame 1–10: `averagePins`, `strikeRate`, `spareRate`.
- **`sessionGameIndex`** — sessions with their games as `{ gameLabel, totalScore, playedAt }`.
- **`contextGames`** (context mode only) — last 15 games **including frame-by-frame shot pins**.

---

## 6. Prompts

There are **four** prompt builders. Every prompt is a single string sent to Gemini with `temperature: 0.2`. SQL generation additionally requests `responseMimeType: "application/json"`.

The order in which they may run during one chat request:

```
Mode "sql":      [SQL gen] ──► [SQL answer]
Mode "context":  [Context]
Mode "mix":      [SQL gen] ──► [SQL answer]    OR (fallback)    [Context]
```

The **summary prompt** (`buildPrompt`) is defined and exported but in the current code path it is **not invoked** — the live paths are `buildSqlPrompt` + `buildSqlAnswerPrompt` for SQL mode and `buildContextPrompt` for context mode. It is documented here because it is still in the file and may be revived during refactors.

### 6.1 Prompt 1 — Summary answer (`buildPrompt`, currently unused)

```
You are a bowling stats assistant that is familiar with bowling terminology. Answer the question using only the JSON data below.
You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
If the data does not include the answer, say so briefly.
Ignore any session not present in the Session/Game Index.
When listing multiple items, format them as a bulleted or numbered list (one item per line).
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n."
If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
If a response is null, instead of using the word "null" use language such as "You have no games x to y"
Only in the final written answer, round displayed decimal values to the nearest hundredth and omit trailing zeros. Keep full precision while reasoning from the provided data unless the user asked for more precision or it clearly matters.

Scope: ${scope}
Summary JSON:
${JSON.stringify(summary, null, 2)}

Game Index:
${JSON.stringify(index, null, 2)}

Session/Game Index:
${JSON.stringify(sessionGameIndex ?? [], null, 2)}

Selection (hint only; may be incomplete for complex queries):
${JSON.stringify(selection, null, 2)}

Frame Aggregates:
${JSON.stringify(frameStats, null, 2)}

Question: ${question}
Answer:
```

#### Example filled-out

```
You are a bowling stats assistant that is familiar with bowling terminology. Answer the question using only the JSON data below.
… (header lines unchanged) …

Scope: all games for the signed-in user
Summary JSON:
{
  "totalGames": 12,
  "scoredGames": 12,
  "averageScore": 142.5,
  "totalFrames": 120,
  "strikeRate": 0.34,
  "spareRate": 0.28,
  "perFrame": [
    { "frame": 1, "frames": 12, "averagePins": 8.4, "strikeRate": 0.42, "spareRate": 0.25 },
    …
    { "frame": 10, "frames": 12, "averagePins": 13.1, "strikeRate": 0.5, "spareRate": 0.33 }
  ]
}

Game Index:
[
  { "id": "5a…", "gameName": "Game 1 in Session 1", "totalScore": 132, "playedAt": "2026-04-01T19:14:00Z", "createdAt": "…", "sessionId": "ab…", "sessionName": null, "sessionLabel": "Session 1" },
  …
]

Session/Game Index:
[]

Selection (hint only; may be incomplete for complex queries):
{
  "selectedGameNumbers": [],
  "selectedGameNames": [],
  "selectedFrameNumbers": [],
  "selectedSessionIds": [],
  "selectedSessionNumbers": [],
  "selectedSessionNames": [],
  "selectedSessionLabels": [],
  "sessionless": false,
  "timeFilter": {},
  "timezoneOffsetMinutes": 300,
  "sessionIndex": [ … ]
}

Frame Aggregates:
[
  { "frame": 1, "frames": 12, "averagePins": 8.4, "strikeRate": 0.42, "spareRate": 0.25 },
  …
]

Question: What is my average score?
Answer:
```

### 6.2 Prompt 2 — Context-based answer (`buildContextPrompt`)

Used in `attemptContext` when reasoning over recent games is required (tips, advice, timing-aware questions, anything that doesn't reduce to aggregate stats).

```
You are a bowling stats assistant that is familiar with bowling terminology. Use the JSON context to answer.
You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
If the answer is not present, say so briefly.
Ignore any session not present in the Session/Game Index.
Very important to know that all timestamps you see in the context are UTC. The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
If you mention times, convert them to the user's local time.
local time + ${timezoneOffsetMinutes ?? "unknown"} = UTC.
When listing multiple items, format them as a bulleted or numbered list (one item per line).
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n."
Do not mention query limits.
If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
If a response is null, instead of using the word "null" use language such as "You have no games x to y"
Only in the final written answer, round displayed decimal values to the nearest hundredth and omit trailing zeros. Keep full precision while reasoning from the provided data unless the user asked for more precision or it clearly matters.

Scope: ${scope}
Session/Game Index:
${JSON.stringify(sessionGameIndex ?? [], null, 2)}

Selection (hint only; may be incomplete for complex queries):
${JSON.stringify(selection, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Question: ${question}
Answer:
```

The `context` field has this shape (built at [route.ts:2452–2459](app/api/chat/route.ts#L2452-L2459)):

```ts
{
  truncated: boolean,
  contextGames: [{ gameName, playedAt, totalScore, sessionId, sessionLabel, sessionName, frames: [{ frame, shots: [pin, pin, …] }] }],
  sessionGameIndex: [...],
  summary: { … },
  frameStats: [...]
}
```

#### Example filled-out (user asks: *"Why does my score drop in the 7th frame?"*)

```
You are a bowling stats assistant that is familiar with bowling terminology. Use the JSON context to answer.
… (header lines unchanged) …
Very important to know that all timestamps you see in the context are UTC. The user's timezone offset (minutes from UTC) is 300.
If you mention times, convert them to the user's local time.
local time + 300 = UTC.
… (rest of header) …

Scope: all games for the signed-in user
Session/Game Index:
[
  {
    "sessionId": "ab12…",
    "sessionLabel": "Session 1",
    "sessionName": null,
    "games": [
      { "gameLabel": "Game 1", "totalScore": 132, "playedAt": "2026-04-01T19:14:00Z" },
      { "gameLabel": "Game 2", "totalScore": 148, "playedAt": "2026-04-01T19:42:00Z" }
    ]
  }
]

Selection (hint only; may be incomplete for complex queries):
{
  "selectedGameNumbers": [],
  "selectedGameNames": [],
  "selectedFrameNumbers": [7],
  "selectedSessionIds": [],
  "selectedSessionNumbers": [],
  "selectedSessionNames": [],
  "selectedSessionLabels": [],
  "sessionless": false
}

Context:
{
  "truncated": false,
  "contextGames": [
    {
      "gameName": "Game 1 in Session 1",
      "playedAt": "2026-04-01T19:14:00Z",
      "totalScore": 132,
      "sessionId": "ab12…",
      "sessionLabel": "Session 1",
      "sessionName": null,
      "frames": [
        { "frame": 7, "shots": [4, 3] }
      ]
    },
    {
      "gameName": "Game 2 in Session 1",
      "playedAt": "2026-04-01T19:42:00Z",
      "totalScore": 148,
      "sessionId": "ab12…",
      "sessionLabel": "Session 1",
      "sessionName": null,
      "frames": [
        { "frame": 7, "shots": [6, 0] }
      ]
    }
  ],
  "sessionGameIndex": [ /* same as above */ ],
  "summary": { "totalGames": 12, "averageScore": 142.5, "strikeRate": 0.34, "spareRate": 0.28, … },
  "frameStats": [ { "frame": 7, "averagePins": 6.8, "strikeRate": 0.18, "spareRate": 0.21 } ]
}

Question: Why does my score drop in the 7th frame?
Answer:
```

### 6.3 Prompt 3 — SQL generation (`buildSqlPrompt`)

Returned text **must** be JSON of shape `{ "sql": string|null, "explanation": string }`. The model can opt out by emitting the sentinel `"__USE_CONTEXT__"` for `sql`, which causes the server to fall back to context mode.

```
You are a bowling stats assistant that is familiar with bowling terminology.
You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in SQL but feel free to use.
Your task is to write a single SQL SELECT query to answer a bowling stats question.
Return JSON only with this schema: {"sql": string|null, "explanation": string}.
- Only SELECT statements.
- Use table and column names exactly as defined.
- If you cannot answer with SQL, set sql to "__USE_CONTEXT__" and explain.
- The game index is a full list of games (not filtered). Use it for labels, but follow the question text for filtering.
- Labels like "Game 3" come from the Game Index ordering; do not filter by games.game_name for "Game N" labels unless the user explicitly mentions a custom name.
- Session labels and IDs are provided in the Session Index. If the user references Session N or a session name, map it to session_id and filter by games.session_id.
- Empty sessions do not exist for this task. Never include or count any session that is not in the Session Index.
- When listing sessions, use the Session Index labels (sessionLabel) and never output raw UUIDs unless the user explicitly asks for IDs.
- If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
- If the question lists games, include games.id, games.session_id, games.played_at, and games.total_score in the SELECT so labels can be mapped.
- If the question lists sessions, include bowling_sessions.id in the SELECT so labels can be mapped.
- The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
- Times mentioned in the user's question are in the user's local time unless explicitly stated otherwise; convert to UTC for querying.
- Times in Schema and Game Index are in UTC.
- local time + ${timezoneOffsetMinutes ?? "unknown"} = UTC.

Schema:
${schema}

Session Index:
${JSON.stringify(sessionIndex ?? [], null, 2)}

Game Index:
${JSON.stringify(index, null, 2)}

Question: ${question}
JSON Output:
```

#### Example filled-out (user asks: *"What is my average score across games 3 to 6?"*)

```
You are a bowling stats assistant that is familiar with bowling terminology.
… (header lines unchanged) …
- The user's timezone offset (minutes from UTC) is 300.
- Times mentioned in the user's question are in the user's local time unless explicitly stated otherwise; convert to UTC for querying.
- Times in Schema and Game Index are in UTC.
- local time + 300 = UTC.

Schema:
bowling_sessions(id uuid, user_id uuid, name text, description text, started_at timestamptz, created_at timestamptz)
games(id uuid, session_id uuid, game_name text, player_name text, total_score int, played_at timestamptz, created_at timestamptz, user_id uuid)
frames(id uuid, game_id uuid, frame_number int, is_strike boolean, is_spare boolean)
shots(id uuid, frame_id uuid, shot_number int, pins int)
Note: 10th-frame X 9 / uses shots 1=10, 2=9, 3=1; count it as a spare conversion from shots when answering spare-count or spare-rate questions.

Session Index:
[
  { "sessionId": "ab12…", "sessionLabel": "Session 1", "sessionName": null, "createdAt": "2026-04-01T19:00:00Z" }
]

Game Index:
[
  { "id": "5a…", "gameName": "Game 1 in Session 1", "totalScore": 132, "playedAt": "2026-04-01T19:14:00Z", … },
  { "id": "5b…", "gameName": "Game 2 in Session 1", "totalScore": 148, "playedAt": "2026-04-01T19:42:00Z", … },
  { "id": "5c…", "gameName": "Game 3 in Session 1", "totalScore": 156, "playedAt": "2026-04-01T20:09:00Z", … },
  { "id": "5d…", "gameName": "Game 4 in Session 1", "totalScore": 121, "playedAt": "2026-04-01T20:35:00Z", … },
  { "id": "5e…", "gameName": "Game 5 in Session 1", "totalScore": 144, "playedAt": "2026-04-01T21:01:00Z", … },
  { "id": "5f…", "gameName": "Game 6 in Session 1", "totalScore": 167, "playedAt": "2026-04-01T21:30:00Z", … },
  …
]

Question: What is my average score across games 3 to 6?
JSON Output:
```

A typical Gemini response:

```json
{
  "sql": "SELECT AVG(total_score) AS average_score FROM games WHERE id IN ('5c…','5d…','5e…','5f…')",
  "explanation": "Averages total_score for the four games labeled 3 through 6 in the user's overall ordering."
}
```

The server then runs `validateSql` (only `SELECT`, no `;`, no DDL/DML keywords, auto-appends `LIMIT 200` if missing) and executes it via the Postgres function:

```sql
create or replace function execute_sql(query text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  execute format('select jsonb_agg(t) from (%s) t', query) into result;
  return coalesce(result, '[]'::jsonb);
end;
$$;
```

### 6.4 Prompt 4 — SQL answer synthesis (`buildSqlAnswerPrompt`)

Receives the validated SQL, the rows the RPC returned, and a label mapping so it never has to reveal raw UUIDs.

```
You are a bowling stats assistant that is familiar with bowling terminology. Use the SQL and results JSON to answer.
You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
All timestamps in the results are UTC. The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
If you mention times, convert them to the user's local time.
UTC - ${timezoneOffsetMinutes ?? "unknown"} minutes = local time.
When listing multiple items, format them as a bulleted or numbered list (one item per line).
If results include gameLabel (or sessionLabel), use those labels instead of raw IDs or null game_name values.
Never mention sessions that are not present in the Label Mapping.
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n."
If a response is null, instead of using the word "null" use language such as "You have no games x to y"
Only in the final written answer, round displayed decimal values to the nearest hundredth and omit trailing zeros. Keep full precision while reasoning from the provided data unless the user asked for more precision or it clearly matters.

SQL:
${sql}

Label Mapping:
${JSON.stringify(labelMapping ?? {}, null, 2)}

Results JSON:
${JSON.stringify(results, null, 2)}

Question: ${question}
Answer:
```

#### Example filled-out (continuation of *"average score games 3 to 6"*)

```
You are a bowling stats assistant that is familiar with bowling terminology. Use the SQL and results JSON to answer.
… (header lines unchanged) …
All timestamps in the results are UTC. The user's timezone offset (minutes from UTC) is 300.
… (rest of header) …

SQL:
SELECT AVG(total_score) AS average_score FROM games WHERE id IN ('5c…','5d…','5e…','5f…') limit 200

Label Mapping:
{
  "sessionLabels": { "ab12…": "Session 1" },
  "gameLabels": {
    "5c…": "Game 3 in Session 1",
    "5d…": "Game 4 in Session 1",
    "5e…": "Game 5 in Session 1",
    "5f…": "Game 6 in Session 1"
  }
}

Results JSON:
[
  { "average_score": 147.0 }
]

Question: What is my average score across games 3 to 6?
Answer:
```

A typical Gemini response: `Your average score across games 3 to 6 is **147**.`

After this string comes back, `formatAnswer()` strips any `"Answer:"` prefix, replaces stray `null` with `n/a`, removes non-ASCII, and ensures the first letter is capitalized and the sentence ends with punctuation.

---

## 7. Decision tree (pseudocode)

```text
function POST(request):
    cfg ← read environment
    body ← parse JSON {question, gameId?, timezoneOffsetMinutes?}
    if !cfg.supabaseUrl or !cfg.serviceKey: return 500
    if !cfg.geminiKey: return 500
    if !body.question or len > maxChars: return 400

    user ← getUserFromRequest(request)
    if user is guest or null: return 401/403

    counts ← rate-limit lookups in chat_request_logs
    if any limit exceeded: return 429
    insert chat_request_logs row

    if body.gameId:
        games ← [load that one game with frames+shots]
        scope ← "current game only"
    else:
        games ← top 100 games by played_at desc with frames+shots
        scope ← "all games for the signed-in user"

    sessions ← all bowling_sessions for user
    build sessionIndex (Session 1, Session 2, …)
    build orderedGames with per-session game numbers and labels
    parse question:
        selectedGameNumbers   ← regex /game(s)?\s*N(\s*(?:-|to)\s*M)?/
        selectedFrameNumbers  ← extractFrameNumbers
        selectedSessionNumbers← regex /session(s)?\s*N…/
        sessionNameMatches    ← match against session names
        sessionless           ← keywords "no session" / "without session" / "sessionless"
        timeFilter            ← extract "before/after Xpm", date words, weekday, etc.
    derive selectedSessionIds, selectedGames, scope override ("games in Session 1 and …")
    summary, frameStats ← from selectedGames

    onlineErrors ← []

    function attemptSql():
        prompt3 ← buildSqlPrompt(question, index, schema, sessionIndex, tzOffset)
        raw     ← callGemini(prompt3, mime="application/json")
        json    ← safeParseJson(raw)
        if !json or !json.sql:                         return error "SQL generation failed"
        if json.sql == "__USE_CONTEXT__":              return {fallback: true}
        v ← validateSql(json.sql)
        if !v.ok:                                       return error v.reason
        rpcClient ← supabase with user access token if possible
        rows      ← rpcClient.rpc("execute_sql", {query: v.sql})
        if rpc error:                                   return error "SQL execution failed: …"
        annotatedRows ← annotateRowsWithGameLabels(rows, index)
        labelMap      ← buildLabelMapping(sessionIndex, gameEntries)
        prompt4       ← buildSqlAnswerPrompt(question, v.sql, annotatedRows, tzOffset, labelMap)
        text          ← callGemini(prompt4)
        return {ok: true, answer: text}

    function attemptContext():
        recent ← last CHAT_CONTEXT_RECENT_LIMIT (default 15) games
        contextPayload ← {truncated, contextGames, sessionGameIndex, summary, frameStats}
        prompt2 ← buildContextPrompt(question, scope, contextPayload, selection, sessionGameIndex, tzOffset)
        text    ← callGemini(prompt2)
        return {ok: true, answer: text}

    switch CHAT_MODE:
        case "sql":
            r ← attemptSql();        if r.ok: return jsonOk(r.answer)
        case "context":
            r ← attemptContext();    if r.ok: return jsonOk(r.answer)
        case "mix" (default):
            r ← attemptSql()
            if r.ok:                          return jsonOk(r.answer)
            if not r.fallback and r.error:    onlineErrors.push(r.error)
            r ← attemptContext()
            if r.ok:                          return jsonOk(r.answer)

    // ---- Both online attempts failed: degrade to offline shortcut ----
    selectionLabel ← buildSelectionLabel(selectedGameNumbers, localTimeFilter, sessionLabels)
    shortcut ← tryShortcut(question, offlineGames, summary, frameStats, frames, hasTimeFilter, selectionLabel, sessionLabels)
    if shortcut.handled:
        offlineAnswer ← applyOfflineBold(ensureSentence(shortcut.answer))
    else:
        offlineAnswer ← "Offline mode could not answer this question with basic stats."
    return {
        onlineError:  summarizeOnlineError(onlineErrors.join(" ")),
        offlineAnswer,
        offlineMeta:  buildAnswerMeta("offline", …),
        offlineNote:  "This response was done offline so it can't handle complex questions and may be wrong.",
        scope
    }
```

---

## 8. Offline shortcut catalogue (`tryShortcut`)

When the LLM is unreachable or both online attempts fail, the server tries to answer locally. Patterns recognized (case-insensitive substrings/regex):

| Pattern in question | Answer template |
|---|---|
| `how many games` / `number of games` | `You have **{n}** game(s) in this selection.` |
| `average` / `avg` (no frame, rate, strike/spare, pins, time filter) | `Your average score{scope} is **{avg}**.` |
| `total score` | `Your total score{scope} is **{sum}**.` |
| `best` / `highest` / `max` score | `Your highest score{scope} is **{best}** in **{gameLabel}**.` |
| `worst` / `lowest` / `min` score | `Your lowest score{scope} is **{worst}** in **{gameLabel}**.` |
| `strike rate` / `strike percentage` | `Your strike rate{scope} is **{pct}%**.` (per-frame breakdown if frames selected) |
| `spare rate` / `spare percentage` | `Your spare rate{scope} is **{pct}%**.` (per-frame breakdown if frames selected) |
| `average … frame` (frames selected) | `Average pins per frame{scope}: Frame N: **{pins}**, …` |

Anything else → returns `Offline mode could not answer this question with basic stats.` with the offline note attached so the UI can surface a banner.

The mobile client also has an independent offline path in [mobile/src/lib/offline-chat.ts](mobile/src/lib/offline-chat.ts) that can short-circuit before the request is even sent (used when the device is offline).

---

## 9. Question parsing (regex layer)

Before any LLM call, the server tries to **structure** the question. These extractions are fed into the prompt as `Selection (hint only…)` and also drive the offline shortcuts:

- **Game numbers** — `/games?\s*(\d+)\s*(?:-|to)\s*(\d+)/`, list form `games 1, 2 and 5`, single `game 3`.
- **Session numbers** — same shape: `session 1`, `sessions 2 to 4`, `sessions 1, 3, 5`.
- **Session names** — substring match against `bowling_sessions.name` (longest-first to avoid prefix collisions).
- **Sessionless** — keywords `sessionless`, `no session`, `without session`, `without a session`, `no sessions`.
- **Frame numbers** — `extractFrameNumbers` (similar logic to games).
- **Time filter** — `extractTimeFilter` recognizes "before 7pm", "after 8:30am", date words ("yesterday", "last Friday", "April 1"), and converts them to UTC using `timezoneOffsetMinutes`.

These extracted values are also used to build the user-friendly `scope` line that appears in the response (`scope`) and in the offline answer prefix.

---

## 10. The Gemini call

[route.ts:1492–1531](app/api/chat/route.ts#L1492-L1531):

```ts
async function callGemini(apiKey, model, prompt, responseMimeType?) {
  const generationConfig = {
    temperature: 0.2,
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(thinkingMode ? { thinkingConfig: { thinkingBudget } } : {})
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: "POST", body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig
    })}
  );
  // returns the first candidate's text part
}
```

Notes:

- **No streaming.** The whole response is awaited and then passed back to the client as a single JSON.
- **No retries.** A failure adds to `onlineErrors[]` and falls through.
- **No conversation history.** Each request is a one-shot completion.
- Temperature is fixed at `0.2` for determinism — bumping it is the easiest knob if answers get repetitive.

---

## 11. Conversation history (mobile only)

Stored in AsyncStorage by [mobile/src/lib/chat-history-store.ts](mobile/src/lib/chat-history-store.ts). Key: `pinpoint-chat-history-v1:user:{userId}`. Each persisted message:

```ts
{
  id: string;
  createdAt: string;        // ISO
  role: 'user' | 'assistant';
  content: string;
  variant?: 'error' | 'offline';
  note?: string;            // e.g. offlineNote
  meta?: string;            // method/timing diagnostics
}
```

Operations: `loadChatHistory`, `saveChatHistory`, `clearChatHistory`. The list is capped at 100 entries.

The history is **not** sent on subsequent requests, so the model cannot reference prior turns. If we ever want true multi-turn behavior we will need to add a `history?: Message[]` field to the request body and weave it into the prompts (probably as a separate "Conversation so far:" block in `buildContextPrompt`).

---

## 12. Where things tend to go wrong

| Symptom | Likely cause | Where to look |
|---|---|---|
| "Could not generate a query for that question." | Gemini didn't return parseable JSON. | `safeParseJson` at [route.ts:1693](app/api/chat/route.ts#L1693). Inspect raw response with `CHAT_DEBUG=true`. |
| "Database query failed. Try again." | `validateSql` accepted it but Postgres rejected it (e.g. column the model invented). | `runSqlMethod` after the `rpc("execute_sql", …)` call. |
| Model says it can't see a session that exists | If the session truly has no games, it should have already been deleted by [`deleteSessionIfEmpty`](app/api/utils/sessions.ts) — investigate whether the cleanup ran. Sessions in the DB are now always non-empty by invariant. |
| "Game N" answers reference the wrong game | Per-session numbering vs. global numbering mismatch — the rule is "if a session is filtered, Game N is intra-session; otherwise it's chronological global." Confirm `selection.selectedSessionIds` is populated. | The grouping block at [route.ts:2175–2210](app/api/chat/route.ts#L2175-L2210). |
| Times in answers are off by hours | Bad `timezoneOffsetMinutes`. The mobile client sends `new Date().getTimezoneOffset()` (which is **positive** for west-of-UTC). Prompt #3 uses `local + offset = UTC` — this is correct for that sign convention. | [mobile/src/lib/backend.ts](mobile/src/lib/backend.ts) `sendChat` and prompt #3. |
| Offline answer has trailing punctuation issues | `ensureSentence` and `applyOfflineBold` post-processing. | [route.ts:650](app/api/chat/route.ts#L650), [route.ts:797](app/api/chat/route.ts#L797). |
| Rate-limit 429 in dev | All four windows count failures too because the log row is inserted before LLM calls. | Insert at [route.ts:1989](app/api/chat/route.ts#L1989). |

---

## 13. Quick optimization targets

A few low-risk changes that would pay off based on what's in the code today:

1. **Trim the Game Index in prompt #3.** It includes every loaded game (up to 100 rows × ~7 fields) on every SQL request. For most questions only the labels of selected games are needed. Sending a compact `[id, label, sessionId, playedAt, totalScore]` array, or even pre-filtering by `selectedNumbers`, would shave hundreds of tokens.
2. **Skip prompt #4 for trivial scalar results.** When `results` is `[{average_score: 147}]` or `[{count: 12}]`, the server can format the answer directly using the SQL alias, saving a full Gemini call.
3. **Cache the SQL prompt's static head.** The schema + boilerplate instructions don't change between requests; if/when we move to an SDK that supports prompt caching (or move to Anthropic), pin the static prefix.
4. **Add a true intent classifier as a first pass.** The legacy `classifyMethod` (still in the file at [route.ts:1124](app/api/chat/route.ts#L1124)) is unused. With "mix" mode we always pay for SQL even on coaching-style questions where SQL will obviously fall back. A cheap keyword classifier (or even a tiny Gemini call with a fixed prompt) would let us route advice questions straight to context mode.
5. **Stream the answer.** UI latency is dominated by waiting for the second Gemini call; SSE streaming the final text would make replies feel ~2× faster.
6. **Send recent chat history.** Single-turn means users can't say "what about Game 4?" after asking about Game 3. Threading the last N user/assistant pairs into prompt #2 (and a condensed summary into prompt #3) would unlock follow-ups.
7. **Lift the "100 games" ceiling for filtered queries.** When the question has a clear filter (e.g. only Session 2), we still load 100 most recent games globally and then filter locally. A targeted query in step 7 would cut load time and let SQL mode see games beyond the recent 100.
