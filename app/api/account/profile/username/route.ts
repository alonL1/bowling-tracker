import { NextResponse } from "next/server";

import { getAccountSupabase } from "../../shared";
import { validateUsernameInput } from "../../../utils/profiles";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = getAccountSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const rawUsername = url.searchParams.get("username") || "";

  let username: string;
  try {
    username = validateUsernameInput(rawUsername);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Username is not valid."
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("username_normalized", username)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to check username." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    available: !data?.user_id,
    username
  });
}
