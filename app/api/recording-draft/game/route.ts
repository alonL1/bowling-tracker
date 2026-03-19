import { NextResponse } from "next/server";

import {
  normalizeLiveExtraction,
  normalizeLivePlayers,
  normalizeOptionalTimestamp,
  normalizeSelectedPlayerKeys,
  serializeLiveExtraction,
  syncSelectedPlayerKeys,
  type RawLivePlayer,
} from "../../live-session/shared";
import { getServerSupabase } from "../../live-session/server";
import {
  discardRecordingDraft,
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
} from "../server";

export const runtime = "nodejs";

type UpdateRecordingDraftGamePayload = {
  mode?: unknown;
  draftGameId?: string;
  players?: RawLivePlayer[];
  capturedAt?: string | null;
};

async function loadDraftGameRecord({
  mode,
  draftGameId,
  userId,
}: {
  mode: "upload_session" | "add_multiple_sessions" | "add_existing_session";
  draftGameId: string;
  userId: string;
}) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const draftPayload = await loadRecordingDraftPayload(userId, mode);
  const draft = draftPayload.draft;
  if (!draft) {
    throw new Error("No active recording draft was found.");
  }

  const game = draft.groups.flatMap((group) => group.games).find((entry) => entry.id === draftGameId);
  if (!game) {
    throw new Error("Draft game was not found.");
  }

  return {
    draft,
    game,
    supabase,
  };
}

export async function PATCH(request: Request) {
  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as UpdateRecordingDraftGamePayload;
  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  const draftGameId =
    typeof payload.draftGameId === "string" ? payload.draftGameId.trim() : "";
  if (!draftGameId) {
    return NextResponse.json({ error: "draftGameId is required." }, { status: 400 });
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
    const { draft, game, supabase } = await loadDraftGameRecord({
      mode: payload.mode,
      draftGameId,
      userId,
    });

    const previousPlayers = normalizeLiveExtraction(game.extraction).players;
    const nextSelectedPlayerKeys = syncSelectedPlayerKeys(
      previousPlayers,
      nextPlayers,
      normalizeSelectedPlayerKeys(draft.selectedPlayerKeys)
    );

    const capturedAt =
      payload.capturedAt === undefined
        ? undefined
        : normalizeOptionalTimestamp(payload.capturedAt);

    const { error: updateError } = await supabase
      .from("recording_draft_games")
      .update({
        extraction: serializeLiveExtraction(nextPlayers),
        status: "ready",
        last_error: null,
        ...(capturedAt !== undefined ? { captured_at: capturedAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftGameId)
      .eq("draft_id", draft.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to update draft game." },
        { status: 500 }
      );
    }

    const { error: draftUpdateError } = await supabase
      .from("recording_drafts")
      .update({
        selected_player_keys: nextSelectedPlayerKeys,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
      .eq("user_id", userId);

    if (draftUpdateError) {
      return NextResponse.json(
        { error: draftUpdateError.message || "Failed to update draft players." },
        { status: 500 }
      );
    }

    return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update draft game.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: { mode?: unknown; draftGameId?: string } = {};
  try {
    payload = (await request.json()) as { mode?: unknown; draftGameId?: string };
  } catch {
    payload = {};
  }

  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  const draftGameId =
    typeof payload.draftGameId === "string" ? payload.draftGameId.trim() : "";
  if (!draftGameId) {
    return NextResponse.json({ error: "draftGameId is required." }, { status: 400 });
  }

  try {
    const { draft, game, supabase } = await loadDraftGameRecord({
      mode: payload.mode,
      draftGameId,
      userId,
    });

    await supabase
      .from("analysis_jobs")
      .delete()
      .eq("recording_draft_game_id", draftGameId)
      .eq("user_id", userId);

    const { error: deleteError } = await supabase
      .from("recording_draft_games")
      .delete()
      .eq("id", draftGameId)
      .eq("draft_id", draft.id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to delete draft game." },
        { status: 500 }
      );
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
    if (game.storage_key) {
      await supabase.storage.from(bucket).remove([game.storage_key]);
    }

    const { count, error: countError } = await supabase
      .from("recording_draft_games")
      .select("id", { count: "exact", head: true })
      .eq("draft_id", draft.id);

    if (countError) {
      return NextResponse.json(
        { error: countError.message || "Failed to inspect draft games." },
        { status: 500 }
      );
    }

    if ((count ?? 0) === 0) {
      await discardRecordingDraft(userId, payload.mode);
      return NextResponse.json({ draft: null });
    }

    return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete draft game.",
      },
      { status: 500 }
    );
  }
}
