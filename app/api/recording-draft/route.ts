import { NextResponse } from "next/server";

import {
  discardRecordingDraft,
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
} from "./server";
import { normalizeSelectedPlayerKeys } from "../live-session/shared";
import { getServerSupabase } from "../live-session/server";

export const runtime = "nodejs";

function getModeFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode");
  return isRecordingDraftMode(mode) ? mode : null;
}

export async function GET(request: Request) {
  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const mode = getModeFromRequest(request);
  if (!mode) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(await loadRecordingDraftPayload(userId, mode));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load recording draft.",
      },
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

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    mode?: unknown;
    selectedPlayerKeys?: unknown;
    targetSessionId?: string | null;
    name?: string | null;
    description?: string | null;
  };

  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (payload.selectedPlayerKeys !== undefined) {
    updates.selected_player_keys = normalizeSelectedPlayerKeys(payload.selectedPlayerKeys);
  }
  if (payload.targetSessionId !== undefined) {
    updates.target_session_id = payload.targetSessionId || null;
  }
  if (payload.name !== undefined) {
    updates.name = typeof payload.name === "string" ? payload.name.trim() || null : null;
  }
  if (payload.description !== undefined) {
    updates.description =
      typeof payload.description === "string" ? payload.description.trim() || null : null;
  }

  const { error } = await supabase
    .from("recording_drafts")
    .update(updates)
    .eq("user_id", userId)
    .eq("mode", payload.mode)
    .eq("status", "active");

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update recording draft." },
      { status: 500 }
    );
  }

  return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
}

export async function DELETE(request: Request) {
  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const mode = getModeFromRequest(request);
  if (!mode) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(await discardRecordingDraft(userId, mode));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to discard recording draft.",
      },
      { status: 500 }
    );
  }
}
