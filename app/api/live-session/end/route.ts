import { NextResponse } from "next/server";

import {
  normalizeSelectedPlayerKeys,
} from "../shared";
import { getActiveLiveSessionRecord, getLiveUserId, getServerSupabase } from "../server";
import {
  beginMobileSyncOperation,
  completeMobileSyncOperation,
  failMobileSyncOperation,
  MOBILE_SYNC_SCOPE,
  normalizeClientOperationKey,
} from "../../utils/mobile-sync-operations";
import {
  buildSelectionError,
  getSelectedPlayersForExtraction,
  insertLoggedGameFromSelectedPlayer,
} from "../../utils/logged-scoreboard";

export const runtime = "nodejs";

type EndLiveSessionPayload = {
  clientOperationId?: string | null;
};

type ExistingLiveSessionEndResponse = {
  ok: true;
  sessionId: string;
  loggedGameCount: number;
};

async function reconcileEndedLiveSession(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  userId: string,
  clientOperationId: string
) {
  const { data: existingGames, error: existingGamesError } = await supabase
    .from("games")
    .select("id,session_id")
    .eq("user_id", userId)
    .eq("client_finalize_operation_id", clientOperationId)
    .order("created_at", { ascending: true });

  if (existingGamesError) {
    throw new Error(
      existingGamesError.message || "Failed to load existing finalized live session."
    );
  }

  if (!existingGames || existingGames.length === 0) {
    return null;
  }

  const sessionId =
    existingGames.find(
      (game) => typeof game.session_id === "string" && game.session_id.length > 0
    )?.session_id ?? null;

  if (!sessionId) {
    return null;
  }

  const activeLiveSession = await getActiveLiveSessionRecord(supabase, userId);
  if (activeLiveSession?.session_id === sessionId) {
    return null;
  }

  return {
    ok: true,
    sessionId,
    loggedGameCount: existingGames.length,
  } satisfies ExistingLiveSessionEndResponse;
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

  const payload = (await request.json().catch(() => ({}))) as EndLiveSessionPayload;
  const clientOperationId = normalizeClientOperationKey(payload.clientOperationId);
  const createdGameIds: string[] = [];
  let claimedOperation = false;

  try {
    if (clientOperationId) {
      const reconciledResponse = await reconcileEndedLiveSession(
        supabase,
        userId,
        clientOperationId
      );

      if (reconciledResponse) {
        await completeMobileSyncOperation(
          supabase,
          userId,
          MOBILE_SYNC_SCOPE.liveSessionEnd,
          clientOperationId,
          reconciledResponse
        );
        return NextResponse.json(reconciledResponse);
      }

      const operation = await beginMobileSyncOperation<ExistingLiveSessionEndResponse>(
        supabase,
        userId,
        MOBILE_SYNC_SCOPE.liveSessionEnd,
        clientOperationId
      );

      if (operation.kind === "completed") {
        return NextResponse.json(operation.response);
      }

      if (operation.kind === "in_progress") {
        return NextResponse.json(
          { error: "This live session is already being finalized. Retry in a moment." },
          { status: 409 }
        );
      }

      claimedOperation = true;
    }

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
        clientFinalizeOperationId: clientOperationId,
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

    const responsePayload = {
      ok: true,
      sessionId: active.session_id,
      loggedGameCount: createdGameIds.length,
    } satisfies ExistingLiveSessionEndResponse;

    if (clientOperationId) {
      await completeMobileSyncOperation(
        supabase,
        userId,
        MOBILE_SYNC_SCOPE.liveSessionEnd,
        clientOperationId,
        responsePayload
      );
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (createdGameIds.length > 0) {
      await supabase.from("games").delete().in("id", createdGameIds);
    }
    const message =
      error instanceof Error ? error.message : "Failed to end live session.";
    if (clientOperationId && claimedOperation) {
      await failMobileSyncOperation(
        supabase,
        userId,
        MOBILE_SYNC_SCOPE.liveSessionEnd,
        clientOperationId,
        message
      ).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
