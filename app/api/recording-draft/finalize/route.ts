import { NextResponse } from "next/server";

import { normalizeSelectedPlayerKeys } from "../../live-session/shared";
import { getServerSupabase } from "../../live-session/server";
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
import {
  getActiveRecordingDraftRecord,
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
  type RecordingDraftMode,
} from "../server";

export const runtime = "nodejs";

const NEW_SESSION_TARGET = "__new-session__";

type FinalizeRecordingDraftPayload = {
  mode?: unknown;
  targetSessionId?: string | null;
  name?: string | null;
  description?: string | null;
  clientOperationId?: string | null;
};

type ExistingDraftFinalizeResponse = {
  ok: true;
  createdGameIds: string[];
  createdSessionIds: string[];
  primarySessionId: string | null;
};

async function reconcileFinalizedDraft(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  userId: string,
  payload: {
    mode: RecordingDraftMode;
    targetSessionId?: string | null;
    clientOperationId: string;
  }
) {
  const activeDraft = await getActiveRecordingDraftRecord(userId, payload.mode);
  if (activeDraft) {
    return null;
  }

  const { data: createdGames, error: createdGamesError } = await supabase
    .from("games")
    .select("id,session_id")
    .eq("user_id", userId)
    .eq("client_finalize_operation_id", payload.clientOperationId)
    .order("created_at", { ascending: true });

  if (createdGamesError) {
    throw new Error(
      createdGamesError.message || "Failed to load existing finalized draft games."
    );
  }

  if (!createdGames || createdGames.length === 0) {
    return null;
  }

  const { data: createdSessions, error: createdSessionsError } = await supabase
    .from("bowling_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("client_finalize_operation_id", payload.clientOperationId)
    .order("created_at", { ascending: true });

  if (createdSessionsError) {
    throw new Error(
      createdSessionsError.message ||
        "Failed to load existing finalized recording draft sessions."
    );
  }

  const createdSessionIds = (createdSessions ?? [])
    .map((session) => (typeof session.id === "string" ? session.id : null))
    .filter((sessionId): sessionId is string => Boolean(sessionId));
  const fallbackSessionId =
    createdGames.find(
      (game) => typeof game.session_id === "string" && game.session_id.length > 0
    )?.session_id ?? null;

  return {
    ok: true,
    createdGameIds: createdGames
      .map((game) => (typeof game.id === "string" ? game.id : null))
      .filter((gameId): gameId is string => Boolean(gameId)),
    createdSessionIds,
    primarySessionId:
      payload.mode === "add_existing_session"
        ? payload.targetSessionId === NEW_SESSION_TARGET
          ? createdSessionIds[0] ?? fallbackSessionId
          : payload.targetSessionId || fallbackSessionId
        : createdSessionIds[0] ?? fallbackSessionId,
  } satisfies ExistingDraftFinalizeResponse;
}

export async function POST(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as FinalizeRecordingDraftPayload;

  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  const clientOperationId = normalizeClientOperationKey(payload.clientOperationId);
  const createdGameIds: string[] = [];
  const createdSessionIds: string[] = [];
  let claimedOperation = false;

  try {
    if (clientOperationId) {
      const reconciledResponse = await reconcileFinalizedDraft(supabase, userId, {
        mode: payload.mode,
        targetSessionId: payload.targetSessionId,
        clientOperationId,
      });

      if (reconciledResponse) {
        await completeMobileSyncOperation(
          supabase,
          userId,
          MOBILE_SYNC_SCOPE.recordingDraftFinalize,
          clientOperationId,
          reconciledResponse
        );
        return NextResponse.json(reconciledResponse);
      }

      const operation =
        await beginMobileSyncOperation<ExistingDraftFinalizeResponse>(
          supabase,
          userId,
          MOBILE_SYNC_SCOPE.recordingDraftFinalize,
          clientOperationId
        );

      if (operation.kind === "completed") {
        return NextResponse.json(operation.response);
      }

      if (operation.kind === "in_progress") {
        return NextResponse.json(
          { error: "These uploads are already being finalized. Retry in a moment." },
          { status: 409 }
        );
      }

      claimedOperation = true;
    }

    const draftPayload = await loadRecordingDraftPayload(userId, payload.mode);
    const draft = draftPayload.draft;
    if (!draft) {
      return NextResponse.json({ error: "No active draft was found." }, { status: 404 });
    }

    const allGames = draft.groups.flatMap((group) => group.games);
    if (allGames.length === 0) {
      return NextResponse.json(
        { error: "Add at least one scoreboard before finalizing." },
        { status: 400 }
      );
    }

    const unfinishedGame = allGames.find((game) => game.status !== "ready");
    if (unfinishedGame) {
      return NextResponse.json(
        {
          error:
            unfinishedGame.status === "error"
              ? "Remove or fix failed scoreboards before continuing."
              : "Wait for all scoreboards to finish processing before continuing.",
        },
        { status: 400 }
      );
    }

    const selectedPlayerKeys = normalizeSelectedPlayerKeys(draft.selectedPlayerKeys);
    if (selectedPlayerKeys.length === 0) {
      return NextResponse.json(
        { error: "Choose exactly one player for each game before continuing." },
        { status: 400 }
      );
    }

    const groupsToFinalize = draft.groups.filter((group) => group.games.length > 0);
    let validationGameNumber = 0;

    for (const group of groupsToFinalize) {
      for (const game of group.games) {
        validationGameNumber += 1;
        const { selectedPlayers } = getSelectedPlayersForExtraction(
          game.extraction,
          selectedPlayerKeys
        );

        if (selectedPlayers.length !== 1) {
          return NextResponse.json(
            {
              error: buildSelectionError(
                `Game ${validationGameNumber}`,
                selectedPlayers.length
              ),
            },
            { status: 400 }
          );
        }
      }
    }

    for (const group of groupsToFinalize) {
      let sessionId: string | null = null;

      if (payload.mode === "add_existing_session") {
        const requestedTarget = payload.targetSessionId || draft.targetSessionId || null;
        if (!requestedTarget) {
          return NextResponse.json(
            { error: "Choose a session before adding these games." },
            { status: 400 }
          );
        }
        if (requestedTarget === NEW_SESSION_TARGET) {
          const earliestStartedAt =
            group.games
              .map((game) => game.sort_at || game.captured_at || game.captured_at_hint || game.created_at)
              .find(Boolean) ?? null;
          const { data: createdSession, error: createSessionError } = await supabase
            .from("bowling_sessions")
            .insert({
              user_id: userId,
              client_finalize_operation_id: clientOperationId,
              name: typeof payload.name === "string" ? payload.name.trim() || null : null,
              description:
                typeof payload.description === "string"
                  ? payload.description.trim() || null
                  : null,
              started_at: earliestStartedAt,
            })
            .select("id")
            .single();

          if (createSessionError || !createdSession) {
            throw new Error(createSessionError?.message || "Failed to create session.");
          }
          sessionId = createdSession.id as string;
          createdSessionIds.push(sessionId);
        } else {
          sessionId = requestedTarget;
        }
      } else if (payload.mode === "upload_session") {
        const earliestStartedAt =
          group.games
            .map((game) => game.sort_at || game.captured_at || game.captured_at_hint || game.created_at)
            .find(Boolean) ?? null;
        const { data: createdSession, error: createSessionError } = await supabase
          .from("bowling_sessions")
          .insert({
            user_id: userId,
            client_finalize_operation_id: clientOperationId,
            name:
              typeof payload.name === "string"
                ? payload.name.trim() || null
                : typeof draft.name === "string"
                  ? draft.name.trim() || null
                  : null,
            description:
              typeof payload.description === "string"
                ? payload.description.trim() || null
                : typeof draft.description === "string"
                  ? draft.description.trim() || null
                  : null,
            started_at: earliestStartedAt,
          })
          .select("id")
          .single();

        if (createSessionError || !createdSession) {
          throw new Error(createSessionError?.message || "Failed to create session.");
        }
        sessionId = createdSession.id as string;
        createdSessionIds.push(sessionId);
      } else {
        const earliestStartedAt =
          group.games
            .map((game) => game.sort_at || game.captured_at || game.captured_at_hint || game.created_at)
            .find(Boolean) ?? null;
        const { data: createdSession, error: createSessionError } = await supabase
          .from("bowling_sessions")
          .insert({
            user_id: userId,
            client_finalize_operation_id: clientOperationId,
            name: typeof group.name === "string" ? group.name.trim() || null : null,
            description:
              typeof group.description === "string" ? group.description.trim() || null : null,
            started_at: earliestStartedAt,
          })
          .select("id")
          .single();

        if (createSessionError || !createdSession) {
          throw new Error(createSessionError?.message || "Failed to create session.");
        }
        sessionId = createdSession.id as string;
        createdSessionIds.push(sessionId);
      }

      if (!sessionId) {
        throw new Error("Finalization could not determine a target session.");
      }

      for (const game of group.games) {
        const { fullExtraction, selectedPlayers } = getSelectedPlayersForExtraction(
          game.extraction,
          selectedPlayerKeys
        );

        const created = await insertLoggedGameFromSelectedPlayer({
          supabase,
          userId,
          sessionId,
          source: game,
          selectedPlayer: selectedPlayers[0],
          fullExtraction,
          clientFinalizeOperationId: clientOperationId,
        });
        createdGameIds.push(created.gameId);
      }
    }

    await supabase
      .from("analysis_jobs")
      .delete()
      .eq("recording_draft_id", draft.id)
      .eq("user_id", userId);
    await supabase.from("recording_draft_games").delete().eq("draft_id", draft.id);
    await supabase.from("recording_draft_groups").delete().eq("draft_id", draft.id);
    await supabase
      .from("recording_drafts")
      .update({
        status: "finalized",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("user_id", userId);

    const primarySessionId =
      payload.mode === "add_existing_session"
        ? payload.targetSessionId === NEW_SESSION_TARGET
          ? createdSessionIds[0] ?? null
          : payload.targetSessionId || draft.targetSessionId || null
        : createdSessionIds[0] ?? null;

    const responsePayload = {
      ok: true,
      createdGameIds,
      createdSessionIds,
      primarySessionId,
    } satisfies ExistingDraftFinalizeResponse;

    if (clientOperationId) {
      await completeMobileSyncOperation(
        supabase,
        userId,
        MOBILE_SYNC_SCOPE.recordingDraftFinalize,
        clientOperationId,
        responsePayload
      );
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    if (createdGameIds.length > 0) {
      await supabase.from("games").delete().in("id", createdGameIds);
    }
    if (createdSessionIds.length > 0) {
      await supabase.from("bowling_sessions").delete().in("id", createdSessionIds);
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to finalize recording draft.";
    if (clientOperationId && claimedOperation) {
      await failMobileSyncOperation(
        supabase,
        userId,
        MOBILE_SYNC_SCOPE.recordingDraftFinalize,
        clientOperationId,
        message
      ).catch(() => undefined);
    }
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
