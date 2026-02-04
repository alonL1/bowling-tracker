import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : null;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : null;
  const safeLimit = limit !== null && Number.isFinite(limit) ? limit : null;
  const safeOffset = offset !== null && Number.isFinite(offset) ? offset : 0;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = process.env.DEV_USER_ID;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId =
    (await getUserIdFromRequest(request)) || (devUserId ?? null);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  let query = supabase
    .from("games")
    .select(
      "id,game_name,player_name,total_score,status,played_at,created_at,session_id,session:bowling_sessions(id,name,description,started_at,created_at)",
      {
        count: "exact"
      }
    )
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (safeLimit !== null) {
    query = query.range(safeOffset, safeOffset + safeLimit - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load games." },
      { status: 500 }
    );
  }

  return NextResponse.json({ games: data || [], count: count ?? 0 });
}
