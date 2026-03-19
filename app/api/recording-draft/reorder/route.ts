import { NextResponse } from "next/server";

import { getServerSupabase } from "../../live-session/server";
import {
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
} from "../server";

export const runtime = "nodejs";

const EDGE_GAP_MS = 10 * 60 * 1000;

type ReorderPayload = {
  mode?: unknown;
  gameId?: string;
  targetGroupId?: string | null;
  beforeGameId?: string | null;
  afterGameId?: string | null;
};

function resolveTime(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PATCH(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as ReorderPayload;
  if (!isRecordingDraftMode(payload.mode) || !payload.gameId) {
    return NextResponse.json({ error: "mode and gameId are required." }, { status: 400 });
  }

  const { data: game } = await supabase
    .from("recording_draft_games")
    .select("id,draft_id,group_id,sort_at,captured_at,captured_at_hint,created_at")
    .eq("id", payload.gameId)
    .maybeSingle();

  if (!game) {
    return NextResponse.json({ error: "Draft game not found." }, { status: 404 });
  }

  const { data: draft } = await supabase
    .from("recording_drafts")
    .select("id")
    .eq("id", game.draft_id)
    .eq("user_id", userId)
    .eq("mode", payload.mode)
    .eq("status", "active")
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft game not found." }, { status: 404 });
  }

  if (payload.targetGroupId) {
    const { data: targetGroup } = await supabase
      .from("recording_draft_groups")
      .select("id")
      .eq("id", payload.targetGroupId)
      .eq("draft_id", draft.id)
      .maybeSingle();

    if (!targetGroup) {
      return NextResponse.json({ error: "Target draft group not found." }, { status: 404 });
    }
  }

  const neighborIds = [payload.beforeGameId, payload.afterGameId].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  const { data: neighbors } =
    neighborIds.length === 0
      ? { data: [] as Array<{ id: string; sort_at?: string | null; captured_at?: string | null; captured_at_hint?: string | null; created_at?: string | null }> }
      : await supabase
          .from("recording_draft_games")
          .select("id,sort_at,captured_at,captured_at_hint,created_at")
          .eq("draft_id", draft.id)
          .in("id", neighborIds);

  const before = (neighbors ?? []).find((entry) => entry.id === payload.beforeGameId);
  const after = (neighbors ?? []).find((entry) => entry.id === payload.afterGameId);

  const beforeTime = resolveTime(
    before?.sort_at || before?.captured_at || before?.captured_at_hint || before?.created_at
  );
  const afterTime = resolveTime(
    after?.sort_at || after?.captured_at || after?.captured_at_hint || after?.created_at
  );

  let nextSortAt = Date.now();
  if (beforeTime !== null && afterTime !== null) {
    nextSortAt = Math.floor((beforeTime + afterTime) / 2);
  } else if (beforeTime !== null) {
    nextSortAt = beforeTime - EDGE_GAP_MS;
  } else if (afterTime !== null) {
    nextSortAt = afterTime + EDGE_GAP_MS;
  } else {
    nextSortAt = resolveTime(
      game.sort_at || game.captured_at || game.captured_at_hint || game.created_at
    ) ?? Date.now();
  }

  const { error } = await supabase
    .from("recording_draft_games")
    .update({
      group_id: payload.targetGroupId || null,
      sort_at: new Date(nextSortAt).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.gameId);

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to reorder draft game." },
      { status: 500 }
    );
  }

  return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
}
