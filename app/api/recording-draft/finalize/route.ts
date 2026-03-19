import { NextResponse } from "next/server";

import { normalizeSelectedPlayerKeys } from "../../live-session/shared";
import { getServerSupabase } from "../../live-session/server";
import {
  buildSelectionError,
  getSelectedPlayersForExtraction,
  insertLoggedGameFromSelectedPlayer,
} from "../../utils/logged-scoreboard";
import {
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
} from "../server";

export const runtime = "nodejs";

const NEW_SESSION_TARGET = "__new-session__";

export async function POST(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    mode?: unknown;
    targetSessionId?: string | null;
    name?: string | null;
    description?: string | null;
  };

  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  try {
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

    const createdGameIds: string[] = [];
    const createdSessionIds: string[] = [];
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

    return NextResponse.json({
      ok: true,
      createdGameIds,
      createdSessionIds,
      primarySessionId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to finalize recording draft.",
      },
      { status: 500 }
    );
  }
}
