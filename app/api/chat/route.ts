import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
  game_name?: string | null;
  player_name: string;
  total_score: number | null;
  played_at?: string | null;
  created_at?: string;
  frames?: Frame[];
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
  empty?: boolean;
  answer?: string;
  error?: string;
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
  frameStats: unknown
) {
  // prompt for summary-based answer
  // You are a bowling stats assistant. Answer the question using only the JSON data below.
  // If the data does not include the answer, say so briefly.
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // Scope: *scope*
  // Summary JSON:
  // *summary json*
  //
  // Game Index:
  // *game index*
  //
  // Selection:
  // *selection*
  //
  // Frame Aggregates:
  // *frame aggregates*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant. Answer the question using only the JSON data below.
If the data does not include the answer, say so briefly.
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n.".
If a response is null, instead of using the word "null" use language such as "You have no games x to y"

Scope: ${scope}
Summary JSON:
${JSON.stringify(summary, null, 2)}

Game Index:
${JSON.stringify(index, null, 2)}

Selection:
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
  timezoneOffsetMinutes?: number
) {
  // prompt for context-based answer
  // You are a bowling stats assistant. Use the JSON context to answer.
  // If the answer is not present, say so briefly.
  // All timestamps are UTC. The user's timezone offset (minutes from UTC) is *timezone offset*.
  // If you mention times, convert them to the user's local time.
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // Do not mention query limits.
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // Scope: *scope*
  // Selection:
  // *selection*
  //
  // Context:
  // *context*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant. Use the JSON context to answer.
If the answer is not present, say so briefly.
All timestamps are UTC. The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
If you mention times, convert them to the user's local time.
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n."
Do not mention query limits.
If a response is null, instead of using the word "null" use language such as "You have no games x to y"

Scope: ${scope}
Selection:
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
  timezoneOffsetMinutes?: number
) {
  // prompt for SQL generation
  // You are writing a single SQL SELECT query to answer a bowling stats question.
  // Return JSON only with this schema: {"sql": string|null, "explanation": string}.
  // - Only SELECT statements.
  // - Use table and column names exactly as defined.
  // - If you cannot answer, set sql to null and explain.
  // - The game index already reflects any time filters; only use games listed below.
  // - The user's timezone offset (minutes from UTC) is *timezone offset*.
  // - Times mentioned in the question are in the user's local time unless explicitly stated otherwise; convert to UTC for querying.
  // - local time - *timezone offset* = UTC.
  //
  // Schema:
  // *schema*
  //
  // Game Index:
  // *game index*
  //
  // Question: *question*
  return `You are writing a single SQL SELECT query to answer a bowling stats question.
Return JSON only with this schema: {"sql": string|null, "explanation": string}.
- Only SELECT statements.
- Use table and column names exactly as defined.
- If you cannot answer, set sql to null and explain.
- The game index already reflects any time filters; only use games listed below.
- The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
- Times mentioned in the question are in the user's local time unless explicitly stated otherwise; convert to UTC for querying.
- local time - ${timezoneOffsetMinutes ?? "unknown"} = UTC.

Schema:
${schema}

Game Index:
${JSON.stringify(index, null, 2)}

Question: ${question}`;
}

