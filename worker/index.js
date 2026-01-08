const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
  //   "confidence": number,
  //   "frames": [
  //     { "frame": number, "shots": [number|null, number|null, number|null], "confidence": number }
  //   ]
  // }
  // Rules:
  // - Frames 1-9 have up to 2 shots; frame 10 can have up to 3.
  // - Use null for any unreadable shot.
  // - Confidence values should be between 0 and 1.
  return `You are analyzing a bowling scoreboard photo.
Focus only on the row for the player named "${playerName}".
Return strict JSON with this schema and no extra text:
{
  "playerName": string,
  "totalScore": number | null,
  "confidence": number,
  "frames": [
    { "frame": number, "shots": [number|null, number|null, number|null], "confidence": number }
  ]
}
Rules:
- Frames 1-9 have up to 2 shots; frame 10 can have up to 3.
- Use null for any unreadable shot.
- Confidence values should be between 0 and 1.`;
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
  console.log(`Claimed job ${job.id} for game ${job.game_id}.`);

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id,player_name")
    .eq("id", job.game_id)
    .single();

  if (gameError || !game) {
    await setJobError(
      supabase,
      job.id,
      job.game_id,
      gameError?.message || "Game not found."
    );
    return { status: "error", jobId: job.id };
  }

  const { data: imageData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(job.storage_key);

  if (downloadError || !imageData) {
    await setJobError(
      supabase,
      job.id,
      game.id,
      downloadError?.message || "Failed to download image."
    );
    return { status: "error", jobId: job.id };
  }

  const arrayBuffer = await imageData.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });

  let extraction;
  try {
    // prompt for scoreboard extraction
    const result = await model.generateContent([
      { text: buildPrompt(game.player_name) },
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
      game.id,
      error instanceof Error ? error.message : "Gemini extraction failed."
    );
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  const frames = Array.isArray(extraction?.frames) ? extraction.frames : [];
  const totalScore = toNullableNumber(extraction?.totalScore);
  const confidence = toNullableNumber(extraction?.confidence);

  await supabase.from("frames").delete().eq("game_id", game.id);

  const frameRows = frames.map((frame) => {
    const shot1 = toNullableNumber(frame?.shots?.[0]);
    const shot2 = toNullableNumber(frame?.shots?.[1]);
    return {
      game_id: game.id,
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
      await setJobError(supabase, job.id, game.id, frameError.message);
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
    const frameConfidence = toNullableNumber(frame.confidence);
    shots.forEach((shot, index) => {
      shotRows.push({
        frame_id: frameId,
        shot_number: index + 1,
        pins: toNullableNumber(shot),
        confidence: frameConfidence
      });
    });
  }

  if (shotRows.length > 0) {
    const { error: shotError } = await supabase.from("shots").insert(shotRows);
    if (shotError) {
      await setJobError(supabase, job.id, game.id, shotError.message);
      await supabase.storage.from(BUCKET).remove([job.storage_key]);
      return { status: "error", jobId: job.id };
    }
  }

  const { error: gameUpdateError } = await supabase
    .from("games")
    .update({
      total_score: totalScore,
      raw_extraction: extraction,
      extraction_confidence: confidence,
      status: "ready"
    })
    .eq("id", game.id);

  if (gameUpdateError) {
    await setJobError(supabase, job.id, game.id, gameUpdateError.message);
    await supabase.storage.from(BUCKET).remove([job.storage_key]);
    return { status: "error", jobId: job.id };
  }

  await supabase
    .from("analysis_jobs")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await supabase.storage.from(BUCKET).remove([job.storage_key]);

  console.log(`Job ${job.id} complete for game ${game.id}.`);
  return { status: "ready", jobId: job.id, gameId: game.id };
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
