import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../utils/auth";

export const runtime = "nodejs";

const SQL_CONTEXT_FALLBACK_TOKEN = "__USE_CONTEXT__";

type SupabaseAnyClient = SupabaseClient<any, "public", any>;

type Shot = {
  shot_number: number;
  pins: number | null;
};

type Frame = {
  frame_number: number;
  is_strike: boolean;
  is_spare: boolean;
  shots?: Shot[];
};

type Game = {
  id: string;
  session_id?: string | null;
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  created_at?: string;
  frames?: Frame[];
};

type BowlingSession = {
  id: string;
  name?: string | null;
  description?: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

type OrderedGame = Game & {
  game_name: string;
};

type FrameAggregate = {
  frame: number;
  frames: number;
  averagePins: number | null;
  strikeRate: number;
  spareRate: number;
};

type ChatMethod = "shortcut" | "sql" | "context";

type SqlResult = {
  ok: boolean;
  fallback?: boolean;
  empty?: boolean;
  answer?: string;
  error?: string;
  timings?: {
    sqlPromptMs: number;
    sqlQueryMs: number;
    sqlAnswerMs: number;
  };
};

type ChatTimings = {
  parseRequestMs: number;
  authMs: number;
  loadGamesMs: number;
  loadSessionsMs: number;
  buildIndexMs: number;
};

type DateFilter = {
  year: number;
  month: number;
  day: number;
};

type TimeFilter = {
  date?: DateFilter;
  rangeStart?: DateFilter;
  rangeEnd?: DateFilter;
  beforeMinutes?: number;
  afterMinutes?: number;
  utcDateStart?: string;
  utcDateEnd?: string;
};

function summarizeGames(games: Game[]) {
  const totalGames = games.length;
  const totalScore = games.reduce(
    (sum, game) => sum + (game.total_score ?? 0),
    0
  );
  const scoredGames = games.filter((game) => game.total_score !== null).length;
  const averageScore =
    scoredGames > 0 ? Number((totalScore / scoredGames).toFixed(2)) : null;

  const frames = games.flatMap((game) => game.frames || []);
  const totalFrames = frames.length;
  const strikeFrames = frames.filter((frame) => frame.is_strike).length;
  const spareFrames = frames.filter((frame) => frame.is_spare).length;

  const frameStats = new Map<
    number,
    { frames: number; strikes: number; spares: number }
  >();
  for (const frame of frames) {
    const entry = frameStats.get(frame.frame_number) || {
      frames: 0,
      strikes: 0,
      spares: 0
    };
    entry.frames += 1;
    if (frame.is_strike) {
      entry.strikes += 1;
    }
    if (frame.is_spare) {
      entry.spares += 1;
    }
    frameStats.set(frame.frame_number, entry);
  }

  const perFrame = Array.from(frameStats.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([frameNumber, entry]) => ({
      frame: frameNumber,
      frames: entry.frames,
      strikeRate:
        entry.frames > 0
          ? Number((entry.strikes / entry.frames).toFixed(3))
          : 0,
      spareRate:
        entry.frames > 0
          ? Number((entry.spares / entry.frames).toFixed(3))
          : 0
    }));

  return {
    totalGames,
    scoredGames,
    averageScore,
    totalFrames,
    strikeRate:
      totalFrames > 0 ? Number((strikeFrames / totalFrames).toFixed(3)) : 0,
    spareRate:
      totalFrames > 0 ? Number((spareFrames / totalFrames).toFixed(3)) : 0,
    perFrame
  };
}

function summarizeFrames(games: Game[]): FrameAggregate[] {
  const frameMap = new Map<
    number,
    { frames: number; pinTotal: number; strikes: number; spares: number }
  >();

  for (const game of games) {
    const frames = game.frames || [];
    for (const frame of frames) {
      const entry = frameMap.get(frame.frame_number) || {
        frames: 0,
        pinTotal: 0,
        strikes: 0,
        spares: 0
      };
      const shots = frame.shots || [];
      const shotPins = shots
        .map((shot) => shot.pins)
        .filter((pins) => pins !== null && pins !== undefined) as number[];
      const framePins = shotPins.reduce((sum, pins) => sum + pins, 0);

      if (shotPins.length > 0) {
        entry.frames += 1;
        entry.pinTotal += framePins;
      }
      if (frame.is_strike) {
        entry.strikes += 1;
      }
      if (frame.is_spare) {
        entry.spares += 1;
      }
      frameMap.set(frame.frame_number, entry);
    }
  }

  return Array.from(frameMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([frameNumber, entry]) => ({
      frame: frameNumber,
      frames: entry.frames,
      averagePins:
        entry.frames > 0
          ? Number((entry.pinTotal / entry.frames).toFixed(2))
          : null,
      strikeRate:
        entry.frames > 0 ? Number((entry.strikes / entry.frames).toFixed(3)) : 0,
      spareRate:
        entry.frames > 0 ? Number((entry.spares / entry.frames).toFixed(3)) : 0
    }));
}

function buildPrompt(
  question: string,
  scope: string,
  summary: unknown,
  index: unknown,
  selection: unknown,
  frameStats: unknown,
  sessionGameIndex: unknown
) {
  // prompt for summary-based answer
  // You are a bowling stats assistant that is familiar with bowling terminology. Answer the question using only the JSON data below.
  // You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
  // If the data does not include the answer, say so briefly.
  // Ignore any session not present in the Session/Game Index.
  // When listing multiple items, format them as a bulleted or numbered list (one item per line).
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // Scope: *scope*
  // Summary JSON:
  // *summary json*
  //
  // Game Index:
  // *game index*
  //
  // Session/Game Index:
  // *session game index*
  //
  // Selection (hint only; may be incomplete for complex queries):
  // *selection*
  //
  // Frame Aggregates:
  // *frame aggregates*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant that is familiar with bowling terminology. Answer the question using only the JSON data below.
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
Answer:`;
}

function buildContextPrompt(
  question: string,
  scope: string,
  context: unknown,
  selection: unknown,
  sessionGameIndex: unknown,
  timezoneOffsetMinutes?: number
) {
  // prompt for context-based answer
  // You are a bowling stats assistant that is familiar with bowling terminology. Use the JSON context to answer.
  // You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
  // If the answer is not present, say so briefly.
  // Ignore any session not present in the Session/Game Index.
  // Very important to know that all timestamps you see in the context are UTC. The user's timezone offset (minutes from UTC) is *timezone offset*.
  // If you mention times, convert them to the user's local time.
  // local time + *timezone offset* = UTC.
  // Understand common bowling lingo.
  // When listing multiple items, format them as a bulleted or numbered list (one item per line).
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // Do not mention query limits.
  // If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // Scope: *scope*
  // Session/Game Index:
  // *session game index*
  //
  // Selection (hint only; may be incomplete for complex queries):
  // *selection*
  //
  // Context:
  // *context*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant that is familiar with bowling terminology. Use the JSON context to answer.
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

Scope: ${scope}
Session/Game Index:
${JSON.stringify(sessionGameIndex ?? [], null, 2)}

Selection (hint only; may be incomplete for complex queries):
${JSON.stringify(selection, null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Question: ${question}
Answer:`;
}

function buildSqlPrompt(
  question: string,
  index: unknown,
  schema: string,
  sessionIndex: unknown,
  timezoneOffsetMinutes?: number
) {

  // prompt for SQL generation
  // You are a bowling stats assistant that is familiar with bowling terminology.
  // You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in SQL but feel free to use.
  // Your task is to write a single SQL SELECT query to answer a bowling stats question.
  // Return JSON only with this schema: {"sql": string|null, "explanation": string}.
  // - Only SELECT statements.
  // - Use table and column names exactly as defined.
  // - If you cannot answer with SQL, set sql to "__USE_CONTEXT__" and explain.
  // - The game index is a full list of games (not filtered). Use it for labels, but follow the question text for filtering.
  // - Session labels and IDs are provided in the Session Index. If the user references Session N or a session name, map it to session_id and filter by games.session_id.
  // - Empty sessions do not exist for this task. Never include or count any session that is not in the Session Index.
  // - When listing sessions, use the Session Index labels (sessionLabel) and never output raw UUIDs unless the user explicitly asks for IDs.
  // - If a session is specified, "Game N" refers to ordering within that session. If no session is specified, "Game N" refers to the overall list.
  // - If the question lists games, include games.id, games.session_id, games.played_at, and games.total_score in the SELECT so labels can be mapped.
  // - If the question lists sessions, include bowling_sessions.id in the SELECT so labels can be mapped.
  // - The user's timezone offset (minutes from UTC) is *timezone offset*.
  // - Times mentioned in the question are in the user's local time unless explicitly stated otherwise; convert to UTC for querying.
  // - Times in Schema and Game Index are in UTC.
  // - local time + *timezone offset* minutes = UTC.
  //
  // Schema:
  // *schema*
  //
  // Session Index:
  // *session index*
  //
  // Game Index:
  // *game index*
  //
  // Question: *question*
  // JSON Output:
  return `You are a bowling stats assistant that is familiar with bowling terminology.
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
JSON Output:`;
}

function buildSqlAnswerPrompt(
  question: string,
  sql: string,
  results: unknown,
  timezoneOffsetMinutes?: number,
  labelMapping?: unknown
) {

  // prompt for SQL answer generation
  // You are a bowling stats assistant that is familiar with bowling terminology. Use the SQL and results JSON to answer.
  // You can recognize and correctly interpret bowling slang (e.g., 'wombat' = a gutter spare, 'hambone' = four strikes in a row, 'brooklyn' = strike that crosses to the opposite pocket, 'foundation frame' = 9th frame, etc.) when it appears. Do not force slang in answers but feel free to use.
  // All timestamps in the results are UTC. The user's timezone offset (minutes from UTC) is *timezone offset*.
  // If you mention times, convert them to the user's local time.
  // UTC - *timezone offset* minutes = local time.
  // Understand common bowling lingo.
  // When listing multiple items, format them as a bulleted or numbered list (one item per line).
  // If results include gameLabel (or sessionLabel), use those labels instead of raw IDs or null game_name values.
  // Never mention sessions that are not present in the Label Mapping.
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // Label Mapping:
  // *label mapping*
  //
  // SQL:
  // *sql*
  //
  // Results JSON:
  // *results json*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant that is familiar with bowling terminology. Use the SQL and results JSON to answer.
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

SQL:
${sql}

Label Mapping:
${JSON.stringify(labelMapping ?? {}, null, 2)}

Results JSON:
${JSON.stringify(results, null, 2)}

Question: ${question}
Answer:`;
}

function extractGameNumbers(question: string) {
  const numbers = new Set<number>();
  const rangeRegex = /games?\s*(\d+)\s*(?:-|to)\s*(\d+)/gi;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRegex.exec(question))) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let value = min; value <= max; value += 1) {
        numbers.add(value);
      }
    }
  }

  const listMatch = question.match(/games?\s+([0-9,\sand]+)/i);
  if (listMatch && listMatch[1]) {
    const listNumbers = listMatch[1].match(/\d+/g) || [];
    listNumbers.forEach((value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        numbers.add(parsed);
      }
    });
  }

  const singleRegex = /game\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = singleRegex.exec(question))) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      numbers.add(parsed);
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

function extractSessionNumbers(question: string) {
  const numbers = new Set<number>();
  const rangeRegex = /sessions?\s*(\d+)\s*(?:-|to)\s*(\d+)/gi;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRegex.exec(question))) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let value = min; value <= max; value += 1) {
        numbers.add(value);
      }
    }
  }

  const listMatch = question.match(/sessions?\s+([0-9,\sand]+)/i);
  if (listMatch && listMatch[1]) {
    const listNumbers = listMatch[1].match(/\d+/g) || [];
    listNumbers.forEach((value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        numbers.add(parsed);
      }
    });
  }

  const singleRegex = /session\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = singleRegex.exec(question))) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      numbers.add(parsed);
    }
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSessionNameMatches(question: string, names: string[]) {
  const lowered = question.toLowerCase();
  const ordered = names
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const matches: string[] = [];
  ordered.forEach((name) => {
    const escaped = escapeRegex(name);
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lowered)) {
      matches.push(name);
    }
  });
  return matches;
}

function mentionsSessionless(question: string) {
  const lower = question.toLowerCase();
  return (
    lower.includes("sessionless") ||
    lower.includes("no session") ||
    lower.includes("without session") ||
    lower.includes("without a session") ||
    lower.includes("no sessions")
  );
}

function ensureSentence(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "No response generated.";
  }
  const withPunctuation = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return withPunctuation.replace(
    /^(\s*["'`(\[]?)([a-z])/,
    (_, prefix: string, letter: string) => prefix + letter.toUpperCase()
  );
}

