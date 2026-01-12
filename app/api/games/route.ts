import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10);
  const offset = Number.parseInt(searchParams.get("offset") || "0", 10);
  const safeLimit = Number.isFinite(limit) ? limit : 20;
  const safeOffset = Number.isFinite(offset) ? offset : 0;

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
    .select("id,game_name,player_name,total_score,status,played_at,created_at", {
      count: "exact"
    })
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load games." },
      { status: 500 }
    );
  }

  return NextResponse.json({ games: data || [], count: count ?? 0 });
}
