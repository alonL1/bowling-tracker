import { NextResponse } from "next/server";

import {
  normalizeSelectedPlayerKeys,
} from "../shared";
import { getActiveLiveSessionRecord, getLiveUserId, getServerSupabase } from "../server";
import {
  buildSelectionError,
  getSelectedPlayersForExtraction,
  insertLoggedGameFromSelectedPlayer,
} from "../../utils/logged-scoreboard";

export const runtime = "nodejs";

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

  const createdGameIds: string[] = [];

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.id || !active.session_id) {
      return NextResponse.json(
        { error: "No active live session was found." },
        { status: 404 }
      );
    }

    const selectedPlayerKeys = normalizeSelectedPlayerKeys(active.selected_player_keys);
    if (selectedPlayerKeys.length === 0) {
      return NextResponse.json(
        { error: "Choose exactly one player for each game before ending the session." },
        { status: 400 }
      );
    }

    const { data: liveGames, error: liveGamesError } = await supabase
      .from("live_session_games")
      .select(
        "id,capture_order,status,captured_at,captured_at_hint,created_at,extraction"
      )
      .eq("live_session_id", active.id)
      .order("capture_order", { ascending: true });

    if (liveGamesError) {
      return NextResponse.json(
        { error: liveGamesError.message || "Failed to load live session games." },
        { status: 500 }
      );
    }

    const games = liveGames ?? [];
    if (games.length === 0) {
      return NextResponse.json(
        { error: "Capture at least one scoreboard before ending the session." },
        { status: 400 }
      );
    }

    const unfinishedGame = games.find((game) => game.status !== "ready");
    if (unfinishedGame) {
      return NextResponse.json(
        {
          error:
            unfinishedGame.status === "error"
              ? "Remove or fix failed scoreboards before ending the session."
              : "Wait for all scoreboards to finish processing before ending the session.",
        },
        { status: 400 }
      );
    }

    for (const [index, liveGame] of games.entries()) {
      const { selectedPlayers } = getSelectedPlayersForExtraction(
        liveGame.extraction,
        selectedPlayerKeys
      );
      if (selectedPlayers.length !== 1) {
        return NextResponse.json(
          { error: buildSelectionError(`Game ${index + 1}`, selectedPlayers.length) },
          { status: 400 }
        );
      }
    }

    let earliestPlayedAt: string | null = null;

    for (const [index, liveGame] of games.entries()) {
      const { fullExtraction, selectedPlayers } = getSelectedPlayersForExtraction(
        liveGame.extraction,
        selectedPlayerKeys
      );

      if (selectedPlayers.length !== 1) {
        return NextResponse.json(
          { error: buildSelectionError(`Game ${index + 1}`, selectedPlayers.length) },
          { status: 400 }
        );
      }

      const created = await insertLoggedGameFromSelectedPlayer({
        supabase,
        userId,
        sessionId: active.session_id,
        source: liveGame,
        selectedPlayer: selectedPlayers[0],
        fullExtraction,
      });
      createdGameIds.push(created.gameId);

      if (
        !earliestPlayedAt ||
        Date.parse(created.playedAt) < Date.parse(earliestPlayedAt)
      ) {
        earliestPlayedAt = created.playedAt;
      }
    }

    const { error: updateSessionError } = await supabase
      .from("bowling_sessions")
      .update({
        started_at: earliestPlayedAt,
      })
      .eq("id", active.session_id)
      .eq("user_id", userId);

    if (updateSessionError) {
      throw new Error(updateSessionError.message || "Failed to update session.");
    }

    await supabase
      .from("analysis_jobs")
      .delete()
      .eq("live_session_id", active.id)
      .eq("user_id", userId);

    await supabase
      .from("live_session_games")
      .delete()
      .eq("live_session_id", active.id);

    await supabase
      .from("live_sessions")
      .delete()
      .eq("id", active.id)
      .eq("user_id", userId);

    return NextResponse.json({
      ok: true,
      sessionId: active.session_id,
      loggedGameCount: createdGameIds.length,
    });
  } catch (error) {
    if (createdGameIds.length > 0) {
      await supabase.from("games").delete().in("id", createdGameIds);
    }
    const message =
      error instanceof Error ? error.message : "Failed to end live session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
