import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeLiveExtraction,
  serializeLiveExtraction,
  type NormalizedLivePlayer,
} from "../live-session/shared";

type ScoreboardSource = {
  captured_at?: string | null;
  captured_at_hint?: string | null;
  created_at?: string | null;
  sort_at?: string | null;
};

export function computeStrike(shot1: number | null) {
  return shot1 === 10;
}

export function computeSpare(shot1: number | null, shot2: number | null) {
  return shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10;
}

export function computePlayedAt(source: ScoreboardSource) {
  return (
    source.sort_at ||
    source.captured_at ||
    source.captured_at_hint ||
    source.created_at ||
    new Date().toISOString()
  );
}

export function buildSelectionError(gameLabel: string, selectedCount: number) {
  if (selectedCount === 0) {
    return `${gameLabel} does not have a player selected as yourself. Choose exactly one name before continuing.`;
  }

  return `${gameLabel} has 2 or more players selected as yourself. If you really want both those scores logged as 'you' then you can add the same game again and select the other name.`;
}

export function getSelectedPlayersForExtraction(
  extraction: unknown,
  selectedPlayerKeys: string[]
) {
  const normalized = normalizeLiveExtraction(extraction);
  const selectedKeySet = new Set(selectedPlayerKeys);
  const selectedPlayers = normalized.players.filter((player) =>
    selectedKeySet.has(player.playerKey)
  );

  return {
    fullExtraction: normalized,
    selectedPlayers,
  };
}

export async function insertLoggedGameFromSelectedPlayer({
  supabase,
  userId,
  sessionId,
  source,
  selectedPlayer,
  fullExtraction,
  clientFinalizeOperationId,
}: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  source: ScoreboardSource;
  selectedPlayer: NormalizedLivePlayer;
  fullExtraction: ReturnType<typeof normalizeLiveExtraction>;
  clientFinalizeOperationId?: string | null;
}) {
  const playedAt = computePlayedAt(source);

  const { data: createdGame, error: createGameError } = await supabase
    .from("games")
    .insert({
      user_id: userId,
      session_id: sessionId,
      client_finalize_operation_id: clientFinalizeOperationId ?? null,
      game_name: null,
      player_name: selectedPlayer.playerName,
      total_score: selectedPlayer.totalScore,
      captured_at: source.captured_at || null,
      played_at: playedAt,
      status: "logged",
      raw_extraction: serializeLiveExtraction([selectedPlayer]),
      scoreboard_extraction: serializeLiveExtraction(fullExtraction.players),
      selected_self_player_key: selectedPlayer.playerKey,
      selected_self_player_name: selectedPlayer.playerName,
    })
    .select("id")
    .single();

  if (createGameError || !createdGame) {
    throw new Error(createGameError?.message || "Failed to create logged game.");
  }

  const frameRows = selectedPlayer.frames.map((frame) => ({
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
  const shotRows = selectedPlayer.frames.flatMap((frame) =>
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

  return {
    gameId: createdGame.id as string,
    playedAt,
  };
}

export async function syncLoggedGameSelection({
  supabase,
  gameId,
  fullExtraction,
  selectedPlayer,
}: {
  supabase: SupabaseClient;
  gameId: string;
  fullExtraction: ReturnType<typeof normalizeLiveExtraction>;
  selectedPlayer: NormalizedLivePlayer;
}) {
  const { error: gameError } = await supabase
    .from("games")
    .update({
      player_name: selectedPlayer.playerName,
      total_score: selectedPlayer.totalScore,
      status: "logged",
      raw_extraction: serializeLiveExtraction([selectedPlayer]),
      scoreboard_extraction: serializeLiveExtraction(fullExtraction.players),
      selected_self_player_key: selectedPlayer.playerKey,
      selected_self_player_name: selectedPlayer.playerName,
    })
    .eq("id", gameId);

  if (gameError) {
    throw new Error(gameError.message || "Failed to update logged game selection.");
  }

  const { data: existingFrames, error: existingFramesError } = await supabase
    .from("frames")
    .select("id")
    .eq("game_id", gameId);

  if (existingFramesError) {
    throw new Error(existingFramesError.message || "Failed to load existing frames.");
  }

  const frameIds = (existingFrames ?? [])
    .map((frame) => frame.id)
    .filter((frameId): frameId is string => typeof frameId === "string" && frameId.length > 0);

  if (frameIds.length > 0) {
    const { error: deleteShotsError } = await supabase
      .from("shots")
      .delete()
      .in("frame_id", frameIds);

    if (deleteShotsError) {
      throw new Error(deleteShotsError.message || "Failed to clear existing shots.");
    }
  }

  const { error: deleteFramesError } = await supabase
    .from("frames")
    .delete()
    .eq("game_id", gameId);

  if (deleteFramesError) {
    throw new Error(deleteFramesError.message || "Failed to clear existing frames.");
  }

  const frameRows = selectedPlayer.frames.map((frame) => ({
    game_id: gameId,
    frame_number: frame.frame,
    is_strike: computeStrike(frame.shots[0]),
    is_spare: computeSpare(frame.shots[0], frame.shots[1]),
    frame_score: null,
  }));

  const { data: insertedFrames, error: insertFramesError } = await supabase
    .from("frames")
    .insert(frameRows)
    .select("id,frame_number");

  if (insertFramesError) {
    throw new Error(insertFramesError.message || "Failed to recreate frames.");
  }

  const frameIdByNumber = new Map(
    (insertedFrames ?? []).map((frame) => [frame.frame_number, frame.id])
  );
  const shotRows = selectedPlayer.frames.flatMap((frame) =>
    frame.shots.map((pins, shotIndex) => ({
      frame_id: frameIdByNumber.get(frame.frame),
      shot_number: shotIndex + 1,
      pins,
    }))
  );

  const validShotRows = shotRows.filter(
    (row): row is { frame_id: string; shot_number: number; pins: number | null } =>
      typeof row.frame_id === "string" && row.frame_id.length > 0
  );

  if (validShotRows.length > 0) {
    const { error: insertShotsError } = await supabase.from("shots").insert(validShotRows);
    if (insertShotsError) {
      throw new Error(insertShotsError.message || "Failed to recreate shots.");
    }
  }
}
