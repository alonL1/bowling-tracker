import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = process.env.DEV_USER_ID;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  let query = supabase
    .from("games")
    .select("id,game_name,player_name,total_score,status,played_at,created_at")
    .order("created_at", { ascending: false })
    .limit(Number.isFinite(limit) ? limit : 20);

  if (devUserId) {
    query = query.eq("user_id", devUserId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load games." },
      { status: 500 }
    );
  }

  return NextResponse.json({ games: data || [] });
}
