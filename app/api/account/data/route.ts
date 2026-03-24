import { NextResponse } from "next/server";

import { purgeUserData, getAccountSupabase } from "../shared";
import { getUserFromRequest } from "../../utils/auth";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const supabase = getAccountSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const user = await getUserFromRequest(request);
  if (!user.userId || !user.accessToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (user.isGuest) {
    return NextResponse.json(
      { error: "Sign in with a real account before deleting account data." },
      { status: 403 }
    );
  }

  try {
    const counts = await purgeUserData(supabase, user.userId);
    return NextResponse.json({ ok: true, deleted: true, counts });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete account data.",
      },
      { status: 500 }
    );
  }
}
