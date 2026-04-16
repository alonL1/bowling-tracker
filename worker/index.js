const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const exifr = require("exifr");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const DEFAULT_MAX_JOBS_PER_RUN = 6;
const DEFAULT_MAX_RUN_DURATION_MS = 240000;

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

requireEnv(process.env.WORKER_AUTH_TOKEN, "WORKER_AUTH_TOKEN");

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function cleanJson(text) {
  return text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
}

function toNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOffsetMinutes(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    const hours = Number(value[0]);
    const minutes = Number(value[1] ?? 0);
    if (!Number.isFinite(hours)) {
      return null;
    }
    return hours * 60 + (Number.isFinite(minutes) ? minutes : 0);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value * 60 : null;
  }
  const match = String(value).trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return sign * (hours * 60 + minutes);
}

function getLocalParts(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return {
      year: value.getFullYear(),
      month: value.getMonth(),
      day: value.getDate(),
      hour: value.getHours(),
      minute: value.getMinutes(),
      second: value.getSeconds()
    };
  }
  const normalized = String(value)
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10) - 1,
    day: Number.parseInt(match[3], 10),
    hour: match[4] ? Number.parseInt(match[4], 10) : 0,
    minute: match[5] ? Number.parseInt(match[5], 10) : 0,
    second: match[6] ? Number.parseInt(match[6], 10) : 0
  };
}

function toUtcIsoFromExif(value, offsetMinutes) {
  if (offsetMinutes === null || offsetMinutes === undefined) {
    return null;
  }
  const parts = getLocalParts(value);
  if (!parts) {
    return null;
  }
  const baseUtc = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return new Date(baseUtc - offsetMinutes * 60000).toISOString();
}

function normalizeOptionalTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeOptionalUuid(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") {
    return null;
  }
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }
  return trimmed;
}

async function extractCapturedAtFromExif(buffer, fallbackOffsetMinutes) {
  try {
    const data = await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "DateTimeDigitized",
        "ModifyDate",
        "OffsetTimeOriginal",
        "OffsetTime",
        "OffsetTimeDigitized",
        "TimeZoneOffset"
      ]
    });
    if (!data) {
      return null;
    }
    const offsetMinutes =
      parseOffsetMinutes(
        data.OffsetTimeOriginal ||
          data.OffsetTime ||
          data.OffsetTimeDigitized ||
          data.TimeZoneOffset
      ) ?? fallbackOffsetMinutes;
    const candidates = [
      data.DateTimeOriginal,
      data.CreateDate,
      data.DateTimeDigitized,
      data.ModifyDate
    ];
    for (const candidate of candidates) {
      const parsed = toUtcIsoFromExif(candidate, offsetMinutes);
      if (parsed) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("EXIF parse failed:", error);
  }
  return null;
}

function computeStrike(shot1) {
  return shot1 === 10;
}

function computeSpare(shot1, shot2) {
  return shot1 !== 10 && shot1 + shot2 === 10;
}

