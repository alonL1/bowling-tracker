import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { normalizeOptionalTimestamp } from "../shared";
import { isUniqueViolation } from "../../utils/mobile-sync-operations";
import {
  cleanupLiveSessionIfEmpty,
  getActiveLiveSessionRecord,
  getLiveUserId,
  getServerSupabase,
  triggerWorkerIfConfigured,
} from "../server";

export const runtime = "nodejs";

type CapturePayload = {
  storageKey?: string;
  capturedAtHint?: string | null;
  timezoneOffsetMinutes?: number | string | null;
  name?: string;
  description?: string;
  clientCaptureId?: string | null;
};

type StorageObjectRow = {
  name: string;
};

type ExistingLiveCapture = {
  jobId: string | null;
  liveSessionId: string;
  liveGameId: string;
  sessionId: string;
  storageKey: string;
  capturedAtHint: string | null;
};

function normalizeOptionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function storageObjectExists(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  bucket: string,
  userId: string,
  storageKey: string
) {
  const prefix = `${userId}/`;
  const objectName = storageKey.slice(prefix.length);
  const { data, error } = await supabase.storage.from(bucket).list(userId, {
    search: objectName,
    limit: 100,
  });

  if (error) {
    throw new Error(error.message || "Failed to validate uploaded scoreboard.");
  }

  return (data as StorageObjectRow[] | null | undefined)?.some(
    (entry) => entry.name === objectName
  );
}

