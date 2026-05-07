import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../../utils/auth";
import { normalizeGameTags } from "../../utils/game-tags";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: { gameId?: string; tags?: unknown } = {};
  try {
    payload = (await request.json()) as { gameId?: string; tags?: unknown };
  } catch {
    payload = {};
  }

  if (!payload.gameId) {
    return NextResponse.json(
      { error: "gameId is required." },
      { status: 400 }
    );
  }

  const tags = normalizeGameTags(payload.tags);

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: updatedGame, error: updateError } = await supabase
    .from("games")
    .update({ tags })
    .eq("id", payload.gameId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message || "Failed to update game tags." },
      { status: 500 }
    );
  }

  if (!updatedGame) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tags });
}
