import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_BUCKET = "scoreboards-temp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const playerName = formData.get("playerName");
  const image = formData.get("image");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  const devUserId = process.env.DEV_USER_ID;
  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_AUTH_TOKEN;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
  }

  if (typeof playerName !== "string" || playerName.trim().length === 0) {
    return NextResponse.json(
      { error: "Player name is required." },
      { status: 400 }
    );
  }

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      { error: "A scoreboard image is required." },
      { status: 400 }
    );
  }

  if (image.type && !image.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are supported." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const trimmedName = playerName.trim();
  const jobId = crypto.randomUUID();
  const extension = image.type?.split("/")[1] || "jpg";
  const storageKey = `${jobId}.${extension}`;

  const buffer = Buffer.from(await image.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storageKey, buffer, {
      contentType: image.type || "image/jpeg",
      upsert: false
    });

  if (uploadError) {
    return NextResponse.json(
      { error: uploadError.message || "Failed to upload image." },
      { status: 500 }
    );
  }

  const { error: jobError } = await supabase.from("analysis_jobs").insert({
    id: jobId,
    storage_key: storageKey,
    status: "queued",
    player_name: trimmedName,
    user_id: devUserId || null
  });

  if (jobError) {
    await supabase.storage.from(bucket).remove([storageKey]);
    return NextResponse.json(
      { error: jobError.message || "Failed to queue analysis job." },
      { status: 500 }
    );
  }

  if (workerUrl) {
    fetch(`${workerUrl.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: workerToken ? { "X-Worker-Token": workerToken } : undefined
    }).catch((error) => {
      console.warn("Immediate worker trigger failed:", error);
    });
  }

  return NextResponse.json({
    jobId,
    message:
      "Queued for extraction. The image will be deleted after processing.",
    metadata: {
      playerName: trimmedName,
      size: image.size,
      type: image.type || "unknown"
    }
  });
}
