import { NextResponse } from "next/server";

import {
  normalizeLiveExtraction,
  normalizeLivePlayers,
  normalizeOptionalTimestamp,
  normalizeSelectedPlayerKeys,
  serializeLiveExtraction,
  syncSelectedPlayerKeys,
  type RawLivePlayer,
} from "../shared";
import {
  cleanupLiveSessionIfEmpty,
  getActiveLiveSessionRecord,
  getLiveUserId,
  getServerSupabase,
} from "../server";

export const runtime = "nodejs";

type UpdateLiveGamePayload = {
  liveGameId?: string;
  players?: RawLivePlayer[];
  capturedAt?: string | null;
};

export async function PATCH(request: Request) {
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

  const payload = (await request.json()) as UpdateLiveGamePayload;
  const liveGameId =
    typeof payload.liveGameId === "string" ? payload.liveGameId.trim() : "";
  if (!liveGameId) {
    return NextResponse.json(
      { error: "liveGameId is required." },
      { status: 400 }
    );
  }

  const nextPlayers = normalizeLivePlayers(
    Array.isArray(payload.players) ? payload.players : []
  );
  if (nextPlayers.length === 0) {
    return NextResponse.json(
      { error: "At least one player is required." },
      { status: 400 }
    );
  }

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.id) {
      return NextResponse.json(
        { error: "No active live session was found." },
        { status: 404 }
      );
    }

    const { data: liveGame, error: liveGameError } = await supabase
      .from("live_session_games")
      .select("id,live_session_id,extraction")
      .eq("id", liveGameId)
      .eq("live_session_id", active.id)
      .maybeSingle();

    if (liveGameError) {
      return NextResponse.json(
        { error: liveGameError.message || "Failed to load live game." },
        { status: 500 }
      );
    }

    if (!liveGame) {
      return NextResponse.json(
        { error: "Live game was not found." },
        { status: 404 }
      );
    }

    const previousPlayers = normalizeLiveExtraction(liveGame.extraction).players;
    const nextSelectedPlayerKeys = syncSelectedPlayerKeys(
      previousPlayers,
      nextPlayers,
      normalizeSelectedPlayerKeys(active.selected_player_keys)
    );

    const capturedAt =
      payload.capturedAt === undefined
        ? undefined
        : normalizeOptionalTimestamp(payload.capturedAt);

    const { error: updateError } = await supabase
      .from("live_session_games")
      .update({
        extraction: serializeLiveExtraction(nextPlayers),
        status: "ready",
        last_error: null,
        ...(capturedAt !== undefined ? { captured_at: capturedAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", liveGameId)
      .eq("live_session_id", active.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to update live game." },
        { status: 500 }
      );
    }

    const { error: sessionUpdateError } = await supabase
      .from("live_sessions")
      .update({
        selected_player_keys: nextSelectedPlayerKeys,
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id)
      .eq("user_id", userId);

    if (sessionUpdateError) {
      return NextResponse.json(
        {
          error:
            sessionUpdateError.message || "Failed to update selected player names.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update live game.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
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

  let payload: { liveGameId?: string } = {};
  try {
    payload = (await request.json()) as { liveGameId?: string };
  } catch {
    payload = {};
  }

  const liveGameId =
    typeof payload.liveGameId === "string" ? payload.liveGameId.trim() : "";
  if (!liveGameId) {
    return NextResponse.json(
      { error: "liveGameId is required." },
      { status: 400 }
    );
  }

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.id || !active.session_id) {
      return NextResponse.json(
        { error: "No active live session was found." },
        { status: 404 }
      );
    }

    const { data: liveGame, error: liveGameError } = await supabase
      .from("live_session_games")
      .select("id,storage_key")
      .eq("id", liveGameId)
      .eq("live_session_id", active.id)
      .maybeSingle();

    if (liveGameError) {
      return NextResponse.json(
        { error: liveGameError.message || "Failed to load live game." },
        { status: 500 }
      );
    }

    if (!liveGame) {
      return NextResponse.json(
        { error: "Live game was not found." },
        { status: 404 }
      );
    }

    await supabase
      .from("analysis_jobs")
      .delete()
      .eq("live_session_game_id", liveGameId)
      .eq("user_id", userId);

    const { error: deleteError } = await supabase
      .from("live_session_games")
      .delete()
      .eq("id", liveGameId)
      .eq("live_session_id", active.id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to delete live game." },
        { status: 500 }
      );
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
    if (liveGame.storage_key) {
      await supabase.storage.from(bucket).remove([liveGame.storage_key]);
    }

    const deletedSession = await cleanupLiveSessionIfEmpty(
      supabase,
      userId,
      active.id,
      active.session_id
    );

    return NextResponse.json({ ok: true, deletedSession });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete live game.",
      },
      { status: 500 }
    );
  }
}
