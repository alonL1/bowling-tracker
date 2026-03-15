import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getUserIdFromRequest } from "../utils/auth";
import { buildPlayerOptions, normalizeSelectedPlayerKeys } from "./shared";

export function normalizeOptionalUuid(value?: string | null) {
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

export function getServerSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

export async function getLiveUserId(request: Request) {
  return getUserIdFromRequest(request);
}

export async function getActiveLiveSessionRecord(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("live_sessions")
    .select("id,session_id,status,selected_player_keys,created_at,updated_at,ended_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load live session.");
  }

  return data;
}

export async function computeSessionNumber(
  supabase: SupabaseClient,
  userId: string,
  sessionId?: string | null
) {
  const { data, error } = await supabase
    .from("bowling_sessions")
    .select("id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message || "Failed to compute session number.");
  }

  const sessions = data ?? [];
  if (!sessionId) {
    return sessions.length + 1;
  }

  const index = sessions.findIndex((session) => session.id === sessionId);
  return index >= 0 ? index + 1 : sessions.length + 1;
}

export async function cleanupLiveSessionIfEmpty(
  supabase: SupabaseClient,
  userId: string,
  liveSessionId: string,
  sessionId: string
) {
  const { count, error } = await supabase
    .from("live_session_games")
    .select("id", { count: "exact", head: true })
    .eq("live_session_id", liveSessionId);

  if (error) {
    throw new Error(error.message || "Failed to check live session games.");
  }

  if ((count ?? 0) > 0) {
    return false;
  }

  await supabase
    .from("analysis_jobs")
    .delete()
    .eq("live_session_id", liveSessionId)
    .eq("user_id", userId);

  const { error: liveSessionDeleteError } = await supabase
    .from("live_sessions")
    .delete()
    .eq("id", liveSessionId)
    .eq("user_id", userId);

  if (liveSessionDeleteError) {
    throw new Error(liveSessionDeleteError.message || "Failed to delete empty live session.");
  }

  const { error: sessionDeleteError } = await supabase
    .from("bowling_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (sessionDeleteError) {
    throw new Error(sessionDeleteError.message || "Failed to delete empty session.");
  }

  return true;
}

export async function buildLiveSessionPayload(
  supabase: SupabaseClient,
  userId: string
) {
  const active = await getActiveLiveSessionRecord(supabase, userId);
  const nextSessionNumber = await computeSessionNumber(
    supabase,
    userId,
    active?.session_id
  );

  if (!active?.session_id) {
    return {
      liveSession: null,
      nextSessionNumber,
    };
  }

  const [{ data: session, error: sessionError }, { data: games, error: gamesError }] =
    await Promise.all([
      supabase
        .from("bowling_sessions")
        .select("id,name,description,started_at,created_at")
        .eq("id", active.session_id)
        .eq("user_id", userId)
        .single(),
      supabase
        .from("live_session_games")
        .select(
          "id,capture_order,status,captured_at_hint,captured_at,last_error,created_at,updated_at,extraction"
        )
        .eq("live_session_id", active.id)
        .order("capture_order", { ascending: true }),
    ]);

  if (sessionError || !session) {
    throw new Error(sessionError?.message || "Live session was not found.");
  }

  if (gamesError) {
    throw new Error(gamesError.message || "Failed to load live session games.");
  }

  return {
    liveSession: {
      id: active.id,
      sessionId: session.id,
      sessionNumber: nextSessionNumber,
      name: session.name,
      description: session.description,
      startedAt: session.started_at,
      createdAt: session.created_at,
      selectedPlayerKeys: normalizeSelectedPlayerKeys(active.selected_player_keys),
      playerOptions: buildPlayerOptions(games ?? []),
      games: games ?? [],
    },
    nextSessionNumber,
  };
}

export async function triggerWorkerIfConfigured(jobCount = 1) {
  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_AUTH_TOKEN;

  if (!workerUrl || !workerToken || jobCount <= 0) {
    return;
  }

  const runUrl = `${workerUrl.replace(/\/$/, "")}/run`;
  const triggerCount = Math.min(3, Math.max(1, Math.ceil(jobCount / 6)));

  for (let index = 0; index < triggerCount; index += 1) {
    fetch(runUrl, {
      method: "POST",
      headers: { "X-Worker-Token": workerToken },
    }).catch((error) => {
      console.warn("Immediate worker trigger failed:", error);
    });
  }
}
