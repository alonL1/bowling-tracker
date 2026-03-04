import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

const DEFAULT_BUCKET = "scoreboards-temp";

export const runtime = "nodejs";

type SessionMode = "auto" | "new" | "existing";

type StorageItemInput = {
  storageKey?: string;
  capturedAtHint?: string;
  autoGroupIndex?: number;
};

type PreparedItem = {
  storageKey: string;
  capturedAtHint: string | null;
  autoGroupIndex: number | null;
  sessionId: string | null;
};

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

function normalizeOptionalTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function isSessionMode(value: unknown): value is SessionMode {
  return value === "auto" || value === "new" || value === "existing";
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let playerName: string | null = null;
  let images: File[] = [];
  let legacyStorageKeys: string[] = [];
  let storageItemsPayload: StorageItemInput[] = [];
  let timezoneOffsetMinutes: string | null = null;
  let sessionModeValue: SessionMode | null = null;
  let existingSessionIdValue: string | null = null;
  let legacySessionIdValue: string | null = null;

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as {
      playerName?: string;
      storageKeys?: string[];
      storageItems?: StorageItemInput[];
      sessionId?: string;
      existingSessionId?: string;
      sessionMode?: SessionMode;
      timezoneOffsetMinutes?: string;
    };
    playerName = typeof payload.playerName === "string" ? payload.playerName : null;
    legacyStorageKeys = Array.isArray(payload.storageKeys)
      ? payload.storageKeys.filter((key): key is string => typeof key === "string")
      : [];
    storageItemsPayload = Array.isArray(payload.storageItems)
      ? payload.storageItems
      : [];
    legacySessionIdValue =
      typeof payload.sessionId === "string" ? payload.sessionId : null;
    existingSessionIdValue =
      typeof payload.existingSessionId === "string"
        ? payload.existingSessionId
        : null;
    sessionModeValue = isSessionMode(payload.sessionMode)
      ? payload.sessionMode
      : null;
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
    legacyStorageKeys = formData
      .getAll("storageKey")
      .filter((item): item is string => typeof item === "string")
      .map((key) => key.trim())
      .filter(Boolean);
    legacySessionIdValue =
      typeof formData.get("sessionId") === "string"
        ? String(formData.get("sessionId"))
        : null;
    existingSessionIdValue =
      typeof formData.get("existingSessionId") === "string"
        ? String(formData.get("existingSessionId"))
        : null;
    sessionModeValue = isSessionMode(formData.get("sessionMode"))
      ? (formData.get("sessionMode") as SessionMode)
      : null;
    timezoneOffsetMinutes =
      typeof formData.get("timezoneOffsetMinutes") === "string"
        ? String(formData.get("timezoneOffsetMinutes"))
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const trimmedName = playerName.trim();
  const parsedOffset =
    typeof timezoneOffsetMinutes === "string"
      ? Number.parseInt(timezoneOffsetMinutes, 10)
      : null;
  const safeOffset =
    parsedOffset !== null && Number.isFinite(parsedOffset)
      ? parsedOffset
      : null;

  const errors: string[] = [];
  const jobs: { jobId: string; message: string }[] = [];

  const items: PreparedItem[] = storageItemsPayload
    .filter((item) => typeof item?.storageKey === "string")
    .map((item) => ({
      storageKey: String(item.storageKey).trim(),
      capturedAtHint: normalizeOptionalTimestamp(item.capturedAtHint),
      autoGroupIndex:
        Number.isInteger(item.autoGroupIndex) && typeof item.autoGroupIndex === "number"
          ? item.autoGroupIndex
          : null,
      sessionId: null
    }))
    .filter((item) => item.storageKey.length > 0);

  legacyStorageKeys
    .map((key) => key.trim())
    .filter(Boolean)
    .forEach((storageKey) => {
      items.push({
        storageKey,
        capturedAtHint: null,
        autoGroupIndex: null,
        sessionId: null
      });
    });

  if (items.length === 0 && images.length === 0) {
    return NextResponse.json(
      { error: "A scoreboard image is required." },
      { status: 400 }
    );
  }

  if (images.length > 0) {
    for (const image of images) {
      if (image.type && !image.type.startsWith("image/")) {
        errors.push("Only image uploads are supported.");
        continue;
      }

      const extension = image.type?.split("/")[1] || "jpg";
      const storageKey = `${crypto.randomUUID()}.${extension}`;

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

        items.push({
          storageKey,
          capturedAtHint: null,
          autoGroupIndex: null,
          sessionId: null
        });
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "Failed to process upload."
        );
      }
    }
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: errors[0] || "Failed to upload any scoreboard images." },
      { status: 400 }
    );
  }

  const existingSessionId = normalizeOptionalUuid(
    existingSessionIdValue || legacySessionIdValue
  );
  const sessionMode: SessionMode = sessionModeValue
    ? sessionModeValue
    : existingSessionId
      ? "existing"
      : "new";

  if (sessionMode === "existing" && !existingSessionId) {
    return NextResponse.json(
      { error: "An existing session is required." },
      { status: 400 }
    );
  }

  if (sessionMode === "auto") {
    const hasInvalidAutoItem = items.some(
      (item) => item.autoGroupIndex === null || item.capturedAtHint === null
    );
    if (hasInvalidAutoItem) {
      return NextResponse.json(
        {
          error:
            "Auto Session requires a valid timestamp and auto-group for every uploaded image."
        },
        { status: 400 }
      );
    }
  }

  if (sessionMode === "existing" && existingSessionId) {
    const { data: session, error: sessionError } = await supabase
      .from("bowling_sessions")
      .select("id")
      .eq("id", existingSessionId)
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
  }

  const removeStorageKeys = async (storageKeys: string[]) => {
    if (storageKeys.length === 0) {
      return;
    }
    await supabase.storage.from(bucket).remove(storageKeys);
  };

  const createUnnamedSession = async (startedAt: string | null) => {
    const { data, error } = await supabase
      .from("bowling_sessions")
      .insert({
        user_id: userId,
        name: null,
        description: null,
        started_at: startedAt
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Failed to create session.");
    }

    return data.id as string;
  };

  const createdSessionIds: string[] = [];

  try {
    if (sessionMode === "existing" && existingSessionId) {
      items.forEach((item) => {
        item.sessionId = existingSessionId;
      });
    } else if (sessionMode === "new") {
      const earliestHint =
        items
          .map((item) => item.capturedAtHint)
          .filter((value): value is string => Boolean(value))
          .sort()[0] ?? null;
      const sessionId = await createUnnamedSession(earliestHint);
      createdSessionIds.push(sessionId);
      items.forEach((item) => {
        item.sessionId = sessionId;
      });
    } else {
      const groups = new Map<number, PreparedItem[]>();
      items.forEach((item) => {
        const key = item.autoGroupIndex ?? 0;
        const existing = groups.get(key);
        if (existing) {
          existing.push(item);
        } else {
          groups.set(key, [item]);
        }
      });

      const orderedGroups = Array.from(groups.entries())
        .map(([groupIndex, groupItems]) => ({
          groupIndex,
          groupItems,
          earliestHint:
            groupItems
              .map((item) => item.capturedAtHint)
              .filter((value): value is string => Boolean(value))
              .sort()[0] ?? null
        }))
        .sort((a, b) => {
          if (a.earliestHint && b.earliestHint) {
            const diff =
              Date.parse(a.earliestHint) - Date.parse(b.earliestHint);
            if (diff !== 0) {
              return diff;
            }
          } else if (a.earliestHint && !b.earliestHint) {
            return -1;
          } else if (!a.earliestHint && b.earliestHint) {
            return 1;
          }
          return a.groupIndex - b.groupIndex;
        });

      for (const group of orderedGroups) {
        const sessionId = await createUnnamedSession(group.earliestHint);
        createdSessionIds.push(sessionId);
        group.groupItems.forEach((item) => {
          item.sessionId = sessionId;
        });
      }
    }
  } catch (error) {
    if (createdSessionIds.length > 0) {
      await supabase.from("bowling_sessions").delete().in("id", createdSessionIds);
    }
    await removeStorageKeys(items.map((item) => item.storageKey));
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to prepare sessions."
      },
      { status: 500 }
    );
  }

  const successfulJobsBySessionId = new Map<string, number>();

  for (const item of items) {
    const jobId = crypto.randomUUID();
    try {
      const { error: jobError } = await supabase.from("analysis_jobs").insert({
        id: jobId,
        storage_key: item.storageKey,
        status: "queued",
        player_name: trimmedName,
        user_id: userId,
        session_id: item.sessionId,
        timezone_offset_minutes: safeOffset,
        captured_at_hint: item.capturedAtHint
      });

      if (jobError) {
        await removeStorageKeys([item.storageKey]);
        errors.push(jobError.message || "Failed to queue analysis job.");
        continue;
      }

      jobs.push({
        jobId,
        message: "Queued for extraction."
      });

      if (item.sessionId) {
        successfulJobsBySessionId.set(
          item.sessionId,
          (successfulJobsBySessionId.get(item.sessionId) ?? 0) + 1
        );
      }
    } catch (error) {
      await removeStorageKeys([item.storageKey]);
      errors.push(
        error instanceof Error ? error.message : "Failed to queue analysis job."
      );
    }
  }

  const emptyCreatedSessionIds = createdSessionIds.filter(
    (sessionId) => (successfulJobsBySessionId.get(sessionId) ?? 0) === 0
  );
  if (emptyCreatedSessionIds.length > 0) {
    await supabase.from("bowling_sessions").delete().in("id", emptyCreatedSessionIds);
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
