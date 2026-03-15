import { NextResponse } from "next/server";

import { normalizeSelectedPlayerKeys } from "./shared";
import {
  buildLiveSessionPayload,
  getActiveLiveSessionRecord,
  getLiveUserId,
  getServerSupabase,
} from "./server";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  try {
    return NextResponse.json(await buildLiveSessionPayload(supabase, userId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load live session." },
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

  const userId = await getLiveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    selectedPlayerKeys?: unknown;
    name?: string;
    description?: string;
  };

  try {
    const active = await getActiveLiveSessionRecord(supabase, userId);
    if (!active?.session_id) {
      return NextResponse.json(
        { error: "No active live session was found." },
        { status: 404 }
      );
    }

    const selectedPlayerKeys =
      payload.selectedPlayerKeys === undefined
        ? normalizeSelectedPlayerKeys(active.selected_player_keys)
        : normalizeSelectedPlayerKeys(payload.selectedPlayerKeys);
    const name = typeof payload.name === "string" ? payload.name.trim() : undefined;
    const description =
      typeof payload.description === "string" ? payload.description.trim() : undefined;

    const { error: liveUpdateError } = await supabase
      .from("live_sessions")
      .update({
        selected_player_keys: selectedPlayerKeys,
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id)
      .eq("user_id", userId);

    if (liveUpdateError) {
      return NextResponse.json(
        { error: liveUpdateError.message || "Failed to update live session." },
        { status: 500 }
      );
    }

    if (name !== undefined || description !== undefined) {
      const { error: sessionUpdateError } = await supabase
        .from("bowling_sessions")
        .update({
          ...(name !== undefined ? { name: name || null } : null),
          ...(description !== undefined ? { description: description || null } : null),
        })
        .eq("id", active.session_id)
        .eq("user_id", userId);

      if (sessionUpdateError) {
        return NextResponse.json(
          { error: sessionUpdateError.message || "Failed to update session details." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(await buildLiveSessionPayload(supabase, userId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update live session." },
      { status: 500 }
    );
  }
}