function parsePlayerNames(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizePlayerKey(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function clampPins(value, maxPins) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.max(0, Math.min(10, Math.trunc(value)));
  return Math.min(rounded, Math.max(0, maxPins));
}

function normalizeLiveFrameShots(frameNumber, shots) {
  const shot1 = clampPins(shots[0] ?? null, 10);
  const shot2Raw = shots[1] ?? null;
  const shot3Raw = shots[2] ?? null;

  if (frameNumber < 10) {
    if (shot1 === 10) {
      return [10, null, null];
    }
    const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
    return [shot1, shot2, null];
  }

  if (shot1 === 10) {
    const shot2 = clampPins(shot2Raw, 10);
    const shot3 = clampPins(
      shot3Raw,
      shot2 !== null && shot2 < 10 ? 10 - shot2 : 10
    );
    return [shot1, shot2, shot3];
  }

  const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
  const canHaveThird =
    shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10;
  const shot3 = canHaveThird ? clampPins(shot3Raw, 10) : null;
  return [shot1, shot2, shot3];
}

function getLiveRollsForFrame(frame) {
  if (frame.frame < 10) {
    if (frame.shots[0] === 10) {
      return [10];
    }
    return [frame.shots[0], frame.shots[1]];
  }
  return [frame.shots[0], frame.shots[1], frame.shots[2]];
}

function collectNextLiveRolls(frames, fromFrame, needed) {
  const rolls = [];
  for (let frameNumber = fromFrame; frameNumber <= 10; frameNumber += 1) {
    const frame = frames.find((entry) => entry.frame === frameNumber);
    if (!frame) {
      continue;
    }
    for (const roll of getLiveRollsForFrame(frame)) {
      if (typeof roll !== "number") {
        continue;
      }
      rolls.push(roll);
      if (rolls.length === needed) {
        return rolls;
      }
    }
  }
  return null;
}

function computeLiveFrameScores(frames) {
  return Array.from({ length: 10 }, (_, index) => {
    const frameNumber = index + 1;
    const frame = frames.find((entry) => entry.frame === frameNumber);
    if (!frame) {
      return null;
    }
    const [shot1, shot2, shot3] = frame.shots;

    if (frameNumber < 10) {
      if (shot1 === null) {
        return null;
      }
      if (shot1 === 10) {
        const bonus = collectNextLiveRolls(frames, frameNumber + 1, 2);
        if (!bonus) {
          return null;
        }
        return 10 + bonus[0] + bonus[1];
      }
      if (shot2 === null) {
        return null;
      }
      if (shot1 + shot2 === 10) {
        const bonus = collectNextLiveRolls(frames, frameNumber + 1, 1);
        if (!bonus) {
          return null;
        }
        return 10 + bonus[0];
      }
      return shot1 + shot2;
    }

    if (shot1 === null || shot2 === null) {
      return null;
    }
    if (shot1 === 10 || shot1 + shot2 === 10) {
      if (shot3 === null) {
        return null;
      }
      return shot1 + shot2 + shot3;
    }
    return shot1 + shot2;
  });
}

function computeLiveTotalScore(frames) {
  const frameScores = computeLiveFrameScores(frames);
  if (frameScores.some((score) => score === null)) {
    return null;
  }
  return frameScores.reduce((sum, score) => sum + (score ?? 0), 0);
}

function normalizeLivePlayers(players) {
  const normalizedPlayers = (Array.isArray(players) ? players : [])
    .map((player, playerIndex) => {
      const sourceName =
        typeof player?.playerName === "string" ? player.playerName.trim() : "";
      const playerName = sourceName || `Player ${playerIndex + 1}`;
      const frameMap = new Map();

      (Array.isArray(player?.frames) ? player.frames : []).forEach((frame, frameIndex) => {
        const frameNumber =
          typeof frame?.frame === "number" && Number.isFinite(frame.frame)
            ? Math.max(1, Math.min(10, Math.trunc(frame.frame)))
            : frameIndex + 1;
        frameMap.set(frameNumber, frame);
      });

      const normalizedFrames = Array.from({ length: 10 }, (_, index) => {
        const frameNumber = index + 1;
        const frame = frameMap.get(frameNumber);
        return {
          frame: frameNumber,
          shots: normalizeLiveFrameShots(
            frameNumber,
            Array.isArray(frame?.shots) ? frame.shots.map(toNullableNumber) : []
          )
        };
      });

      return {
        playerName,
        playerKey: normalizePlayerKey(playerName),
        totalScore: toNullableNumber(player?.totalScore) ?? computeLiveTotalScore(normalizedFrames),
        frames: normalizedFrames
      };
    })
    .filter((player) => player.playerName.trim().length > 0);

  const duplicateCounts = new Map();
  return normalizedPlayers.map((player) => {
    const baseKey = normalizePlayerKey(player.playerName);
    const nextCount = (duplicateCounts.get(baseKey) || 0) + 1;
    duplicateCounts.set(baseKey, nextCount);
    if (nextCount === 1) {
      return player;
    }

    const playerName = `${player.playerName}(${nextCount})`;
    return {
      ...player,
      playerName,
      playerKey: normalizePlayerKey(playerName)
    };
  });
}

function serializeLivePlayers(players) {
  return {
    players: players.map((player) => ({
      playerName: player.playerName,
      totalScore: player.totalScore,
      frames: player.frames.map((frame) => ({
        frame: frame.frame,
        shots: [...frame.shots]
      }))
    }))
  };
}

function buildLivePrompt() {
  return `// SYSTEM INSTRUCTIONS
You are a precision OCR agent specializing in bowling scoreboards.
Extract the full scoreboard for every visible player row, not just one player.

// CONTEXT & SCHEMA
<schema>
{
  "players": [
    {
      "playerName": string,
      "totalScore": number | null,
      "frames": [
        { "frame": number, "shots": [number|null, number|null, number|null] }
      ]
    }
  ]
}
</schema>

// EXTRACTION RULES
<rules>
1. Include every clearly visible player row exactly once.
2. Convert "X" to 10, "/" to the pins needed for a spare, and "-" or "G" to 0.
3. Return up to 3 shots for frame 10 and up to 2 shots for frames 1-9.
4. Use the board's cumulative totals to resolve ambiguous frame marks whenever possible.
5. If a shot is unreadable, return null for that shot instead of inventing a value.
6. If a player row is partially visible but clearly belongs to the scoreboard, include it anyway.
</rules>

// TASK
Analyze the image and return ONLY the JSON object. Do not include markdown or commentary.
`;
}

function resolveThinkingConfig(mode) {
  if (!mode) {
    return null;
  }
  const normalized = String(mode).trim().toLowerCase();
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

async function setLiveSessionGameStatus(
  supabase,
  liveSessionGameId,
  status,
  extras = {}
) {
  if (!liveSessionGameId) {
    return;
  }
  await supabase
    .from("live_session_games")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extras
    })
    .eq("id", liveSessionGameId);
}

