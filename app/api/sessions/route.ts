import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

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
  return trimmed;
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId =
    normalizeOptionalUuid(await getUserIdFromRequest(request)) ?? devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("bowling_sessions")
    .select("id,name,description,started_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load sessions." },
      { status: 500 }
    );
  }

  return NextResponse.json({ sessions: data || [] });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId =
    normalizeOptionalUuid(await getUserIdFromRequest(request)) ?? devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    name?: string;
    description?: string;
  };

  const name =
    typeof payload.name === "string" ? payload.name.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("bowling_sessions")
    .insert({
      user_id: userId,
      name: name || null,
      description: description || null
    })
    .select("id,name,description,started_at,created_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to create session." },
      { status: 500 }
    );
  }

  return NextResponse.json({ session: data });
}
