const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const exifr = require("exifr");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
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

function toNullableTimestamp(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const normalized = String(value).replace(
    /^(\d{4}):(\d{2}):(\d{2})/,
    "$1-$2-$3"
  );
  const parsed = new Date(normalized);
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
  return trimmed;
}

async function extractCapturedAtFromExif(buffer) {
  try {
    const data = await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "DateTimeDigitized",
        "ModifyDate"
      ]
    });
    if (!data) {
      return null;
    }
    const candidates = [
      data.DateTimeOriginal,
      data.CreateDate,
      data.DateTimeDigitized,
      data.ModifyDate
    ];
    for (const candidate of candidates) {
      const parsed = toNullableTimestamp(candidate);
      if (parsed) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("EXIF parse failed:", error);
  }
  return null;
}

function escapeLiteral(text) {
  return text.replace(/'/g, "''");
}

async function getNextGameName(supabase, userId) {
  const condition = userId
    ? `user_id = '${escapeLiteral(userId)}'`
    : "user_id is null";
  const sql = `
    select coalesce(max((substring(lower(game_name) from '^game\\s+([0-9]+)$'))::int), 0) as max_suffix
    from games
    where ${condition}
  `;
  const { data, error } = await supabase.rpc("execute_sql", { query: sql });
  if (error) {
    throw new Error(error.message || "Failed to generate game name.");
  }
  const rows = typeof data === "string" ? JSON.parse(data) : data;
  const maxSuffix = Number.isFinite(rows?.[0]?.max_suffix)
    ? rows[0].max_suffix
    : 0;
  return `Game ${maxSuffix + 1}`;
}

function computeStrike(shot1) {
  return shot1 === 10;
}

function computeSpare(shot1, shot2) {
  return shot1 !== 10 && shot1 + shot2 === 10;
}

function buildPrompt(playerName) {
  // prompt for scoreboard extraction
  // You are analyzing a bowling scoreboard photo.
  // Focus only on the row for the player named "*player name*".
  // Return strict JSON with this schema and no extra text:
  // {
  //   "playerName": string,
  //   "totalScore": number | null,
  //   "frames": [
  //     { "frame": number, "shots": [number|null, number|null, number|null] }
  //   ]
  // }
  // Rules:
  // - Frames 1-9 have up to 2 shots; frame 10 can have up to 3.
  // - If a shot is unclear, keep a short list of likely candidates, then use totalScore math (bowling scoring) to resolve.
  // - Use the per-frame score column if visible to validate shots (e.g., frame shows 18 so shots are likely 9 and 9).
  // - Use null for any unreadable shot.
  return `// SYSTEM INSTRUCTIONS
You are a precision OCR agent specializing in sports data.
Your goal is to extract bowling frame data for the player "${playerName}" with 100% mathematical accuracy.

// CONTEXT & SCHEMA
<schema>
{
  "playerName": string,
  "totalScore": number,
  "frames": [
    { "frame": number, "shots": [number|null, number|null, number|null] }
  ]
}
</schema>

// EXTRACTION RULES
<rules>
1. FOCUS: Only extract data for the row belonging to "${playerName}".
2. SYMBOLS: Convert "/" to the number of pins needed for a spare, "X" to 10, and "-" or "G" to 0.
3. MATH VALIDATION: Use the "Cumulative Score" or "Total Score" columns as ground truth.
   - Before outputting, calculate the sum of the frames using standard bowling rules.
   - If your calculated total does not match the board's total, re-read the individual shots.
4. FRAME 10: Ensure you capture all 3 potential shots.
</rules>

// TASK
Analyze the image. Perform a internal "Chain of Thought" math check.
Return ONLY the JSON object. Do not include conversational text or markdown code blocks.
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

async function setJobError(supabase, jobId, gameId, message) {
  console.error(`Job ${jobId} failed: ${message}`);
  await supabase
    .from("analysis_jobs")
    .update({ status: "error", last_error: message, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (gameId) {
    await supabase
      .from("games")
      .update({ status: "error" })
      .eq("id", gameId);
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
  const playerName = job.player_name;
  const userId = normalizeOptionalUuid(job.user_id);
  if (!playerName) {
    await setJobError(supabase, job.id, null, "Job missing player name.");
    return { status: "error", jobId: job.id };
  }
  console.log(`Claimed job ${job.id} for ${playerName}.`);

  const { data: imageData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(job.storage_key);

  if (downloadError || !imageData) {
    await setJobError(
      supabase,
      job.id,
      null,
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
    // prompt for scoreboard extraction
    const result = await model.generateContent([
      { text: buildPrompt(playerName) },
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
      error instanceof Error ? error.message : "Gemini extraction failed."
    );
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const frames = Array.isArray(extraction?.frames) ? extraction.frames : [];
  const capturedAt = await extractCapturedAtFromExif(buffer);
  const totalScore = toNullableNumber(extraction?.totalScore);

  let gameName = "Game 1";
  try {
    gameName = await getNextGameName(supabase, userId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate game name.";
    await setJobError(supabase, job.id, null, message);
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const { data: createdGame, error: createError } = await supabase
    .from("games")
    .insert({
      game_name: gameName,
      player_name: playerName,
      total_score: totalScore,
      captured_at: capturedAt,
      played_at: capturedAt || new Date().toISOString(),
      raw_extraction: extraction,
      status: "processing",
      user_id: userId
    })
    .select("id")
    .single();

  if (createError || !createdGame) {
    await setJobError(
      supabase,
      job.id,
      null,
      createError?.message || "Failed to create game."
    );
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const gameId = createdGame.id;

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
      await setJobError(supabase, job.id, null, frameError.message);
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
      await setJobError(supabase, job.id, null, shotError.message);
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
    await setJobError(supabase, job.id, null, gameUpdateError.message);
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

app.all("/run", async (req, res) => {
  const expectedToken = process.env.WORKER_AUTH_TOKEN;
  if (expectedToken) {
    const token = req.header("x-worker-token");
    if (!token || token !== expectedToken) {
      return res.status(401).json({ error: "Unauthorized." });
    }
  }

  try {
    const result = await processJob();
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