async function findExistingLiveCapture(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  userId: string,
  clientCaptureId: string
) {
  const { data: liveGame, error: liveGameError } = await supabase
    .from("live_session_games")
    .select("id,live_session_id,storage_key,captured_at_hint")
    .eq("client_capture_id", clientCaptureId)
    .maybeSingle();

  if (liveGameError) {
    throw new Error(
      liveGameError.message || "Failed to load existing live capture."
    );
  }

  if (!liveGame) {
    return null;
  }

  const { data: liveSession, error: liveSessionError } = await supabase
    .from("live_sessions")
    .select("id,session_id,user_id")
    .eq("id", liveGame.live_session_id)
    .maybeSingle();

  if (liveSessionError) {
    throw new Error(
      liveSessionError.message || "Failed to load existing live session."
    );
  }

  if (!liveSession || liveSession.user_id !== userId) {
    return null;
  }

  const { data: analysisJob, error: analysisJobError } = await supabase
    .from("analysis_jobs")
    .select("id")
    .eq("live_session_game_id", liveGame.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (analysisJobError) {
    throw new Error(
      analysisJobError.message || "Failed to load existing live session job."
    );
  }

  return {
    jobId: analysisJob?.id ?? null,
    liveSessionId: liveSession.id as string,
    liveGameId: liveGame.id as string,
    sessionId: liveSession.session_id as string,
    storageKey: liveGame.storage_key as string,
    capturedAtHint:
      typeof liveGame.captured_at_hint === "string"
        ? liveGame.captured_at_hint
        : null,
  };
}

async function ensureLiveCaptureJob(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  existingCapture: ExistingLiveCapture,
  userId: string,
  timezoneOffsetMinutes: number | null
) {
  if (existingCapture.jobId) {
    return existingCapture.jobId;
  }

  const jobId = randomUUID();
  const { error } = await supabase.from("analysis_jobs").insert({
    id: jobId,
    storage_key: existingCapture.storageKey,
    status: "queued",
    player_name: "live-session",
    user_id: userId,
    session_id: existingCapture.sessionId,
    live_session_id: existingCapture.liveSessionId,
    live_session_game_id: existingCapture.liveGameId,
    timezone_offset_minutes: timezoneOffsetMinutes,
    captured_at_hint: existingCapture.capturedAtHint,
    job_type: "live_session",
  });

  if (error) {
    throw new Error(error.message || "Failed to queue live session capture.");
  }

  await triggerWorkerIfConfigured(1);
  return jobId;
}

export async function POST(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getLiveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as CapturePayload;
  const storageKey =
    typeof payload.storageKey === "string" ? payload.storageKey.trim() : "";
  const clientCaptureId =
    typeof payload.clientCaptureId === "string"
      ? payload.clientCaptureId.trim() || null
      : null;
  if (!storageKey) {
    return NextResponse.json(
      { error: "storageKey is required." },
      { status: 400 }
    );
  }

  const requiredPrefix = `${userId}/`;
  if (!storageKey.startsWith(requiredPrefix)) {
    return NextResponse.json(
      { error: "Invalid storage key ownership." },
      { status: 400 }
    );
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
  const capturedAtHint = normalizeOptionalTimestamp(payload.capturedAtHint);
  const timezoneOffsetMinutes = normalizeOptionalInteger(
    payload.timezoneOffsetMinutes
  );

  try {
    if (clientCaptureId) {
      const existingCapture = await findExistingLiveCapture(
        supabase,
        userId,
        clientCaptureId
      );

      if (existingCapture) {
        const jobId = await ensureLiveCaptureJob(
          supabase,
          existingCapture,
          userId,
          timezoneOffsetMinutes
        );

        return NextResponse.json({
          ok: true,
          jobId,
          liveSessionId: existingCapture.liveSessionId,
          liveGameId: existingCapture.liveGameId,
          sessionId: existingCapture.sessionId,
        });
      }
    }

    const exists = await storageObjectExists(supabase, bucket, userId, storageKey);
    if (!exists) {
      return NextResponse.json(
        { error: "Uploaded scoreboard image was not found in storage." },
        { status: 400 }
      );
    }

    let active = await getActiveLiveSessionRecord(supabase, userId);
    let sessionId = active?.session_id ?? null;
    let liveSessionId = active?.id ?? null;

    if (!active?.id || !active.session_id) {
      const name =
        typeof payload.name === "string" ? payload.name.trim() || null : null;
      const description =
        typeof payload.description === "string"
          ? payload.description.trim() || null
          : null;

      const { data: createdSession, error: sessionError } = await supabase
        .from("bowling_sessions")
        .insert({
          user_id: userId,
          name,
          description,
          started_at: null,
        })
        .select("id")
        .single();

      if (sessionError || !createdSession) {
        return NextResponse.json(
          { error: sessionError?.message || "Failed to create live session." },
          { status: 500 }
        );
      }

      sessionId = createdSession.id as string;

      const { data: createdLiveSession, error: liveSessionError } = await supabase
        .from("live_sessions")
        .insert({
          user_id: userId,
          session_id: sessionId,
          status: "active",
          selected_player_keys: [],
        })
        .select("id,session_id,status,selected_player_keys,created_at,updated_at,ended_at")
        .single();

      if (liveSessionError || !createdLiveSession) {
        await supabase
          .from("bowling_sessions")
          .delete()
          .eq("id", sessionId)
          .eq("user_id", userId);
        return NextResponse.json(
          {
            error:
              liveSessionError?.message || "Failed to create live draft session.",
          },
          { status: 500 }
        );
      }

      active = createdLiveSession;
      liveSessionId = createdLiveSession.id as string;
    }

    const { data: lastGame, error: lastGameError } = await supabase
      .from("live_session_games")
      .select("capture_order")
      .eq("live_session_id", liveSessionId)
      .order("capture_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastGameError) {
      return NextResponse.json(
        { error: lastGameError.message || "Failed to inspect live session." },
        { status: 500 }
      );
    }

    const captureOrder = (lastGame?.capture_order ?? 0) + 1;

    const { data: liveGame, error: liveGameError } = await supabase
      .from("live_session_games")
      .insert({
        live_session_id: liveSessionId,
        client_capture_id: clientCaptureId,
        capture_order: captureOrder,
        storage_key: storageKey,
        captured_at_hint: capturedAtHint,
        status: "queued",
      })
      .select("id")
      .single();

    if (liveGameError || !liveGame) {
      if (clientCaptureId && isUniqueViolation(liveGameError)) {
        const existingCapture = await findExistingLiveCapture(
          supabase,
          userId,
          clientCaptureId
        );

        if (existingCapture) {
          const jobId = await ensureLiveCaptureJob(
            supabase,
            existingCapture,
            userId,
            timezoneOffsetMinutes
          );

          return NextResponse.json({
            ok: true,
            jobId,
            liveSessionId: existingCapture.liveSessionId,
            liveGameId: existingCapture.liveGameId,
            sessionId: existingCapture.sessionId,
          });
        }
      }

      if (liveSessionId && sessionId) {
        await cleanupLiveSessionIfEmpty(
          supabase,
          userId,
          liveSessionId,
          sessionId
        ).catch(() => undefined);
      }
      return NextResponse.json(
        { error: liveGameError?.message || "Failed to create live game." },
        { status: 500 }
      );
    }

    const jobId = randomUUID();
    const { error: jobError } = await supabase.from("analysis_jobs").insert({
      id: jobId,
      storage_key: storageKey,
      status: "queued",
      player_name: "live-session",
      user_id: userId,
      session_id: sessionId,
      live_session_id: liveSessionId,
      live_session_game_id: liveGame.id,
      timezone_offset_minutes: timezoneOffsetMinutes,
      captured_at_hint: capturedAtHint,
      job_type: "live_session",
    });

    if (jobError) {
      await supabase.from("live_session_games").delete().eq("id", liveGame.id);
      if (liveSessionId && sessionId) {
        await cleanupLiveSessionIfEmpty(
          supabase,
          userId,
          liveSessionId,
          sessionId
        ).catch(() => undefined);
      }
      return NextResponse.json(
        { error: jobError.message || "Failed to queue live session capture." },
        { status: 500 }
      );
    }

    await triggerWorkerIfConfigured(1);

    return NextResponse.json({
      ok: true,
      jobId,
      liveSessionId,
      liveGameId: liveGame.id,
      sessionId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue live session capture.",
      },
      { status: 500 }
    );
  }
}