async function setRecordingDraftGameStatus(
  supabase,
  recordingDraftGameId,
  status,
  extras = {}
) {
  if (!recordingDraftGameId) {
    return;
  }
  await supabase
    .from("recording_draft_games")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extras
    })
    .eq("id", recordingDraftGameId);
}

async function setJobError(
  supabase,
  jobId,
  gameId,
  liveSessionGameId,
  recordingDraftGameId,
  message
) {
  console.error(`Job ${jobId} failed: ${message}`);
  const jobUpdate = {
    status: "error",
    last_error: message,
    updated_at: new Date().toISOString()
  };
  if (gameId) {
    jobUpdate.game_id = gameId;
  }
  await supabase
    .from("analysis_jobs")
    .update(jobUpdate)
    .eq("id", jobId);

  if (gameId) {
    await supabase
      .from("games")
      .update({ status: "error" })
      .eq("id", gameId);
  }

  if (liveSessionGameId) {
    await setLiveSessionGameStatus(supabase, liveSessionGameId, "error", {
      last_error: message
    });
  }

  if (recordingDraftGameId) {
    await setRecordingDraftGameStatus(supabase, recordingDraftGameId, "error", {
      last_error: message
    });
  }
}

async function removeGame(supabase, gameId) {
  if (!gameId) {
    return;
  }
  await supabase.from("games").delete().eq("id", gameId);
}

