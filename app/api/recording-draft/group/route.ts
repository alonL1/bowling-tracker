import { NextResponse } from "next/server";

import { getServerSupabase } from "../../live-session/server";
import {
  discardRecordingDraft,
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
} from "../server";

export const runtime = "nodejs";

type GroupPayload = {
  mode?: unknown;
  groupId?: string;
  name?: string | null;
  description?: string | null;
};

export async function PATCH(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as GroupPayload;
  if (!isRecordingDraftMode(payload.mode) || !payload.groupId) {
    return NextResponse.json({ error: "mode and groupId are required." }, { status: 400 });
  }

  const { data: group, error: groupError } = await supabase
    .from("recording_draft_groups")
    .select("id,draft_id")
    .eq("id", payload.groupId)
    .maybeSingle();

  if (groupError || !group) {
    return NextResponse.json(
      { error: groupError?.message || "Draft group not found." },
      { status: 404 }
    );
  }

  const { data: draft } = await supabase
    .from("recording_drafts")
    .select("id")
    .eq("id", group.draft_id)
    .eq("user_id", userId)
    .eq("mode", payload.mode)
    .eq("status", "active")
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft group not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("recording_draft_groups")
    .update({
      name: typeof payload.name === "string" ? payload.name.trim() || null : null,
      description:
        typeof payload.description === "string" ? payload.description.trim() || null : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.groupId);

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update draft group." },
      { status: 500 }
    );
  }

  return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
}

export async function DELETE(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase configuration." }, { status: 500 });
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let bodyPayload: GroupPayload = {};
  try {
    bodyPayload = (await request.json()) as GroupPayload;
  } catch {
    bodyPayload = {};
  }

  const { searchParams } = new URL(request.url);
  const mode = bodyPayload.mode ?? searchParams.get("mode");
  const groupId =
    (typeof bodyPayload.groupId === "string" ? bodyPayload.groupId : null) ??
    searchParams.get("groupId");

  if (!isRecordingDraftMode(mode) || !groupId) {
    return NextResponse.json({ error: "mode and groupId are required." }, { status: 400 });
  }

  const { data: group } = await supabase
    .from("recording_draft_groups")
    .select("id,draft_id")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return NextResponse.json({ error: "Draft group not found." }, { status: 404 });
  }

  const { data: draft } = await supabase
    .from("recording_drafts")
    .select("id")
    .eq("id", group.draft_id)
    .eq("user_id", userId)
    .eq("mode", mode)
    .eq("status", "active")
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft group not found." }, { status: 404 });
  }

  const { data: games } = await supabase
    .from("recording_draft_games")
    .select("id")
    .eq("group_id", groupId);

  const gameIds = (games ?? []).map((game) => game.id);
  if (gameIds.length > 0) {
    await supabase.from("analysis_jobs").delete().in("recording_draft_game_id", gameIds);
    await supabase.from("recording_draft_games").delete().in("id", gameIds);
  }

  await supabase.from("recording_draft_groups").delete().eq("id", groupId);

  const { count, error: remainingGamesError } = await supabase
    .from("recording_draft_games")
    .select("id", { count: "exact", head: true })
    .eq("draft_id", draft.id);

  if (remainingGamesError) {
    return NextResponse.json(
      { error: remainingGamesError.message || "Failed to inspect remaining draft games." },
      { status: 500 }
    );
  }

  if ((count ?? 0) === 0) {
    await discardRecordingDraft(userId, mode);
    return NextResponse.json({ draft: null });
  }

  return NextResponse.json(await loadRecordingDraftPayload(userId, mode));
}
