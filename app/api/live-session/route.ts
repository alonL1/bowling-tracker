import { NextResponse } from "next/server";

import { normalizeSelectedPlayerKeys } from "./shared";
import {
  buildLiveSessionPayload,
  getActiveLiveSessionRecord,
  getLiveUserId,
  getServerSupabase,
} from "./server";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  try {
    return NextResponse.json(await buildLiveSessionPayload(supabase, userId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load live session." },
      { status: 500 }
    );
  }
}

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

  const payload = (await request.json()) as {
    selectedPlayerKeys?: unknown;
    name?: string;
    description?: string;
  };

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.session_id) {
      return NextResponse.json(
        { error: "No active live session was found." },
        { status: 404 }
      );
    }

    const selectedPlayerKeys =
      payload.selectedPlayerKeys === undefined
        ? normalizeSelectedPlayerKeys(active.selected_player_keys)
        : normalizeSelectedPlayerKeys(payload.selectedPlayerKeys);
    const name = typeof payload.name === "string" ? payload.name.trim() : undefined;
    const description =
      typeof payload.description === "string" ? payload.description.trim() : undefined;

    const { error: liveUpdateError } = await supabase
      .from("live_sessions")
      .update({
        selected_player_keys: selectedPlayerKeys,
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id)
      .eq("user_id", userId);

    if (liveUpdateError) {
      return NextResponse.json(
        { error: liveUpdateError.message || "Failed to update live session." },
        { status: 500 }
      );
    }

    if (name !== undefined || description !== undefined) {
      const { error: sessionUpdateError } = await supabase
        .from("bowling_sessions")
        .update({
          ...(name !== undefined ? { name: name || null } : null),
          ...(description !== undefined ? { description: description || null } : null),
        })
        .eq("id", active.session_id)
        .eq("user_id", userId);

      if (sessionUpdateError) {
        return NextResponse.json(
          { error: sessionUpdateError.message || "Failed to update session details." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(await buildLiveSessionPayload(supabase, userId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update live session." },
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

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.id || !active.session_id) {
      return NextResponse.json({ ok: true, discarded: false });
    }

    const { data: liveGames, error: liveGamesError } = await supabase
      .from("live_session_games")
      .select("id,storage_key")
      .eq("live_session_id", active.id);

    if (liveGamesError) {
      return NextResponse.json(
        { error: liveGamesError.message || "Failed to load live session games." },
        { status: 500 }
      );
    }

    await supabase
      .from("analysis_jobs")
      .delete()
      .eq("live_session_id", active.id)
      .eq("user_id", userId);

    const { error: deleteGamesError } = await supabase
      .from("live_session_games")
      .delete()
      .eq("live_session_id", active.id);

    if (deleteGamesError) {
      return NextResponse.json(
        { error: deleteGamesError.message || "Failed to discard live session games." },
        { status: 500 }
      );
    }

    const storageKeys = (liveGames ?? [])
      .map((game) => game.storage_key)
      .filter((storageKey): storageKey is string => typeof storageKey === "string" && storageKey.length > 0);
    if (storageKeys.length > 0) {
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
      await supabase.storage.from(bucket).remove(storageKeys);
    }

    const { error: deleteLiveSessionError } = await supabase
      .from("live_sessions")
      .delete()
      .eq("id", active.id)
      .eq("user_id", userId);

    if (deleteLiveSessionError) {
      return NextResponse.json(
        { error: deleteLiveSessionError.message || "Failed to discard live session." },
        { status: 500 }
      );
    }

    const { error: deleteSessionError } = await supabase
      .from("bowling_sessions")
      .delete()
      .eq("id", active.session_id)
      .eq("user_id", userId);

    if (deleteSessionError) {
      return NextResponse.json(
        { error: deleteSessionError.message || "Failed to discard live session details." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, discarded: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to discard live session.",
      },
      { status: 500 }
    );
  }
}