async function processJob() {
  requireEnv(process.env.SUPABASE_URL, "SUPABASE_URL");
  requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  requireEnv(process.env.GEMINI_API_KEY, "GEMINI_API_KEY");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data: jobs, error: jobError } = await supabase.rpc("claim_next_job");

  if (jobError) {
    throw new Error(`Failed to claim job: ${jobError.message}`);
  }

  if (!jobs || jobs.length === 0) {
    console.log("No queued jobs.");
    return { status: "empty" };
  }

  const job = jobs[0];
  const jobType =
    job.job_type === "live_session"
      ? "live_session"
      : job.job_type === "recording_draft"
        ? "recording_draft"
        : null;
  const playerName = job.player_name;
  const playerNames = parsePlayerNames(playerName);
  const playerLabel =
    playerNames.length > 0 ? playerNames.join(", ") : String(playerName || "");
  const userId = normalizeOptionalUuid(job.user_id);
  const sessionId = normalizeOptionalUuid(job.session_id);
  const liveSessionGameId = normalizeOptionalUuid(job.live_session_game_id);
  const recordingDraftGameId = normalizeOptionalUuid(job.recording_draft_game_id);
  const capturedAtHint = normalizeOptionalTimestamp(job.captured_at_hint);
  if (job.user_id && !userId) {
    console.warn(`Job ${job.id} has invalid user_id:`, job.user_id);
  }
  if (job.session_id && !sessionId) {
    console.warn(`Job ${job.id} has invalid session_id:`, job.session_id);
  }
  if (jobType === "live_session" && liveSessionGameId) {
    await setLiveSessionGameStatus(supabase, liveSessionGameId, "processing", {
      last_error: null
    });
  }
  if (jobType === "recording_draft" && recordingDraftGameId) {
    await setRecordingDraftGameStatus(supabase, recordingDraftGameId, "processing", {
      last_error: null
    });
  }
  if (!jobType) {
    await setJobError(
      supabase,
      job.id,
      null,
      null,
      null,
      "Legacy standard scoreboard analysis is no longer supported. Re-upload the scoreboard using the current app."
    );
    return { status: "error", jobId: job.id };
  }
  if (jobType !== "live_session" && !playerName) {
    await setJobError(supabase, job.id, null, null, recordingDraftGameId, "Job missing player name.");
    return { status: "error", jobId: job.id };
  }
  if (jobType === "live_session" && !liveSessionGameId) {
    await setJobError(
      supabase,
      job.id,
      null,
      null,
      null,
      "Live-session job missing live_session_game_id."
    );
    return { status: "error", jobId: job.id };
  }
  if (jobType === "recording_draft" && !recordingDraftGameId) {
    await setJobError(
      supabase,
      job.id,
      null,
      null,
      null,
      "Recording-draft job missing recording_draft_game_id."
    );
    return { status: "error", jobId: job.id };
  }
  console.log(
    jobType === "live_session"
      ? `Claimed live-session job ${job.id}.`
      : jobType === "recording_draft"
        ? `Claimed recording-draft job ${job.id}.`
      : `Claimed job ${job.id} for ${playerLabel}.`
  );

  const { data: imageData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(job.storage_key);

  if (downloadError || !imageData) {
    await setJobError(
      supabase,
      job.id,
      null,
      liveSessionGameId,
      recordingDraftGameId,
      downloadError?.message || "Failed to download image."
    );
    return { status: "error", jobId: job.id };
  }

  const arrayBuffer = await imageData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const thinkingConfig = resolveThinkingConfig(process.env.WORKER_THINKING_MODE);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      ...(thinkingConfig ? { thinkingConfig } : {})
    }
  });

  let extraction;
  try {
    const result = await model.generateContent([
      {
        text:
          buildLivePrompt()
      },
      {
        inlineData: {
          mimeType: imageData.type || "image/jpeg",
          data: base64
        }
      }
    ]);

    const responseText = result.response.text();
    extraction = JSON.parse(cleanJson(responseText));
  } catch (error) {
    await setJobError(
      supabase,
      job.id,
      null,
      liveSessionGameId,
      recordingDraftGameId,
      error instanceof Error ? error.message : "Gemini extraction failed."
    );
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const rawOffset = job.timezone_offset_minutes;
  const parsedOffset =
    typeof rawOffset === "string" ? Number.parseInt(rawOffset, 10) : rawOffset;
  const jobOffset = Number.isFinite(parsedOffset) ? parsedOffset : null;
  const fallbackOffsetMinutes =
    jobOffset !== null ? -jobOffset : null;
  const capturedAt =
    (await extractCapturedAtFromExif(buffer, fallbackOffsetMinutes)) ||
    capturedAtHint;

  if (jobType === "live_session" || jobType === "recording_draft") {
    const normalizedPlayers = normalizeLivePlayers(extraction?.players);
    if (normalizedPlayers.length === 0) {
      await setJobError(
        supabase,
        job.id,
        null,
        liveSessionGameId,
        recordingDraftGameId,
        jobType === "live_session"
          ? "Live-session extraction did not return any player rows."
          : "Recording draft extraction did not return any player rows."
      );
      await supabase.storage.from(BUCKET).remove([job.storage_key]);
      return { status: "error", jobId: job.id };
    }

    const { error: liveGameUpdateError } = await supabase
      .from(jobType === "live_session" ? "live_session_games" : "recording_draft_games")
      .update({
        status: "ready",
        extraction: serializeLivePlayers(normalizedPlayers),
        captured_at: capturedAt,
        sort_at:
          jobType === "recording_draft"
            ? capturedAt || capturedAtHint || new Date().toISOString()
            : undefined,
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", jobType === "live_session" ? liveSessionGameId : recordingDraftGameId);

    if (liveGameUpdateError) {
      await setJobError(
        supabase,
        job.id,
        null,
        liveSessionGameId,
        recordingDraftGameId,
        liveGameUpdateError.message ||
          (jobType === "live_session"
            ? "Failed to update live session game."
            : "Failed to update recording draft game.")
      );
      await supabase.storage.from(BUCKET).remove([job.storage_key]);
      return { status: "error", jobId: job.id };
    }

    await supabase
      .from("analysis_jobs")
      .update({
        status: "logged",
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);

    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    console.log(
      jobType === "live_session"
        ? `Live-session job ${job.id} complete for ${liveSessionGameId}.`
        : `Recording-draft job ${job.id} complete for ${recordingDraftGameId}.`
    );
    return jobType === "live_session"
      ? { status: "logged", jobId: job.id, liveSessionGameId }
      : { status: "logged", jobId: job.id, recordingDraftGameId };
  }

  const frames = Array.isArray(extraction?.frames) ? extraction.frames : [];
  const extractedName =
    typeof extraction?.playerName === "string"
      ? extraction.playerName.trim()
      : "";
  const resolvedPlayerName =
    extractedName || playerNames[0] || String(playerName || "");
  const totalScore = toNullableNumber(extraction?.totalScore);
  const playedAt = capturedAt || new Date().toISOString();

  const { data: createdGame, error: createError } = await supabase
    .from("games")
    .insert({
      player_name: resolvedPlayerName,
      total_score: totalScore,
      captured_at: capturedAt,
      played_at: playedAt,
      raw_extraction: extraction,
      status: "processing",
      user_id: userId,
      session_id: sessionId
    })
    .select("id")
    .single();

  if (createError || !createdGame) {
    await setJobError(
      supabase,
      job.id,
      null,
      null,
      null,
      createError?.message || "Failed to create game."
    );
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const gameId = createdGame.id;

  const { error: jobLinkError } = await supabase
    .from("analysis_jobs")
    .update({ game_id: gameId, updated_at: new Date().toISOString() })
    .eq("id", job.id);
  if (jobLinkError) {
    console.warn(`Failed to link game ${gameId} to job ${job.id}:`, jobLinkError.message);
  }

  if (sessionId) {
    const { data: sessionRow, error: sessionError } = await supabase
      .from("bowling_sessions")
      .select("started_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      console.warn("Failed to load session for started_at:", sessionError.message);
    } else if (sessionRow) {
      const currentStart = sessionRow.started_at
        ? Date.parse(sessionRow.started_at)
        : null;
      const nextStart = Date.parse(playedAt);
      if (Number.isFinite(nextStart)) {
        if (!currentStart || nextStart < currentStart) {
          const { error: updateError } = await supabase
            .from("bowling_sessions")
            .update({ started_at: new Date(nextStart).toISOString() })
            .eq("id", sessionId);
          if (updateError) {
            console.warn(
              "Failed to update session started_at:",
              updateError.message
            );
          }
        }
      }
    }
  }

  const frameRows = frames.map((frame) => {
    const shot1 = toNullableNumber(frame?.shots?.[0]);
    const shot2 = toNullableNumber(frame?.shots?.[1]);
    return {
      game_id: gameId,
      frame_number: toNullableNumber(frame.frame),
      is_strike: computeStrike(shot1),
      is_spare: shot1 !== null && shot2 !== null ? computeSpare(shot1, shot2) : false,
      frame_score: null
    };
  });

  let insertedFrames = [];
  if (frameRows.length > 0) {
    const { data: inserted, error: frameError } = await supabase
      .from("frames")
      .insert(frameRows)
      .select("id,frame_number");

    if (frameError) {
      await removeGame(supabase, gameId);
      await setJobError(supabase, job.id, null, null, null, frameError.message);
      await supabase.storage.from(BUCKET).remove([job.storage_key]);
      return { status: "error", jobId: job.id };
    }
    insertedFrames = inserted || [];
  }

  const frameIdByNumber = new Map(
    insertedFrames.map((frame) => [frame.frame_number, frame.id])
  );

  const shotRows = [];
  for (const frame of frames) {
    const frameNumber = toNullableNumber(frame.frame);
    const frameId = frameIdByNumber.get(frameNumber);
    if (!frameId) {
      continue;
    }
    const shots = Array.isArray(frame.shots) ? frame.shots : [];
    shots.forEach((shot, index) => {
      shotRows.push({
        frame_id: frameId,
        shot_number: index + 1,
        pins: toNullableNumber(shot)
      });
    });
  }

  if (shotRows.length > 0) {
    const { error: shotError } = await supabase.from("shots").insert(shotRows);
    if (shotError) {
      await removeGame(supabase, gameId);
      await setJobError(supabase, job.id, null, null, null, shotError.message);
      await supabase.storage.from(BUCKET).remove([job.storage_key]);
      return { status: "error", jobId: job.id };
    }
  }

  const { error: gameUpdateError } = await supabase
    .from("games")
    .update({
      total_score: totalScore,
      raw_extraction: extraction,
      status: "logged"
    })
    .eq("id", gameId);

  if (gameUpdateError) {
    await removeGame(supabase, gameId);
    await setJobError(supabase, job.id, null, null, null, gameUpdateError.message);
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  await supabase
    .from("analysis_jobs")
    .update({
      status: "logged",
      updated_at: new Date().toISOString(),
      game_id: gameId
    })
    .eq("id", job.id);

  await supabase.storage.from(BUCKET).remove([job.storage_key]);

  console.log(`Job ${job.id} complete for game ${gameId}.`);
  return { status: "logged", jobId: job.id, gameId };
}

async function processJobBatch() {
  const maxJobsPerRun = parsePositiveInteger(
    process.env.MAX_JOBS_PER_RUN,
    DEFAULT_MAX_JOBS_PER_RUN
  );
  const maxRunDurationMs = parsePositiveInteger(
    process.env.MAX_RUN_DURATION_MS,
    DEFAULT_MAX_RUN_DURATION_MS
  );
  const startedAt = Date.now();
  const results = [];

  for (let index = 0; index < maxJobsPerRun; index += 1) {
    if (Date.now() - startedAt >= maxRunDurationMs) {
      console.log(
        `Stopping batch after ${results.length} job(s): hit ${maxRunDurationMs}ms budget.`
      );
      break;
    }

    const result = await processJob();
    if (result.status === "empty") {
      break;
    }
    results.push(result);
  }

  if (results.length === 0) {
    return {
      status: "empty",
      processedCount: 0,
      loggedCount: 0,
      errorCount: 0,
      results
    };
  }

  const loggedCount = results.filter((result) => result.status === "logged").length;
  const errorCount = results.filter((result) => result.status === "error").length;

  console.log(
    `Batch complete: processed ${results.length} job(s), logged ${loggedCount}, errors ${errorCount}.`
  );

  return {
    status: "processed",
    processedCount: results.length,
    loggedCount,
    errorCount,
    results
  };
}

app.all("/run", async (req, res) => {
  const token = req.header("x-worker-token");
  if (!token || token !== process.env.WORKER_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const result = await processJobBatch();
    if (result.status === "empty") {
      return res.status(204).send();
    }
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker failed.";
    console.error("Worker error:", message);
    return res.status(500).json({ error: message });
  }
});

app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`Worker listening on port ${PORT}`);
});
