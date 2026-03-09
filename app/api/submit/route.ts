import { createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

const DEFAULT_BUCKET = "scoreboards-temp";
const DEFAULT_WORKER_TRIGGER_COUNT = 3;
const DEFAULT_TARGET_JOBS_PER_TRIGGER = 6;

const MAX_IMAGES_PER_REQUEST = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES_PER_REQUEST = 500 * 1024 * 1024;
const MAX_IMAGES_PER_USER_ROLLING_24H = 500;
const MAX_BYTES_PER_USER_ROLLING_24H = 1024 * 1024 * 1024;
const MAX_PLAYER_NAMES = 10;
const MAX_PLAYER_NAME_TOTAL_CHARS = 120;
const MAX_SUBMIT_REQUESTS_PER_USER_PER_MINUTE = 3;
const MAX_SUBMIT_REQUESTS_PER_USER_PER_TEN_MINUTES = 10;
const MAX_SUBMIT_REQUESTS_PER_USER_PER_24H = 40;
const MAX_SUBMIT_REQUESTS_PER_IP_PER_MINUTE = 3;
const MAX_QUEUED_PROCESSING_PER_USER = 150;
const MAX_QUEUED_PROCESSING_GLOBAL = 2000;

export const runtime = "nodejs";

type SessionMode = "auto" | "new" | "existing";

type StorageItemInput = {
  storageKey?: string;
  capturedAtHint?: string;
  fileSizeBytes?: number;
  autoGroupIndex?: number;
};

type PreparedItem = {
  storageKey: string;
  capturedAtHint: string | null;
  fileSizeBytes: number | null;
  autoGroupIndex: number | null;
  sessionId: string | null;
};

type StorageObjectRow = {
  name: string;
  metadata?: { size?: number | string } | null;
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

function normalizeOptionalBytes(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return null;
  }
  return rounded;
}

function isSessionMode(value: unknown): value is SessionMode {
  return value === "auto" || value === "new" || value === "existing";
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded
      .split(",")
      .map((value) => value.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }
  return request.headers.get("x-real-ip") || null;
}

function hashIp(ip: string | null) {
  if (!ip) {
    return null;
  }
  return createHash("sha256").update(ip).digest("hex");
}

function parseObjectSizeBytes(metadata: StorageObjectRow["metadata"]) {
  const rawSize = metadata?.size;
  const size =
    typeof rawSize === "string"
      ? Number.parseInt(rawSize, 10)
      : typeof rawSize === "number"
        ? rawSize
        : NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }
  return Math.floor(size);
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

  if (workerUrl && !workerToken) {
    return NextResponse.json(
      {
        error:
          "Server is missing WORKER_AUTH_TOKEN. Worker token is required when WORKER_URL is configured."
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

  const trimmedName = playerName.trim();
  if (trimmedName.length > MAX_PLAYER_NAME_TOTAL_CHARS) {
    return NextResponse.json(
      {
        error: `Player name list is too long. Limit is ${MAX_PLAYER_NAME_TOTAL_CHARS} characters.`
      },
      { status: 400 }
    );
  }

  const parsedNames = trimmedName
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (parsedNames.length === 0) {
    return NextResponse.json(
      { error: "Player name is required." },
      { status: 400 }
    );
  }
  if (parsedNames.length > MAX_PLAYER_NAMES) {
    return NextResponse.json(
      { error: `Use no more than ${MAX_PLAYER_NAMES} names in one submission.` },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

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
      fileSizeBytes: normalizeOptionalBytes(item.fileSizeBytes),
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
        fileSizeBytes: null,
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

  const removeStorageKeys = async (storageKeys: string[]) => {
    if (storageKeys.length === 0) {
      return;
    }
    await supabase.storage.from(bucket).remove(storageKeys);
  };

  const uploadedThisRequest = new Set<string>();

  if (images.length > MAX_IMAGES_PER_REQUEST) {
    return NextResponse.json(
      { error: `You can upload up to ${MAX_IMAGES_PER_REQUEST} images per request.` },
      { status: 400 }
    );
  }

  if (images.length > 0) {
    for (const image of images) {
      if (image.type && !image.type.startsWith("image/")) {
        errors.push("Only image uploads are supported.");
        continue;
      }

      if (image.size > MAX_IMAGE_BYTES) {
        errors.push(`Image \"${image.name}\" exceeds the 8 MB per-image limit.`);
        continue;
      }

      const extension = image.type?.split("/")[1] || "jpg";
      const storageKey = `${userId}/${randomUUID()}.${extension}`;

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

        uploadedThisRequest.add(storageKey);

        items.push({
          storageKey,
          capturedAtHint: null,
          fileSizeBytes: image.size,
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

  if (items.length > MAX_IMAGES_PER_REQUEST) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: `You can upload up to ${MAX_IMAGES_PER_REQUEST} images per request.` },
      { status: 400 }
    );
  }

  const uniqueStorageKeys = Array.from(new Set(items.map((item) => item.storageKey)));
  if (uniqueStorageKeys.length !== items.length) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: "Duplicate storage keys were provided." },
      { status: 400 }
    );
  }

  const requiredPrefix = `${userId}/`;
  const hasInvalidOwnershipPrefix = uniqueStorageKeys.some(
    (key) => !key.startsWith(requiredPrefix)
  );
  if (hasInvalidOwnershipPrefix) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "Invalid storage key ownership. Uploaded keys must be prefixed by the current user id."
      },
      { status: 400 }
    );
  }

  const objectChecks = await Promise.all(
    uniqueStorageKeys.map(async (storageKey) => {
      const objectName = storageKey.slice(requiredPrefix.length);
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(userId, {
          search: objectName,
          limit: 100
        });
      if (error) {
        return {
          storageKey,
          error: error.message || "Failed to validate uploaded object.",
          object: null as StorageObjectRow | null
        };
      }
      const matched = (data || []).find((entry) => entry.name === objectName);
      return {
        storageKey,
        error: null,
        object: matched
          ? ({
              name: `${requiredPrefix}${matched.name}`,
              metadata: matched.metadata
            } as StorageObjectRow)
          : null
      };
    })
  );

  const objectCheckError = objectChecks.find((entry) => entry.error);
  if (objectCheckError?.error) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: objectCheckError.error },
      { status: 500 }
    );
  }

  const objectMap = new Map<string, StorageObjectRow>();
  objectChecks.forEach((entry) => {
    if (entry.object) {
      objectMap.set(entry.storageKey, entry.object);
    }
  });

  for (const item of items) {
    const objectRow = objectMap.get(item.storageKey);
    if (!objectRow) {
      await removeStorageKeys(Array.from(uploadedThisRequest));
      return NextResponse.json(
        { error: "One or more uploaded images could not be found in storage." },
        { status: 400 }
      );
    }

    const objectSizeBytes = parseObjectSizeBytes(objectRow.metadata ?? null);
    if (!objectSizeBytes) {
      await removeStorageKeys(Array.from(uploadedThisRequest));
      return NextResponse.json(
        { error: "Unable to determine image size for one or more uploads." },
        { status: 400 }
      );
    }

    item.fileSizeBytes = objectSizeBytes;
  }

  const oversizedItem = items.find(
    (item) => (item.fileSizeBytes ?? 0) > MAX_IMAGE_BYTES
  );
  if (oversizedItem) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: "Each image must be 8 MB or smaller." },
      { status: 400 }
    );
  }

  const requestTotalBytes = items.reduce(
    (sum, item) => sum + (item.fileSizeBytes ?? 0),
    0
  );
  if (requestTotalBytes > MAX_TOTAL_BYTES_PER_REQUEST) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: "Upload too large. Keep total images at or below 500 MB per request." },
      { status: 400 }
    );
  }

  const ipHash = hashIp(getClientIp(request));
  const now = new Date();
  const minuteAgoIso = new Date(now.getTime() - 60 * 1000).toISOString();
  const tenMinutesAgoIso = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    userMinuteCountResult,
    userTenMinuteCountResult,
    ipMinuteCountResult,
    userDayLogsResult,
    userPendingJobsResult,
    globalPendingJobsResult
  ] = await Promise.all([
    supabase
      .from("submit_request_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", minuteAgoIso),
    supabase
      .from("submit_request_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", tenMinutesAgoIso),
    ipHash
      ? supabase
          .from("submit_request_logs")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .gte("created_at", minuteAgoIso)
      : Promise.resolve({ data: null, error: null, count: 0 }),
    supabase
      .from("submit_request_logs")
      .select("image_count,total_bytes")
      .eq("user_id", userId)
      .gte("created_at", dayAgoIso),
    supabase
      .from("analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "processing"]),
    supabase
      .from("analysis_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"])
  ]);

  if (
    userMinuteCountResult.error ||
    userTenMinuteCountResult.error ||
    ipMinuteCountResult.error ||
    userDayLogsResult.error ||
    userPendingJobsResult.error ||
    globalPendingJobsResult.error
  ) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      { error: "Failed to evaluate upload limits. Please try again." },
      { status: 500 }
    );
  }

  const userRequestsLastMinute = userMinuteCountResult.count ?? 0;
  if (userRequestsLastMinute >= MAX_SUBMIT_REQUESTS_PER_USER_PER_MINUTE) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "Too many Add to Log requests. Please wait a minute before submitting again."
      },
      { status: 429 }
    );
  }

  const userRequestsLastTenMinutes = userTenMinuteCountResult.count ?? 0;
  if (
    userRequestsLastTenMinutes >= MAX_SUBMIT_REQUESTS_PER_USER_PER_TEN_MINUTES
  ) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "Rate limit reached for Add to Log. Please wait a few minutes and try again."
      },
      { status: 429 }
    );
  }

  const ipRequestsLastMinute = ipMinuteCountResult.count ?? 0;
  if (ipRequestsLastMinute >= MAX_SUBMIT_REQUESTS_PER_IP_PER_MINUTE) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "Too many upload requests from this network. Please wait a minute and try again."
      },
      { status: 429 }
    );
  }

  const userRequestsLastDay = (userDayLogsResult.data || []).length;
  const userImagesLastDay = (userDayLogsResult.data || []).reduce(
    (sum, row) => sum + (typeof row.image_count === "number" ? row.image_count : 0),
    0
  );
  const userBytesLastDay = (userDayLogsResult.data || []).reduce(
    (sum, row) => sum + (typeof row.total_bytes === "number" ? row.total_bytes : 0),
    0
  );

  if (userRequestsLastDay >= MAX_SUBMIT_REQUESTS_PER_USER_PER_24H) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "Daily Add to Log request limit reached. Try again later."
      },
      { status: 429 }
    );
  }

  if (userImagesLastDay + items.length > MAX_IMAGES_PER_USER_ROLLING_24H) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error: `Daily image limit reached. Max ${MAX_IMAGES_PER_USER_ROLLING_24H} images per rolling 24 hours.`
      },
      { status: 429 }
    );
  }

  if (userBytesLastDay + requestTotalBytes > MAX_BYTES_PER_USER_ROLLING_24H) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error: "Daily upload byte limit reached. Max 1 GB per rolling 24 hours."
      },
      { status: 429 }
    );
  }

  const userPendingJobs = userPendingJobsResult.count ?? 0;
  if (userPendingJobs + items.length > MAX_QUEUED_PROCESSING_PER_USER) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "You have too many jobs in progress. Wait for current processing to finish before adding more."
      },
      { status: 429 }
    );
  }

  const globalPendingJobs = globalPendingJobsResult.count ?? 0;
  if (globalPendingJobs + items.length > MAX_QUEUED_PROCESSING_GLOBAL) {
    await removeStorageKeys(Array.from(uploadedThisRequest));
    return NextResponse.json(
      {
        error:
          "The system is busy right now. Please try again in a few minutes."
      },
      { status: 503 }
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
    await removeStorageKeys(Array.from(uploadedThisRequest));
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
      await removeStorageKeys(Array.from(uploadedThisRequest));
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
      await removeStorageKeys(Array.from(uploadedThisRequest));
      return NextResponse.json(
        { error: sessionError.message || "Failed to validate session." },
        { status: 500 }
      );
    }

    if (!session) {
      await removeStorageKeys(Array.from(uploadedThisRequest));
      return NextResponse.json(
        { error: "Selected session was not found." },
        { status: 400 }
      );
    }
  }

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
            const diff = Date.parse(a.earliestHint) - Date.parse(b.earliestHint);
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
  const queuedItems: PreparedItem[] = [];

  for (const item of items) {
    const jobId = randomUUID();
    try {
      const { error: jobError } = await supabase.from("analysis_jobs").insert({
        id: jobId,
        storage_key: item.storageKey,
        status: "queued",
        player_name: trimmedName,
        user_id: userId,
        session_id: item.sessionId,
        timezone_offset_minutes: safeOffset,
        captured_at_hint: item.capturedAtHint,
        file_size_bytes: item.fileSizeBytes
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
      queuedItems.push(item);

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

  if (jobs.length > 0) {
    const queuedBytes = queuedItems.reduce(
      (sum, item) => sum + (item.fileSizeBytes ?? 0),
      0
    );

    const { error: logError } = await supabase.from("submit_request_logs").insert({
      user_id: userId,
      ip_hash: ipHash,
      image_count: queuedItems.length,
      total_bytes: queuedBytes
    });

    if (logError) {
      console.warn("Failed to write submit request log:", logError.message);
    }
  }

  if (workerUrl && workerToken && jobs.length > 0) {
    const runUrl = `${workerUrl.replace(/\/$/, "")}/run`;
    const headers = { "X-Worker-Token": workerToken };
    const triggerCount = Math.min(
      DEFAULT_WORKER_TRIGGER_COUNT,
      Math.max(1, Math.ceil(jobs.length / DEFAULT_TARGET_JOBS_PER_TRIGGER))
    );

    for (let index = 0; index < triggerCount; index += 1) {
      fetch(runUrl, { method: "POST", headers }).catch((error) => {
        console.warn("Immediate worker trigger failed:", error);
      });
    }
  }

  return NextResponse.json({
    jobs,
    errors
  });
}
