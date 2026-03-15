import { NextResponse } from "next/server";

import {
  normalizeLiveExtraction,
  normalizeSelectedPlayerKeys,
  serializeLiveExtraction,
} from "../shared";
import { getActiveLiveSessionRecord, getLiveUserId, getServerSupabase } from "../server";

export const runtime = "nodejs";

function computeStrike(shot1: number | null) {
  return shot1 === 10;
}

function computeSpare(shot1: number | null, shot2: number | null) {
  return (
    shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10
  );
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
        { error: "Choose at least one player before ending the session." },
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

    let earliestPlayedAt: string | null = null;
    let loggedGameCount = 0;

    for (const liveGame of games) {
      const normalizedPlayers = normalizeLiveExtraction(liveGame.extraction).players;
      const selectedPlayers = normalizedPlayers.filter((player) =>
        selectedPlayerKeys.includes(player.playerKey)
      );

      const playedAt =
        liveGame.captured_at ||
        liveGame.captured_at_hint ||
        liveGame.created_at ||
        new Date().toISOString();

      if (
        !earliestPlayedAt ||
        Date.parse(playedAt) < Date.parse(earliestPlayedAt)
      ) {
        earliestPlayedAt = playedAt;
      }

      for (const player of selectedPlayers) {
        const { data: createdGame, error: createGameError } = await supabase
          .from("games")
          .insert({
            user_id: userId,
            session_id: active.session_id,
            game_name: null,
            player_name: player.playerName,
            total_score: player.totalScore,
            captured_at: liveGame.captured_at,
            played_at: playedAt,
            status: "logged",
            raw_extraction: serializeLiveExtraction([player]),
          })
          .select("id")
          .single();

        if (createGameError || !createdGame) {
          throw new Error(createGameError?.message || "Failed to create logged game.");
        }

        createdGameIds.push(createdGame.id as string);
        loggedGameCount += 1;

        const frameRows = player.frames.map((frame) => ({
          game_id: createdGame.id,
          frame_number: frame.frame,
          is_strike: computeStrike(frame.shots[0]),
          is_spare: computeSpare(frame.shots[0], frame.shots[1]),
          frame_score: null,
        }));

        const { data: insertedFrames, error: frameError } = await supabase
          .from("frames")
          .insert(frameRows)
          .select("id,frame_number");

        if (frameError) {
          throw new Error(frameError.message || "Failed to create logged frames.");
        }

        const frameIdByNumber = new Map(
          (insertedFrames ?? []).map((frame) => [frame.frame_number, frame.id])
        );
        const shotRows = player.frames.flatMap((frame) =>
          frame.shots.map((pins, shotIndex) => ({
            frame_id: frameIdByNumber.get(frame.frame),
            shot_number: shotIndex + 1,
            pins,
          }))
        );

        const validShotRows = shotRows.filter((row) => row.frame_id);
        if (validShotRows.length > 0) {
          const { error: shotError } = await supabase.from("shots").insert(validShotRows);
          if (shotError) {
            throw new Error(shotError.message || "Failed to create logged shots.");
          }
        }
      }
    }

    if (loggedGameCount === 0) {
      return NextResponse.json(
        {
          error:
            "None of the selected player names were present in the captured scoreboards.",
        },
        { status: 400 }
      );
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
      loggedGameCount,
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
