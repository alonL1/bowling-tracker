import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

const DEFAULT_BUCKET = "scoreboards-temp";

export const runtime = "nodejs";

function normalizeOptionalUuid(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
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

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let playerName: string | null = null;
  let images: File[] = [];
  let storageKeys: string[] = [];
  let timezoneOffsetMinutes: string | null = null;
  let sessionIdValue: string | null = null;

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as {
      playerName?: string;
      storageKeys?: string[];
      sessionId?: string;
      timezoneOffsetMinutes?: string;
    };
    playerName = typeof payload.playerName === "string" ? payload.playerName : null;
    storageKeys = Array.isArray(payload.storageKeys)
      ? payload.storageKeys.filter((key): key is string => typeof key === "string")
      : [];
    sessionIdValue = typeof payload.sessionId === "string" ? payload.sessionId : null;
    timezoneOffsetMinutes =
      typeof payload.timezoneOffsetMinutes === "string"
        ? payload.timezoneOffsetMinutes
        : null;
  } else {
    const formData = await request.formData();
    playerName =
      typeof formData.get("playerName") === "string"
        ? String(formData.get("playerName"))
        : null;
    images = formData
      .getAll("image")
      .filter((item) => item instanceof File && item.size > 0) as File[];
    timezoneOffsetMinutes =
      typeof formData.get("timezoneOffsetMinutes") === "string"
        ? String(formData.get("timezoneOffsetMinutes"))
        : null;
    sessionIdValue =
      typeof formData.get("sessionId") === "string"
        ? String(formData.get("sessionId"))
        : null;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);
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

  const userId =
    (await getUserIdFromRequest(request)) || normalizeOptionalUuid(devUserId);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (typeof playerName !== "string" || playerName.trim().length === 0) {
    return NextResponse.json(
      { error: "Player name is required." },
      { status: 400 }
    );
  }

  const cleanStorageKeys = storageKeys
    .map((key) => key.trim())
    .filter(Boolean);

  if (images.length === 0 && cleanStorageKeys.length === 0) {
    return NextResponse.json(
      { error: "A scoreboard image is required." },
      { status: 400 }
    );
  }

  const sessionId = normalizeOptionalUuid(
    typeof sessionIdValue === "string" ? sessionIdValue : null
  );
  if (!sessionId) {
    return NextResponse.json(
      { error: "Session is required when logging games." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: session, error: sessionError } = await supabase
    .from("bowling_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json(
      { error: sessionError.message || "Failed to validate session." },
      { status: 500 }
    );
  }

  if (!session) {
    return NextResponse.json(
      { error: "Selected session was not found." },
      { status: 400 }
    );
  }

  const trimmedName = playerName.trim();
  const parsedOffset =
    typeof timezoneOffsetMinutes === "string"
      ? Number.parseInt(timezoneOffsetMinutes, 10)
      : null;
  const safeOffset =
    parsedOffset !== null && Number.isFinite(parsedOffset)
      ? parsedOffset
      : null;

  const jobs: { jobId: string; message: string }[] = [];
  const errors: string[] = [];

  const items: Array<{ storageKey: string }> = [];

  if (cleanStorageKeys.length > 0) {
    cleanStorageKeys.forEach((key) => {
      items.push({ storageKey: key });
    });
  } else {
    for (const image of images) {
      if (image.type && !image.type.startsWith("image/")) {
        errors.push("Only image uploads are supported.");
        continue;
      }

      const jobId = crypto.randomUUID();
      const extension = image.type?.split("/")[1] || "jpg";
      const storageKey = `${jobId}.${extension}`;

      try {
        const buffer = Buffer.from(await image.arrayBuffer());
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storageKey, buffer, {
            contentType: image.type || "image/jpeg",
            upsert: false
          });

        if (uploadError) {
          errors.push(uploadError.message || "Failed to upload image.");
          continue;
        }

        items.push({ storageKey });
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "Failed to process upload."
        );
      }
    }
  }

  for (const item of items) {
    const jobId = crypto.randomUUID();
    try {
      const { error: jobError } = await supabase.from("analysis_jobs").insert({
        id: jobId,
        storage_key: item.storageKey,
        status: "queued",
        player_name: trimmedName,
        user_id: userId,
        session_id: sessionId ?? null,
        timezone_offset_minutes: safeOffset
      });

      if (jobError) {
        await supabase.storage.from(bucket).remove([item.storageKey]);
        errors.push(jobError.message || "Failed to queue analysis job.");
        continue;
      }

      jobs.push({
        jobId,
        message: "Queued for extraction."
      });
    } catch (error) {
      await supabase.storage.from(bucket).remove([item.storageKey]);
      errors.push(
        error instanceof Error ? error.message : "Failed to queue analysis job."
      );
    }
  }

  if (workerUrl && jobs.length > 0) {
    const runUrl = `${workerUrl.replace(/\/$/, "")}/run`;
    const headers = workerToken ? { "X-Worker-Token": workerToken } : undefined;
    jobs.forEach(() => {
      fetch(runUrl, { method: "POST", headers }).catch((error) => {
        console.warn("Immediate worker trigger failed:", error);
      });
    });
  }

  return NextResponse.json({
    jobs,
    errors
  });
}
