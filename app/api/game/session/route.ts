import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../../utils/auth";

export const runtime = "nodejs";

function normalizeOptionalUuid(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") {
    return null;
  }
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function PATCH(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = (await getUserIdFromRequest(request)) || devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: { gameId?: string; sessionId?: string | null } = {};
  try {
    payload = (await request.json()) as { gameId?: string; sessionId?: string | null };
  } catch {
    payload = {};
  }

  if (!payload.gameId) {
    return NextResponse.json(
      { error: "gameId is required." },
      { status: 400 }
    );
  }

  const targetSessionId = normalizeOptionalUuid(
    typeof payload.sessionId === "string" ? payload.sessionId : null
  );

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id,session_id")
    .eq("id", payload.gameId)
    .eq("user_id", userId)
    .maybeSingle();

  if (gameError || !game) {
    return NextResponse.json(
      { error: gameError?.message || "Game not found." },
      { status: 404 }
    );
  }

  if (targetSessionId) {
    const { data: session, error: sessionError } = await supabase
      .from("bowling_sessions")
      .select("id")
      .eq("id", targetSessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (sessionError) {
      return NextResponse.json(
        { error: sessionError.message || "Failed to validate session." },
        { status: 500 }
      );
    }
    if (!session) {
      return NextResponse.json(
        { error: "Selected session was not found." },
        { status: 400 }
      );
    }
  }

  const previousSessionId = normalizeOptionalUuid(
    typeof game.session_id === "string" ? game.session_id : null
  );

  if (previousSessionId === targetSessionId) {
    return NextResponse.json({ ok: true });
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({ session_id: targetSessionId ?? null })
    .eq("id", payload.gameId)
    .eq("user_id", userId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message || "Failed to move game." },
      { status: 500 }
    );
  }

  const refreshSession = async (sessionId: string | null) => {
    if (!sessionId) {
      return;
    }
    const { data: earliestGame } = await supabase
      .from("games")
      .select("played_at")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .order("played_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    await supabase
      .from("bowling_sessions")
      .update({ started_at: earliestGame?.played_at ?? null })
      .eq("id", sessionId)
      .eq("user_id", userId);
  };

  await refreshSession(previousSessionId);
  await refreshSession(targetSessionId);

  return NextResponse.json({ ok: true });
}