function buildSqlAnswerPrompt(
  question: string,
  sql: string,
  results: unknown,
  timezoneOffsetMinutes?: number
) {
  // prompt for SQL answer generation
  // You are a bowling stats assistant. Use the SQL and results JSON to answer.
  // All timestamps in the results are UTC. The user's timezone offset (minutes from UTC) is *timezone offset*.
  // If you mention times, convert them to the user's local time.
  // Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
  // Answer with a direct response. Do not include "Answer:".
  // Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
  // should be answered similarly to "Your average score across across games x to y is n."
  // If a response is null, instead of using the word "null" use language such as "You have no games x to y"
  //
  // SQL:
  // *sql*
  //
  // Results JSON:
  // *results json*
  //
  // Question: *question*
  // Answer:
  return `You are a bowling stats assistant. Use the SQL and results JSON to answer.
All timestamps in the results are UTC. The user's timezone offset (minutes from UTC) is ${timezoneOffsetMinutes ?? "unknown"}.
If you mention times, convert them to the user's local time.
Only use markdown for bold (**). Bold the actual answer values (including multiple items if listed). Do not use any other markdown.
Answer with a direct response. Do not include "Answer:".
Include just enough context in the answer but keep it consise, for example "What is my average score across games x to y",
should be answered similarly to "Your average score across across games x to y is n."
If a response is null, instead of using the word "null" use language such as "You have no games x to y"

SQL:
${sql}

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

function mapNumbersToNames(numbers: number[]) {
  return numbers.map((value) => `Game ${value}`);
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
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  text = lines.join(" ").replace(/\s+/g, " ").trim();
  return text;
}

function formatAnswer(raw: string, question: string) {
  const sanitized = sanitizeAnswer(raw, question);
  const withoutNulls = sanitized.replace(/\bnull\b/gi, "n/a");
  return ensureSentence(withoutNulls);
}

function formatOfflineAnswer(text: string) {
  const withoutNulls = text.replace(/\bnull\b/gi, "n/a");
  return ensureSentence(withoutNulls);
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
  supabase: ReturnType<typeof createClient>,
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

function buildSelectionLabel(
  selectedGameNumbers: number[],
  localTimeFilter: TimeFilter
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
  return null;
}

function tryShortcut(
  question: string,
  selectedGames: OrderedGame[],
  summary: ReturnType<typeof summarizeGames>,
  frameStats: FrameAggregate[],
  selectedFrames: number[],
  hasTimeFilter: boolean,
  selectionLabel: string | null
) {
  const lower = question.toLowerCase();
  const includesAverage = lower.includes("average") || lower.includes("avg");
  const scopeSuffix = selectionLabel ? ` on ${selectionLabel}` : "";

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
      answer: `Your average score${scopeSuffix} is **${summary.averageScore}**.`
    };
  }

  if (lower.includes("total score")) {
    const total = selectedGames.reduce(
      (sum, game) => sum + (game.total_score ?? 0),
      0
    );
    return {
      handled: true,
      answer: `Your total score${scopeSuffix} is **${total}**.`
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
      answer: `Your highest score is **${best.total_score}** in **${best.game_name}**.`
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
      answer: `Your lowest score is **${worst.total_score}** in **${worst.game_name}**.`
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
      answer: `Your strike rate${scopeSuffix} is **${formatRate(summary.strikeRate)}**.`
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
      answer: `Your spare rate${scopeSuffix} is **${formatRate(summary.spareRate)}**.`
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
      answer: `Average pins per frame${scopeSuffix}: ${lines.join(", ")}.`
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
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  model: string,
  question: string,
  index: unknown,
  timeFilter: TimeFilter,
  timezoneOffsetMinutes?: number
): Promise<SqlResult> {
  const debug = process.env.CHAT_DEBUG === "true";
  const schema = `games(id uuid, game_name text, player_name text, total_score int, played_at timestamptz, created_at timestamptz, user_id uuid)
frames(id uuid, game_id uuid, frame_number int, is_strike boolean, is_spare boolean)
shots(id uuid, frame_id uuid, shot_number int, pins int)`;

  // prompt for SQL generation
  const sqlPrompt = `${buildSqlPrompt(
    question,
    index,
    schema,
    timezoneOffsetMinutes
  )}`;
  if (debug) {
    console.log("SQL prompt:", sqlPrompt);
  }
  const sqlText = await callGemini(apiKey, model, sqlPrompt, "application/json");
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

  const { data, error } = await supabase.rpc("execute_sql", {
    query: validated.sql
  });

  if (error) {
    if (debug) {
      console.log("SQL execution error:", error);
    }
    return { ok: false, error: error.message || "SQL execution failed." };
  }

  const rows = typeof data === "string" ? safeParseJson(data) : data;
  if (debug) {
    console.log("SQL result rows:", rows);
  }
  if (!rows || (Array.isArray(rows) && rows.length === 0)) {
    return { ok: false, empty: true, error: "No SQL results." };
  }

  // prompt for SQL answer generation
  const answerPrompt = buildSqlAnswerPrompt(
    question,
    validated.sql,
    rows,
    timezoneOffsetMinutes
  );
  if (debug) {
    console.log("SQL answer prompt:", answerPrompt);
  }
  const answerText = await callGemini(apiKey, model, answerPrompt);
  return { ok: true, answer: ensureSentence(answerText || "No response generated.") };
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

  const payload = (await request.json()) as {
    question?: string;
    gameId?: string;
    timezoneOffsetMinutes?: number;
  };

  if (!payload.question) {
    return NextResponse.json(
      { error: "Question is required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
  const normalizedQuestion = normalizeQuestion(payload.question);

  let games: Game[] = [];
  let scope = "all games";

  if (devUserId) {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,game_name,player_name,total_score,played_at,created_at,frames:frames(frame_number,is_strike,is_spare,shots:shots(shot_number,pins))"
      )
      .eq("user_id", devUserId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load games." },
        { status: 500 }
      );
    }

    games = (data as Game[]) || [];
    scope = "all games for the signed-in user";
  } else if (payload.gameId) {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,game_name,player_name,total_score,played_at,created_at,frames:frames(frame_number,is_strike,is_spare,shots:shots(shot_number,pins))"
      )
      .eq("id", payload.gameId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Game not found." },
        { status: 404 }
      );
    }

    games = [data as Game];
    scope = "current game only";
  } else {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,game_name,player_name,total_score,played_at,created_at,frames:frames(frame_number,is_strike,is_spare,shots:shots(shot_number,pins))"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load games." },
        { status: 500 }
      );
    }

    games = (data as Game[]) || [];
    scope = "all games in the system";
  }

  const orderedGames: OrderedGame[] = games
    .slice()
    .sort((a, b) => {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0;
      const bTime = b.created_at ? Date.parse(b.created_at) : 0;
      return aTime - bTime;
    })
    .map((game) => ({
      ...game,
      game_name:
        game.game_name && game.game_name.trim().length > 0
          ? game.game_name
          : "Untitled game"
    }));

  const selectedNumbers = extractGameNumbers(payload.question);
  const selectedNames = mapNumbersToNames(selectedNumbers).map((name) =>
    name.toLowerCase()
  );
  const selectedFrames = extractFrameNumbers(payload.question);
  const selectedGames =
    selectedNames.length > 0
      ? orderedGames.filter((game) =>
          selectedNames.includes(game.game_name.toLowerCase())
        )
      : orderedGames;

  const localTimeFilter = extractTimeFilter(payload.question);
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
  const indexSource =
    selectedNames.length > 0 ? selectedGames : orderedGames;
  const index = indexSource.map((game) => ({
    gameName: game.game_name,
    totalScore: game.total_score,
    playedAt: game.played_at,
    createdAt: game.created_at
  }));
  const selection = {
    selectedGameNumbers: selectedNumbers,
    selectedGameNames: orderedGames
      .filter((game) =>
        selectedNames.includes(game.game_name.toLowerCase())
      )
      .map((game) => game.game_name),
    selectedFrameNumbers: selectedFrames,
    timeFilter,
    timezoneOffsetMinutes: payload.timezoneOffsetMinutes
  };
  const selectionOnline = {
    selectedGameNumbers: selectedNumbers,
    selectedGameNames: selection.selectedGameNames,
    selectedFrameNumbers: selectedFrames
  };

  const onlineErrors: string[] = [];

  const attemptSql = async () => {
    try {
      const sqlResult = await runSqlMethod(
        supabase,
        apiKey,
        model,
        payload.question,
        index,
        timeFilter,
        payload.timezoneOffsetMinutes
      );
      if (sqlResult.ok && sqlResult.answer) {
        const finalAnswer = formatAnswer(sqlResult.answer, payload.question);
        void logQuestionAnswer(supabase, normalizedQuestion, finalAnswer);
        return {
          answer: finalAnswer,
          meta: buildAnswerMeta("sql", startedAt, showMethod, showTiming)
        };
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
      gameName: game.game_name,
      playedAt: game.played_at,
      totalScore: game.total_score,
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

    const contextPayload = {
      truncated: onlineGames.length > contextLimit,
      contextGames,
      summary: summaryOnline,
      frameStats: frameStatsOnline
    };

    try {
      // prompt for context-based answer
    const contextPrompt = buildContextPrompt(
      payload.question,
      scope,
      contextPayload,
      selectionOnline,
      payload.timezoneOffsetMinutes
    );
      const contextAnswer = await callGemini(apiKey, model, contextPrompt);
      const finalAnswer = formatAnswer(contextAnswer, payload.question);
      void logQuestionAnswer(supabase, normalizedQuestion, finalAnswer);
      return {
        answer: finalAnswer,
        meta: buildAnswerMeta("context", startedAt, showMethod, showTiming)
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
    const routed = classifyMethod(payload.question);
    if (routed === "sql") {
      const sqlAttempt = await attemptSql();
      if (sqlAttempt) {
        return NextResponse.json({
          answer: sqlAttempt.answer,
          meta: sqlAttempt.meta,
          scope
        });
      }
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
  const selectionLabel = buildSelectionLabel(selectedNumbers, localTimeFilter);
  const shortcut = tryShortcut(
    payload.question,
    offlineGames,
    summaryOffline,
    frameStatsOffline,
    selectedFrames,
    hasTimeFilter,
    selectionLabel
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