function sanitizeAnswer(raw: string, question: string) {
  const normalizedQuestion = question.trim().toLowerCase();
  let text = raw.trim();
  text = text.replace(/^answer:\s*/i, "").replace(/^question:\s*/i, "");
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[0].toLowerCase() === normalizedQuestion) {
    lines.shift();
  } else if (lines.length > 0 && normalizedQuestion.length > 0) {
    const first = lines[0];
    if (first.toLowerCase().startsWith(normalizedQuestion)) {
      let rest = first.slice(question.length).trim();
      rest = rest.replace(/^answer:\s*/i, "");
      if (rest) {
        lines[0] = rest;
      } else {
        lines.shift();
      }
    }
  }
  text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return text;
}

function stripNonAscii(text: string) {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function formatAnswer(raw: string, question: string) {
  const sanitized = sanitizeAnswer(raw, question);
  const withoutNulls = sanitized.replace(/\bnull\b/gi, "n/a");
  const withoutUnicode = stripNonAscii(withoutNulls);
  return ensureSentence(withoutUnicode);
}

function formatOfflineAnswer(text: string) {
  const withoutNulls = text.replace(/\bnull\b/gi, "n/a");
  const withoutUnicode = stripNonAscii(withoutNulls);
  return ensureSentence(withoutUnicode);
}

function formatTiming(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function buildAnswerMeta(
  method: "sql" | "context" | "offline",
  startedAt: number,
  showMethod: boolean,
  showTiming: boolean
) {
  const parts: string[] = [];
  if (showMethod) {
    parts.push(`Method: ${method}`);
  }
  if (showTiming) {
    const elapsed = Date.now() - startedAt;
    parts.push(`Time: ${formatTiming(elapsed)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function normalizeQuestion(question: string) {
  return question
    .trim()
    .toLowerCase()
    .replace(/\d+/g, "x")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function summarizeOnlineError(raw: string) {
  const message = raw.toLowerCase();
  if (message.includes("quota") || message.includes("rate limit")) {
    return "Rate limit reached. Try again in a bit.";
  }
  if (message.includes("invalid api key") || message.includes("api key")) {
    return "API key error. Check your Gemini API key.";
  }
  if (message.includes("missing gemini_api_key")) {
    return "Missing Gemini API key.";
  }
  if (message.includes("missing supabase configuration")) {
    return "Missing Supabase configuration.";
  }
  if (message.includes("sql generation failed")) {
    return "Could not generate a query for that question.";
  }
  if (message.includes("sql execution failed")) {
    return "Database query failed. Try again.";
  }
  if (message.includes("no sql results")) {
    return "No results found for that question.";
  }
  if (message.includes("timeout") || message.includes("network")) {
    return "Network error. Please try again.";
  }
  return "Something went wrong while answering. Please try again.";
}

async function logQuestionAnswer(
  supabase: SupabaseAnyClient,
  normalizedQuestion: string,
  answer: string
) {
  if (!normalizedQuestion) {
    return;
  }
  const payload = {
    normalized_question: normalizedQuestion,
    last_answer: answer,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("chat_questions")
    .upsert(payload, { onConflict: "normalized_question" });
  if (error) {
    console.warn("Failed to log question:", error.message);
  }
}

function applyOfflineBold(text: string) {
  const lines = text.split("\n");
  return lines
    .map((line) => {
      if (!line.includes(":")) {
        return line;
      }
      const match = line.match(/^(.*?:)\s*([^:]+)$/);
      if (!match) {
        return line;
      }
      const label = match[1];
      const value = match[2].trim();
      if (value.startsWith("**") && value.endsWith("**")) {
        return line;
      }
      return `${label} **${value}**`;
    })
    .join("\n");
}

function resolveThinkingConfig(mode?: string) {
  if (!mode) {
    return null;
  }
  const normalized = mode.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "minimal") {
    return { thinkingBudget: 0 };
  }
  if (normalized === "low") {
    return { thinkingBudget: 128 };
  }
  if (normalized === "medium") {
    return { thinkingBudget: 512 };
  }
  if (normalized === "high") {
    return { thinkingBudget: 2048 };
  }
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isFinite(parsed)) {
    return { thinkingBudget: parsed };
  }
  return null;
}

function extractFrameNumbers(question: string) {
  const numbers = new Set<number>();
  const listMatch = question.match(/frames?\s+([0-9,\s]+)/i);
  if (listMatch && listMatch[1]) {
    const listNumbers = listMatch[1].match(/\d+/g) || [];
    listNumbers.forEach((value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        numbers.add(parsed);
      }
    });
  }

  const singleRegex = /frame\s*(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = singleRegex.exec(question))) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      numbers.add(parsed);
    }
  }

  return Array.from(numbers)
    .filter((value) => value >= 1 && value <= 10)
    .sort((a, b) => a - b);
}

const monthRegex =
  /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/gi;
const monthMap: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

function parseDateMatch(match: RegExpExecArray) {
  const monthKey = match[1].toLowerCase();
  const day = Number.parseInt(match[2], 10);
  const year = match[3]
    ? Number.parseInt(match[3], 10)
    : new Date().getFullYear();
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }
  const month = monthMap[monthKey];
  if (month === undefined) {
    return null;
  }
  return { year, month, day };
}

function extractAllDates(question: string) {
  const matches = question.matchAll(monthRegex);
  const dates: DateFilter[] = [];
  for (const match of matches) {
    const parsed = parseDateMatch(match);
    if (parsed) {
      dates.push(parsed);
    }
  }
  return dates;
}

function extractDateFilter(question: string): DateFilter | null {
  const dates = extractAllDates(question);
  return dates.length > 0 ? dates[0] : null;
}

function parseTimeToMinutes(hour: number, minute: number, meridiem?: string) {
  let resolvedHour = hour;
  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (lower === "pm" && resolvedHour < 12) {
      resolvedHour += 12;
    }
    if (lower === "am" && resolvedHour === 12) {
      resolvedHour = 0;
    }
  }
  return resolvedHour * 60 + minute;
}

function shiftDate(date: DateFilter, dayDelta: number) {
  if (!dayDelta) {
    return date;
  }
  const base = new Date(Date.UTC(date.year, date.month, date.day));
  base.setUTCDate(base.getUTCDate() + dayDelta);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth(),
    day: base.getUTCDate()
  };
}

function convertMinutesToUtc(localMinutes: number, offsetMinutes: number) {
  const total = localMinutes + offsetMinutes;
  const dayShift = Math.floor(total / 1440);
  const normalized = ((total % 1440) + 1440) % 1440;
  return { minutes: normalized, dayShift };
}

function normalizeTimeFilterToUtc(
  filter: TimeFilter,
  timezoneOffsetMinutes?: number
) {
  if (
    timezoneOffsetMinutes === undefined ||
    !Number.isFinite(timezoneOffsetMinutes)
  ) {
    return filter;
  }

  const offset = timezoneOffsetMinutes;
  const next: TimeFilter = { ...filter };
  let nextDate = filter.date;
  const hasTime =
    filter.beforeMinutes !== undefined || filter.afterMinutes !== undefined;

  if (filter.rangeStart && filter.rangeEnd) {
    const startUtc =
      Date.UTC(filter.rangeStart.year, filter.rangeStart.month, filter.rangeStart.day) +
      offset * 60000;
    const endUtc =
      Date.UTC(filter.rangeEnd.year, filter.rangeEnd.month, filter.rangeEnd.day + 1) +
      offset * 60000;
    next.utcDateStart = new Date(startUtc).toISOString();
    next.utcDateEnd = new Date(endUtc).toISOString();
    next.rangeStart = undefined;
    next.rangeEnd = undefined;
  }

  if (filter.beforeMinutes !== undefined) {
    const converted = convertMinutesToUtc(filter.beforeMinutes, offset);
    next.beforeMinutes = converted.minutes;
    if (nextDate) {
      nextDate = shiftDate(nextDate, converted.dayShift);
    }
  }

  if (filter.afterMinutes !== undefined) {
    const converted = convertMinutesToUtc(filter.afterMinutes, offset);
    next.afterMinutes = converted.minutes;
    if (nextDate) {
      nextDate = shiftDate(nextDate, converted.dayShift);
    }
  }

  if (nextDate) {
    next.date = nextDate;
  }

  if (filter.date && !hasTime && !filter.rangeStart && !filter.rangeEnd) {
    const startUtc =
      Date.UTC(filter.date.year, filter.date.month, filter.date.day) +
      offset * 60000;
    const endUtc =
      Date.UTC(filter.date.year, filter.date.month, filter.date.day + 1) +
      offset * 60000;
    next.utcDateStart = new Date(startUtc).toISOString();
    next.utcDateEnd = new Date(endUtc).toISOString();
    next.date = undefined;
  }

  return next;
}

function extractTimeFilter(question: string): TimeFilter {
  const dates = extractAllDates(question);
  let rangeStart: DateFilter | undefined;
  let rangeEnd: DateFilter | undefined;
  if (dates.length >= 2) {
    rangeStart = dates[0];
    rangeEnd = dates[1];
  }
  const date = dates.length === 1 ? dates[0] : undefined;
  const timeRegex = /\b(before|after)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
  const match = question.match(timeRegex);
  if (!match) {
    return date || rangeStart
      ? { date, rangeStart, rangeEnd }
      : {};
  }
  const operator = match[1].toLowerCase();
  const hour = Number.parseInt(match[2], 10);
  const minute = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return date || rangeStart
      ? { date, rangeStart, rangeEnd }
      : {};
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    return date || rangeStart
      ? { date, rangeStart, rangeEnd }
      : {};
  }
  const minutes = parseTimeToMinutes(hour, minute, match[4]);
  if (operator === "before") {
    return { date, rangeStart, rangeEnd, beforeMinutes: minutes };
  }
  if (operator === "after") {
    return { date, rangeStart, rangeEnd, afterMinutes: minutes };
  }
  return date || rangeStart ? { date, rangeStart, rangeEnd } : {};
}

function applyTimeFilter(games: OrderedGame[], filter: TimeFilter) {
  if (
    !filter.date &&
    filter.beforeMinutes === undefined &&
    filter.afterMinutes === undefined &&
    !filter.utcDateStart &&
    !filter.utcDateEnd
  ) {
    return games;
  }
  return games.filter((game) => {
    if (!game.played_at) {
      return false;
    }
    const playedAt = new Date(game.played_at);
    if (Number.isNaN(playedAt.getTime())) {
      return false;
    }
    const playedTime = playedAt.getTime();
    if (filter.utcDateStart && filter.utcDateEnd) {
      const start = Date.parse(filter.utcDateStart);
      const end = Date.parse(filter.utcDateEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return false;
      }
      if (playedTime < start || playedTime >= end) {
        return false;
      }
    } else if (filter.date) {
      const year = playedAt.getUTCFullYear();
      const month = playedAt.getUTCMonth();
      const day = playedAt.getUTCDate();
      if (
        year !== filter.date.year ||
        month !== filter.date.month ||
        day !== filter.date.day
      ) {
        return false;
      }
    }
    const minutes = playedAt.getUTCHours() * 60 + playedAt.getUTCMinutes();
    if (filter.beforeMinutes !== undefined && minutes >= filter.beforeMinutes) {
      return false;
    }
    if (filter.afterMinutes !== undefined && minutes <= filter.afterMinutes) {
      return false;
    }
    return true;
  });
}

// Legacy routing retained for reference (currently unused).
function classifyMethod(question: string): ChatMethod {
  const lower = question.toLowerCase();
  const contextKeywords = [
    "improve",
    "tips",
    "advice",
    "why",
    "how should",
    "recommend",
    "strategy",
    "mental",
    "practice",
    "fix",
    "coach"
  ];
  if (contextKeywords.some((keyword) => lower.includes(keyword))) {
    return "context";
  }

  const sqlKeywords = [
    "average",
    "avg",
    "mean",
    "count",
    "how many",
    "number of",
    "rate",
    "percent",
    "percentage",
    "strike",
    "spare",
    "frame",
    "score",
    "total",
    "best",
    "worst",
    "highest",
    "lowest",
    "max",
    "min",
    "before",
    "after",
    "on"
  ];
  if (sqlKeywords.some((keyword) => lower.includes(keyword))) {
    return "sql";
  }

  return "context";
}

function formatRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatMinutesToTime(minutes: number) {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0
    ? `${hour12}${meridiem}`
    : `${hour12}:${String(minute).padStart(2, "0")}${meridiem}`;
}

function formatDateLabel(date: DateFilter) {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  return `${months[date.month]} ${date.day}, ${date.year}`;
}

function formatGameRange(numbers: number[]) {
  if (numbers.length === 0) {
    return null;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i];
    if (value === end + 1) {
      end = value;
    } else {
      ranges.push({ start, end });
      start = value;
      end = value;
    }
  }
  ranges.push({ start, end });
  const parts = ranges.map((range) =>
    range.start === range.end
      ? `${range.start}`
      : `${range.start} to ${range.end}`
  );
  const joined =
    parts.length <= 2
      ? parts.join(" and ")
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `games ${joined}`;
}

function formatLabelList(labels: string[]) {
  if (labels.length === 0) {
    return null;
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildLabelMapping(
  sessionIndex: Array<{ sessionId: string; sessionLabel: string }> | [],
  gameEntries: Array<{ id: string; label: string }>
) {
  const sessionLabels: Record<string, string> = {};
  sessionIndex.forEach((session) => {
    if (session.sessionId) {
      sessionLabels[session.sessionId] = session.sessionLabel;
    }
  });
  const gameLabels: Record<string, string> = {};
  gameEntries.forEach((entry) => {
    gameLabels[entry.id] = entry.label;
  });
  return { sessionLabels, gameLabels };
}

function isSessionListOnlyQuestion(question: string) {
  const lower = question.toLowerCase();
  const wantsList =
    lower.includes("list") ||
    lower.includes("show") ||
    lower.includes("what sessions") ||
    lower.includes("which sessions");
  if (!wantsList || !lower.includes("session")) {
    return false;
  }
  const disallow = [
    "average",
    "avg",
    "score",
    "highest",
    "lowest",
    "best",
    "worst",
    "compare",
    "rate",
    "percent",
    "strike",
    "spare",
    "frame",
    "game ",
    "games ",
    "games in",
    "game in"
  ];
  return !disallow.some((token) => lower.includes(token));
}

function buildSelectionLabel(
  selectedGameNumbers: number[],
  localTimeFilter: TimeFilter,
  sessionLabels?: string[]
) {
  const gameLabel = formatGameRange(selectedGameNumbers);
  const timeParts: string[] = [];
  if (localTimeFilter.beforeMinutes !== undefined) {
    timeParts.push(`before ${formatMinutesToTime(localTimeFilter.beforeMinutes)}`);
  }
  if (localTimeFilter.afterMinutes !== undefined) {
    timeParts.push(`after ${formatMinutesToTime(localTimeFilter.afterMinutes)}`);
  }
  const timePhrase = timeParts.join(" and ");
  let timeLabel = "";
  if (localTimeFilter.date && timePhrase) {
    timeLabel = `played ${timePhrase} on ${formatDateLabel(localTimeFilter.date)}`;
  } else if (localTimeFilter.date) {
    timeLabel = `played on ${formatDateLabel(localTimeFilter.date)}`;
  } else if (timePhrase) {
    timeLabel = `played ${timePhrase}`;
  }
  if (gameLabel && timeLabel) {
    return `${gameLabel} ${timeLabel}`;
  }
  if (gameLabel) {
    return gameLabel;
  }
  if (timeLabel) {
    return `games ${timeLabel}`;
  }
  if (sessionLabels && sessionLabels.length > 0) {
    const sessionList = formatLabelList(sessionLabels);
    if (sessionList) {
      return `sessions ${sessionList}`;
    }
  }
  return null;
}

function tryShortcut(
  question: string,
  selectedGames: OrderedGame[],
  summary: ReturnType<typeof summarizeGames>,
  frameStats: FrameAggregate[],
  selectedFrames: number[],
  hasTimeFilter: boolean,
  selectionLabel: string | null,
  selectedSessionLabels: string[]
) {
  const lower = question.toLowerCase();
  const includesAverage = lower.includes("average") || lower.includes("avg");
  const scopeSuffix = selectionLabel ? ` on ${selectionLabel}` : "";
  const sessionSuffix =
    !scopeSuffix && selectedSessionLabels.length > 0
      ? ` in ${formatLabelList(selectedSessionLabels)}`
      : "";

  if (/(how many|number of) games/.test(lower)) {
    return {
      handled: true,
      answer: `You have **${summary.totalGames}** game${summary.totalGames === 1 ? "" : "s"} in this selection.`
    };
  }

  const mentionsFrame = lower.includes("frame");
  const mentionsRate = lower.includes("rate") || lower.includes("percent");
  const mentionsStrikeOrSpare = lower.includes("strike") || lower.includes("spare");
  const mentionsPins = lower.includes("pins");

  if (
    includesAverage &&
    !mentionsFrame &&
    !mentionsRate &&
    !mentionsStrikeOrSpare &&
    !mentionsPins &&
    !hasTimeFilter
  ) {
    if (summary.averageScore === null) {
      return { handled: true, answer: "No scores recorded yet." };
    }
    return {
      handled: true,
      answer: `Your average score${scopeSuffix || sessionSuffix} is **${summary.averageScore}**.`
    };
  }

  if (lower.includes("total score")) {
    const total = selectedGames.reduce(
      (sum, game) => sum + (game.total_score ?? 0),
      0
    );
    return {
      handled: true,
      answer: `Your total score${scopeSuffix || sessionSuffix} is **${total}**.`
    };
  }

  if (/(best|highest|max) score/.test(lower)) {
    const scored = selectedGames.filter((game) => game.total_score !== null);
    if (scored.length === 0) {
      return { handled: true, answer: "No scored games found." };
    }
    const best = scored.reduce((prev, current) =>
      (current.total_score || 0) > (prev.total_score || 0) ? current : prev
    );
    return {
      handled: true,
      answer: `Your highest score${scopeSuffix || sessionSuffix} is **${best.total_score}** in **${best.game_name}**.`
    };
  }

  if (/(worst|lowest|min) score/.test(lower)) {
    const scored = selectedGames.filter((game) => game.total_score !== null);
    if (scored.length === 0) {
      return { handled: true, answer: "No scored games found." };
    }
    const worst = scored.reduce((prev, current) =>
      (current.total_score || 0) < (prev.total_score || 0) ? current : prev
    );
    return {
      handled: true,
      answer: `Your lowest score${scopeSuffix || sessionSuffix} is **${worst.total_score}** in **${worst.game_name}**.`
    };
  }

  if (lower.includes("strike rate") || lower.includes("strike percentage")) {
    if (selectedFrames.length > 0) {
      const lines = frameStats
        .filter((entry) => selectedFrames.includes(entry.frame))
        .map(
          (entry) =>
            `Frame ${entry.frame}: **${formatRate(entry.strikeRate)}**`
        );
      return {
        handled: true,
        answer: `Strike rate by frame${scopeSuffix}: ${lines.join(", ")}.`
      };
    }
    return {
      handled: true,
      answer: `Your strike rate${scopeSuffix || sessionSuffix} is **${formatRate(summary.strikeRate)}**.`
    };
  }

  if (lower.includes("spare rate") || lower.includes("spare percentage")) {
    if (selectedFrames.length > 0) {
      const lines = frameStats
        .filter((entry) => selectedFrames.includes(entry.frame))
        .map(
          (entry) =>
            `Frame ${entry.frame}: **${formatRate(entry.spareRate)}**`
        );
      return {
        handled: true,
        answer: `Spare rate by frame${scopeSuffix}: ${lines.join(", ")}.`
      };
    }
    return {
      handled: true,
      answer: `Your spare rate${scopeSuffix || sessionSuffix} is **${formatRate(summary.spareRate)}**.`
    };
  }

  if (includesAverage && mentionsFrame) {
    const targetFrames = selectedFrames.length > 0 ? selectedFrames : [];
    if (targetFrames.length === 0) {
      return { handled: false };
    }
    const lines = frameStats
      .filter((entry) => targetFrames.includes(entry.frame))
      .map((entry) =>
        entry.averagePins === null
          ? `Frame ${entry.frame}: n/a`
          : `Frame ${entry.frame}: **${entry.averagePins}**`
      );
    return {
      handled: true,
      answer: `Average pins per frame${scopeSuffix || sessionSuffix}: ${lines.join(", ")}.`
    };
  }

  return { handled: false };
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  responseMimeType?: string
) {
  const thinkingMode = process.env.CHAT_THINKING_MODE;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    responseMimeType
  };
  const thinkingConfig = resolveThinkingConfig(thinkingMode);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error: ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return text;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type GameIndexEntry = {
  gameName?: string;
  totalScore?: number | null;
  playedAt?: string | null;
  sessionLabel?: string | null;
  sessionName?: string | null;
  sessionId?: string | null;
};

function toIsoTimestamp(value: unknown) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function annotateRowsWithGameLabels(
  rows: unknown[],
  index: unknown
) {
  if (!Array.isArray(rows)) {
    return rows;
  }
  const indexEntries: GameIndexEntry[] = Array.isArray(index)
    ? (index as GameIndexEntry[])
    : [];
  const playedAtMap = new Map<string, GameIndexEntry[]>();
  indexEntries.forEach((entry) => {
    const iso = toIsoTimestamp(entry.playedAt);
    if (!iso) {
      return;
    }
    const list = playedAtMap.get(iso) ?? [];
    list.push(entry);
    playedAtMap.set(iso, list);
  });

  return rows.map((row) => {
    if (!row || typeof row !== "object") {
      return row;
    }
    const next = { ...(row as Record<string, unknown>) };
    const playedAtIso = toIsoTimestamp(next.played_at ?? next.playedAt);
    if (playedAtIso && playedAtMap.has(playedAtIso)) {
      const candidates = playedAtMap.get(playedAtIso) ?? [];
      const score = next.total_score ?? next.totalScore;
      const matched =
        typeof score === "number"
          ? candidates.find((entry) => entry.totalScore === score)
          : candidates[0];
      if (matched) {
        if (!next.gameLabel && matched.gameName) {
          next.gameLabel = matched.gameName;
        }
        if (!next.sessionLabel && matched.sessionLabel) {
          next.sessionLabel = matched.sessionLabel;
        }
        if (!next.sessionName && matched.sessionName) {
          next.sessionName = matched.sessionName;
        }
        if (!next.sessionId && matched.sessionId) {
          next.sessionId = matched.sessionId;
        }
      }
    }
    return next;
  });
}

function validateSql(sql: string) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(trimmed)) {
    return { ok: false, reason: "Only SELECT statements are allowed." };
  }
  if (trimmed.includes(";")) {
    return { ok: false, reason: "Multiple statements are not allowed." };
  }
  const forbidden = [
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "create",
    "grant",
    "revoke",
    "truncate",
    "call",
    "execute",
    "set",
    "vacuum",
    "analyze",
    "refresh",
    "copy"
  ];
  for (const keyword of forbidden) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(trimmed)) {
      return { ok: false, reason: `Forbidden keyword: ${keyword}` };
    }
  }
  const hasLimit = /\blimit\b/i.test(trimmed);
  const safeSql = hasLimit ? trimmed : `${trimmed} limit 200`;
  return { ok: true, sql: safeSql };
}

async function runSqlMethod(
  supabase: SupabaseAnyClient,
  supabaseUrl: string,
  supabaseAnonKey: string | undefined,
  apiKey: string,
  model: string,
  question: string,
  index: unknown,
  sessionIndex: unknown,
  timeFilter: TimeFilter,
  timezoneOffsetMinutes?: number,
  userAccessToken?: string | null
): Promise<SqlResult> {
  const debug = process.env.CHAT_DEBUG === "true";
  const sqlTimings = {
    sqlPromptMs: 0,
    sqlQueryMs: 0,
    sqlAnswerMs: 0
  };
  const schema = `bowling_sessions(id uuid, user_id uuid, name text, description text, started_at timestamptz, created_at timestamptz)
games(id uuid, session_id uuid, game_name text, player_name text, total_score int, played_at timestamptz, created_at timestamptz, user_id uuid)
frames(id uuid, game_id uuid, frame_number int, is_strike boolean, is_spare boolean)
shots(id uuid, frame_id uuid, shot_number int, pins int)`;

  // prompt for SQL generation
  const sqlPrompt = `${buildSqlPrompt(
    question,
    index,
    schema,
    sessionIndex,
    timezoneOffsetMinutes
  )}`;
  if (debug) {
    console.log("SQL prompt:", sqlPrompt);
  }
  const sqlPromptStart = Date.now();
  const sqlText = await callGemini(apiKey, model, sqlPrompt, "application/json");
  sqlTimings.sqlPromptMs = Date.now() - sqlPromptStart;
  if (debug) {
    console.log("SQL raw response:", sqlText);
  }
  const sqlPayload = safeParseJson(sqlText) as {
    sql?: string | null;
    explanation?: string;
  } | null;

  if (!sqlPayload || !sqlPayload.sql) {
    if (debug) {
      console.log("SQL payload missing:", sqlPayload);
    }
    return { ok: false, error: "SQL generation failed." };
  }

  if (
    typeof sqlPayload.sql === "string" &&
    sqlPayload.sql.trim() === SQL_CONTEXT_FALLBACK_TOKEN
  ) {
    if (debug) {
      console.log("SQL requested context fallback.");
    }
    return { ok: false, fallback: true };
  }

  const validated = validateSql(sqlPayload.sql);
  if (!validated.ok || !validated.sql) {
    if (debug) {
      console.log("SQL validation failed:", validated);
    }
    return { ok: false, error: validated.reason || "Invalid SQL." };
  }
  if (debug) {
    console.log("SQL validated:", validated.sql);
  }

  const rpcClient =
    supabaseAnonKey && userAccessToken
      ? createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${userAccessToken}` } },
          auth: { persistSession: false }
        })
      : supabase;

  const sqlQueryStart = Date.now();
  const { data, error } = await rpcClient.rpc("execute_sql", {
    query: validated.sql
  });
  sqlTimings.sqlQueryMs = Date.now() - sqlQueryStart;

  if (error) {
    if (debug) {
      console.log("SQL execution error:", error);
    }
    return { ok: false, error: error.message || "SQL execution failed." };
  }

  const parsedRows = typeof data === "string" ? safeParseJson(data) : data;
  const rows = Array.isArray(parsedRows) ? parsedRows : [];
  const annotatedRows = annotateRowsWithGameLabels(rows, index);
  const labelMapping = buildLabelMapping(
    sessionIndex as Array<{ sessionId: string; sessionLabel: string }>,
    (index as Array<{ id?: string; gameName?: string }>).map((entry) => ({
      id: entry.id || "",
      label: entry.gameName || ""
    }))
  );
  if (debug) {
    console.log("SQL result rows:", annotatedRows);
  }

  // prompt for SQL answer generation
  const answerPrompt = buildSqlAnswerPrompt(
    question,
    validated.sql,
    annotatedRows,
    timezoneOffsetMinutes,
    labelMapping
  );
  if (debug) {
    console.log("SQL answer prompt:", answerPrompt);
  }
  const sqlAnswerStart = Date.now();
  const answerText = await callGemini(apiKey, model, answerPrompt);
  sqlTimings.sqlAnswerMs = Date.now() - sqlAnswerStart;
  return {
    ok: true,
    answer: ensureSentence(answerText || "No response generated."),
    timings: sqlTimings
  };
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const devUserId = process.env.DEV_USER_ID;
  const chatModeRaw = process.env.CHAT_MODE || "mix";
  const chatMode =
    chatModeRaw === "sql" || chatModeRaw === "context" || chatModeRaw === "mix"
      ? chatModeRaw
      : "mix";
  const showMethod = process.env.CHAT_SHOW_METHOD === "true";
  const showTiming = process.env.CHAT_SHOW_TIMING === "true";
  const startedAt = Date.now();
  const debug = process.env.CHAT_DEBUG === "true";
  const timings: ChatTimings = {
    parseRequestMs: 0,
    authMs: 0,
    loadGamesMs: 0,
    loadSessionsMs: 0,
    buildIndexMs: 0
  };

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  const parseStart = Date.now();
  const payload = (await request.json()) as {
    question?: string;
    gameId?: string;
    timezoneOffsetMinutes?: number;
  };
  timings.parseRequestMs = Date.now() - parseStart;

  if (!payload.question) {
    return NextResponse.json(
      { error: "Question is required." },
      { status: 400 }
    );
  }

  const authStart = Date.now();
  const { userId, accessToken: userAccessToken } =
    (await getUserFromRequest(request)) || { userId: null, accessToken: null };
  timings.authMs = Date.now() - authStart;
  const effectiveUserId = userId || devUserId || null;
  if (!effectiveUserId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const question = payload.question;

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
  const normalizedQuestion = normalizeQuestion(question);

  let games: Game[] = [];
  let scope = "all games";

  if (payload.gameId) {
    const loadGamesStart = Date.now();
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,session_id,game_name,player_name,total_score,played_at,created_at,frames:frames(frame_number,is_strike,is_spare,shots:shots(shot_number,pins))"
      )
      .eq("id", payload.gameId)
      .eq("user_id", effectiveUserId)
      .single();
    timings.loadGamesMs = Date.now() - loadGamesStart;

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Game not found." },
        { status: 404 }
      );
    }

    games = [data as Game];
    scope = "current game only";
  } else {
    const loadGamesStart = Date.now();
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,session_id,game_name,player_name,total_score,played_at,created_at,frames:frames(frame_number,is_strike,is_spare,shots:shots(shot_number,pins))"
      )
      .eq("user_id", effectiveUserId)
      .order("played_at", { ascending: false })
      .limit(100);
    timings.loadGamesMs = Date.now() - loadGamesStart;

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load games." },
        { status: 500 }
      );
    }

    games = (data as Game[]) || [];
    scope = "all games for the signed-in user";
  }

  const loadSessionsStart = Date.now();
  const { data: sessionRows, error: sessionError } = await supabase
    .from("bowling_sessions")
    .select("id,name,description,started_at,created_at")
    .eq("user_id", effectiveUserId);
  timings.loadSessionsMs = Date.now() - loadSessionsStart;

  if (sessionError && debug) {
    console.log("Session load error:", sessionError);
  }

  const buildIndexStart = Date.now();
  const sessions = (sessionRows as BowlingSession[] | null) ?? [];
  const sessionIdsWithGames = new Set(
    games.map((game) => game.session_id).filter(Boolean) as string[]
  );
  const sessionsWithGames = sessions.filter((session) =>
    sessionIdsWithGames.has(session.id)
  );
  const orderedSessions = sessionsWithGames.slice().sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.id.localeCompare(b.id);
  });

  const sessionLabelById = new Map<string, string>();
  const sessionNameById = new Map<string, string | null>();
  const sessionIndex = orderedSessions.map((session, index) => {
    const trimmedName = session.name?.trim() || "";
    const label = trimmedName.length > 0 ? trimmedName : `Session ${index + 1}`;
    sessionLabelById.set(session.id, label);
    sessionNameById.set(session.id, trimmedName.length > 0 ? trimmedName : null);
    return {
      sessionId: session.id,
      sessionLabel: label,
      sessionName: trimmedName.length > 0 ? trimmedName : null,
      createdAt: session.created_at
    };
  });

  const customNameById = new Map<string, string>();
  games.forEach((game) => {
    const trimmed = game.game_name?.trim();
    if (trimmed) {
      customNameById.set(game.id, trimmed);
    }
  });

  const orderedGames: OrderedGame[] = games
    .slice()
    .sort((a, b) => {
      const aTime = a.played_at
        ? Date.parse(a.played_at)
        : a.created_at
          ? Date.parse(a.created_at)
          : 0;
      const bTime = b.played_at
        ? Date.parse(b.played_at)
        : b.created_at
          ? Date.parse(b.created_at)
          : 0;
      return aTime - bTime;
    })
    .map((game, index) => {
      const trimmedName = game.game_name?.trim();
      return {
        ...game,
        game_name: trimmedName && trimmedName.length > 0
          ? trimmedName
          : `Game ${index + 1}`
      };
    });

  const sessionNumbers = extractSessionNumbers(question);
  const sessionNameMatches = extractSessionNameMatches(
    question,
    sessionIndex
      .map((session) => session.sessionName)
      .filter(Boolean) as string[]
  );
  const hasSessionless = mentionsSessionless(question);
  const selectedSessionIds = new Set<string>();
  if (sessionNumbers.length > 0) {
    sessionNumbers.forEach((value) => {
      const label = `session ${value}`;
      const matched = sessionIndex.find(
        (session) => session.sessionLabel.toLowerCase() === label
      );
      if (matched) {
        selectedSessionIds.add(matched.sessionId);
      }
    });
  }
  if (sessionNameMatches.length > 0) {
    sessionIndex.forEach((session) => {
      if (!session.sessionName) {
        return;
      }
      if (
        sessionNameMatches.some(
          (name) => name.toLowerCase() === session.sessionName?.toLowerCase()
        )
      ) {
        selectedSessionIds.add(session.sessionId);
      }
    });
  }

  const hasSessionFilter =
    selectedSessionIds.size > 0 || hasSessionless;
  const sessionFilteredGames = hasSessionFilter
    ? orderedGames.filter((game) => {
        if (!game.session_id) {
          return hasSessionless;
        }
        return selectedSessionIds.has(game.session_id);
      })
    : orderedGames;

  const selectedNumbers = extractGameNumbers(question);
  const selectedFrames = extractFrameNumbers(question);
  const gameLabelById = new Map<string, string>();
  const gameNumberById = new Map<string, number>();
  const grouped = new Map<string, OrderedGame[]>();
  orderedGames.forEach((game) => {
    const key = game.session_id ?? "sessionless";
    const list = grouped.get(key) ?? [];
    list.push(game);
    grouped.set(key, list);
  });
  grouped.forEach((groupGames) => {
    groupGames
      .slice()
      .sort((a, b) => {
        const aTime = a.played_at
          ? Date.parse(a.played_at)
          : a.created_at
            ? Date.parse(a.created_at)
            : 0;
        const bTime = b.played_at
          ? Date.parse(b.played_at)
          : b.created_at
            ? Date.parse(b.created_at)
            : 0;
        return aTime - bTime;
      })
      .forEach((game, index) => {
        const number = index + 1;
        gameNumberById.set(game.id, number);
        const customName = customNameById.get(game.id);
        const sessionLabel = game.session_id
          ? sessionLabelById.get(game.session_id) ?? "Session"
          : "Sessionless games";
        const fallbackLabel = hasSessionFilter
          ? `Game ${number}`
          : `Game ${number} in ${sessionLabel}`;
        gameLabelById.set(game.id, customName ?? fallbackLabel);
      });
  });
  const getGameLabel = (game: OrderedGame) =>
    gameLabelById.get(game.id) ?? game.game_name;
  const selectedGames =
    selectedNumbers.length > 0
      ? sessionFilteredGames.filter((game) =>
          selectedNumbers.includes(gameNumberById.get(game.id) ?? -1)
        )
      : sessionFilteredGames;

  const localTimeFilter = extractTimeFilter(question);
  const timeFilter = normalizeTimeFilterToUtc(
    localTimeFilter,
    payload.timezoneOffsetMinutes
  );
  const hasTimeFilter =
    timeFilter.date !== undefined ||
    timeFilter.rangeStart !== undefined ||
    timeFilter.rangeEnd !== undefined ||
    timeFilter.beforeMinutes !== undefined ||
    timeFilter.afterMinutes !== undefined ||
    timeFilter.utcDateStart !== undefined ||
    timeFilter.utcDateEnd !== undefined;

  const onlineGames = selectedGames;
  const offlineGames = applyTimeFilter(selectedGames, timeFilter);

  const summaryOnline = summarizeGames(onlineGames);
  const frameStatsOnline = summarizeFrames(onlineGames).filter((entry) =>
    selectedFrames.length > 0 ? selectedFrames.includes(entry.frame) : true
  );
  const summaryOffline = summarizeGames(offlineGames);
  const frameStatsOffline = summarizeFrames(offlineGames).filter((entry) =>
    selectedFrames.length > 0 ? selectedFrames.includes(entry.frame) : true
  );
  const indexSource = orderedGames;
  const index = indexSource.map((game) => ({
    id: game.id,
    gameName: getGameLabel(game),
    totalScore: game.total_score,
    playedAt: game.played_at,
    createdAt: game.created_at,
    sessionId: game.session_id ?? null,
    sessionName: game.session_id
      ? sessionNameById.get(game.session_id) ?? null
      : null,
    sessionLabel: game.session_id
      ? sessionLabelById.get(game.session_id) ?? null
      : null
  }));
  const selectedSessionLabels = Array.from(selectedSessionIds)
    .map((sessionId) => sessionLabelById.get(sessionId))
    .filter(Boolean) as string[];
  if (hasSessionless) {
    selectedSessionLabels.push("Sessionless games");
  }
  if (!payload.gameId && hasSessionFilter) {
    const labelList = formatLabelList(selectedSessionLabels);
    if (labelList) {
      scope = `games in ${labelList}`;
    }
  }
  const selectedGameLabels = selectedGames.map((game) => getGameLabel(game));
  const selection = {
    selectedGameNumbers: selectedNumbers,
    selectedGameNames: selectedGameLabels,
    selectedFrameNumbers: selectedFrames,
    selectedSessionIds: Array.from(selectedSessionIds),
    selectedSessionNumbers: sessionNumbers,
    selectedSessionNames: sessionNameMatches,
    selectedSessionLabels,
    sessionless: hasSessionless,
    timeFilter,
    timezoneOffsetMinutes: payload.timezoneOffsetMinutes,
    sessionIndex
  };
  const selectionOnline = {
    selectedGameNumbers: selectedNumbers,
    selectedGameNames: selection.selectedGameNames,
    selectedFrameNumbers: selectedFrames,
    selectedSessionIds: Array.from(selectedSessionIds),
    selectedSessionNumbers: sessionNumbers,
    selectedSessionNames: sessionNameMatches,
    selectedSessionLabels,
    sessionless: hasSessionless
  };
  timings.buildIndexMs = Date.now() - buildIndexStart;

  const onlineErrors: string[] = [];

  const attemptSql = async () => {
    try {
      const sqlResult = await runSqlMethod(
        supabase,
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        apiKey,
        model,
        question,
        index,
        sessionIndex,
        timeFilter,
        payload.timezoneOffsetMinutes,
        userAccessToken
      );
      if (sqlResult.ok && sqlResult.answer) {
        if (debug && sqlResult.timings) {
          console.log("SQL timings:", sqlResult.timings);
        }
        if (debug) {
          console.log("Chat timings:", timings);
        }
        const finalAnswer = formatAnswer(sqlResult.answer, question);
        void logQuestionAnswer(supabase, normalizedQuestion, finalAnswer);
        const extraOverhead =
          showTiming
            ? `Overhead parse ${formatTiming(timings.parseRequestMs)}, auth ${formatTiming(timings.authMs)}, games ${formatTiming(timings.loadGamesMs)}, sessions ${formatTiming(timings.loadSessionsMs)}, build ${formatTiming(timings.buildIndexMs)}`
            : "";
        const extraMeta =
          showTiming && sqlResult.timings
            ? `SQL prompt ${formatTiming(sqlResult.timings.sqlPromptMs)}, SQL query ${formatTiming(sqlResult.timings.sqlQueryMs)}, SQL answer ${formatTiming(sqlResult.timings.sqlAnswerMs)}`
            : "";
        const combinedMeta = [buildAnswerMeta("sql", startedAt, showMethod, showTiming), extraMeta, extraOverhead]
          .filter(Boolean)
          .join(showTiming && extraMeta ? " · " : "");
        return {
          answer: finalAnswer,
          meta: combinedMeta || buildAnswerMeta("sql", startedAt, showMethod, showTiming)
        };
      }
      if (sqlResult.fallback) {
        return null;
      }
      if (sqlResult.error) {
        onlineErrors.push(sqlResult.error);
      }
    } catch (error) {
      onlineErrors.push(
        error instanceof Error ? error.message : "SQL mode failed."
      );
    }
    return null;
  };

  const attemptContext = async () => {
    const contextLimit = 15;
    const contextGames = onlineGames.slice(0, contextLimit).map((game) => ({
      gameName: getGameLabel(game),
      playedAt: game.played_at,
      totalScore: game.total_score,
      sessionId: game.session_id ?? null,
      sessionLabel: game.session_id
        ? sessionLabelById.get(game.session_id) ?? null
        : null,
      sessionName: game.session_id
        ? sessionNameById.get(game.session_id) ?? null
        : null,
      frames: (game.frames || [])
        .filter((frame) =>
          selectedFrames.length > 0
            ? selectedFrames.includes(frame.frame_number)
            : true
        )
        .map((frame) => ({
          frame: frame.frame_number,
          shots: (frame.shots || []).map((shot) => shot.pins)
        }))
    }));

    const sessionGameIndex = sessionIndex
      .map((session) => {
        const gamesInSession = sessionFilteredGames
          .filter((game) => game.session_id === session.sessionId)
          .slice()
          .sort((a, b) => {
            const aTime = a.played_at
              ? Date.parse(a.played_at)
              : a.created_at
                ? Date.parse(a.created_at)
                : 0;
            const bTime = b.played_at
              ? Date.parse(b.played_at)
              : b.created_at
                ? Date.parse(b.created_at)
                : 0;
            return aTime - bTime;
          })
          .map((game) => ({
            gameLabel: `Game ${gameNumberById.get(game.id) ?? 0}`,
            totalScore: game.total_score,
            playedAt: game.played_at
          }));
        if (gamesInSession.length === 0) {
          return null;
        }
        return {
          sessionId: session.sessionId,
          sessionLabel: session.sessionLabel,
          sessionName: session.sessionName,
          games: gamesInSession
        };
      })
      .filter(Boolean);
    const sessionlessGames = sessionFilteredGames
      .filter((game) => !game.session_id)
      .slice()
      .sort((a, b) => {
        const aTime = a.played_at
          ? Date.parse(a.played_at)
          : a.created_at
            ? Date.parse(a.created_at)
            : 0;
        const bTime = b.played_at
          ? Date.parse(b.played_at)
          : b.created_at
            ? Date.parse(b.created_at)
            : 0;
        return aTime - bTime;
      })
      .map((game) => ({
        gameLabel: `Game ${gameNumberById.get(game.id) ?? 0}`,
        totalScore: game.total_score,
        playedAt: game.played_at
      }));
    if (sessionlessGames.length > 0) {
      sessionGameIndex.push({
        sessionId: null,
        sessionLabel: "Sessionless games",
        sessionName: null,
        games: sessionlessGames
      });
    }

    const contextPayload = {
      truncated: onlineGames.length > contextLimit,
      contextGames,
      sessionGameIndex,
      summary: summaryOnline,
      frameStats: frameStatsOnline
    };

    try {
      // prompt for context-based answer
      const contextPrompt = buildContextPrompt(
        question,
        scope,
        contextPayload,
        selectionOnline,
        sessionGameIndex,
        payload.timezoneOffsetMinutes
      );
      if (debug) {
        console.log("Context prompt:", contextPrompt);
      }
      const contextStart = Date.now();
      const contextAnswer = await callGemini(apiKey, model, contextPrompt);
      const contextMs = Date.now() - contextStart;
      if (debug) {
        console.log("Context raw response:", contextAnswer);
        console.log("Context timing:", formatTiming(contextMs));
        console.log("Chat timings:", timings);
      }
      const finalAnswer = formatAnswer(contextAnswer, question);
      void logQuestionAnswer(supabase, normalizedQuestion, finalAnswer);
      const extraOverhead =
        showTiming
          ? `Overhead parse ${formatTiming(timings.parseRequestMs)}, auth ${formatTiming(timings.authMs)}, games ${formatTiming(timings.loadGamesMs)}, sessions ${formatTiming(timings.loadSessionsMs)}, build ${formatTiming(timings.buildIndexMs)}`
          : "";
      const extraMeta =
        showTiming ? `Context ${formatTiming(contextMs)}` : "";
      const combinedMeta = [buildAnswerMeta("context", startedAt, showMethod, showTiming), extraMeta, extraOverhead]
        .filter(Boolean)
        .join(showTiming && extraMeta ? " · " : "");
      return {
        answer: finalAnswer,
        meta: combinedMeta || buildAnswerMeta("context", startedAt, showMethod, showTiming)
      };
    } catch (error) {
      onlineErrors.push(
        error instanceof Error ? error.message : "Context mode failed."
      );
      return null;
    }
  };

  if (chatMode === "sql") {
    const sqlAttempt = await attemptSql();
    if (sqlAttempt) {
      return NextResponse.json({
        answer: sqlAttempt.answer,
        meta: sqlAttempt.meta,
        scope
      });
    }
  } else if (chatMode === "context") {
    const contextAttempt = await attemptContext();
    if (contextAttempt) {
      return NextResponse.json({
        answer: contextAttempt.answer,
        meta: contextAttempt.meta,
        scope
      });
    }
  } else {
    const sqlAttempt = await attemptSql();
    if (sqlAttempt) {
      return NextResponse.json({
        answer: sqlAttempt.answer,
        meta: sqlAttempt.meta,
        scope
      });
    }
    const contextAttempt = await attemptContext();
    if (contextAttempt) {
      return NextResponse.json({
        answer: contextAttempt.answer,
        meta: contextAttempt.meta,
        scope
      });
    }
  }

  const onlineError =
    onlineErrors.length > 0
      ? onlineErrors.join(" ")
      : "Chat failed.";
  const debugError = process.env.CHAT_DEBUG === "true";
  const selectionLabel = buildSelectionLabel(
    selectedNumbers,
    localTimeFilter,
    selectedSessionLabels
  );
  const shortcut = tryShortcut(
    question,
    offlineGames,
    summaryOffline,
    frameStatsOffline,
    selectedFrames,
    hasTimeFilter,
    selectionLabel,
    selectedSessionLabels
  );
  const offlineAnswer =
    shortcut.handled && shortcut.answer
      ? applyOfflineBold(ensureSentence(shortcut.answer))
      : "Offline mode could not answer this question with basic stats.";
  const finalOfflineAnswer = formatOfflineAnswer(offlineAnswer);
  void logQuestionAnswer(supabase, normalizedQuestion, finalOfflineAnswer);
  return NextResponse.json({
    onlineError: debugError ? onlineError : summarizeOnlineError(onlineError),
    offlineAnswer: finalOfflineAnswer,
    offlineMeta: buildAnswerMeta("offline", startedAt, showMethod, showTiming),
    offlineNote:
      "This response was done offline so it can't handle complex questions and may be wrong.",
    scope
  });
}
