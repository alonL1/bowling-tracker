import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../../../../utils/auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
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
      { error: "Sign in with an account to accept friend invites." },
      { status: 403 }
    );
  }

  const token = typeof params.token === "string" ? params.token.trim() : "";
  if (!token) {
    return NextResponse.json(
      { error: "Invite token is required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: link, error: linkError } = await supabase
    .from("friend_invite_links")
    .select("inviter_user_id")
    .eq("token", token)
    .maybeSingle();

  if (linkError) {
    return NextResponse.json(
      { error: linkError.message || "Failed to load invite." },
      { status: 500 }
    );
  }
  if (!link?.inviter_user_id) {
    return NextResponse.json(
      { error: "Invite link is invalid." },
      { status: 404 }
    );
  }

  const inviterUserId = link.inviter_user_id as string;
  if (inviterUserId === user.userId) {
    return NextResponse.json(
      { error: "You cannot accept your own invite link." },
      { status: 400 }
    );
  }

  const { count: existingCount, error: existingError } = await supabase
    .from("friendships")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", user.userId)
    .eq("friend_user_id", inviterUserId);

  if (existingError) {
    return NextResponse.json(
      { error: existingError.message || "Failed to check friendship." },
      { status: 500 }
    );
  }

  const { error: upsertError } = await supabase
    .from("friendships")
    .upsert(
      [
        { user_id: user.userId, friend_user_id: inviterUserId },
        { user_id: inviterUserId, friend_user_id: user.userId }
      ],
      {
        onConflict: "user_id,friend_user_id",
        ignoreDuplicates: true
      }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: upsertError.message || "Failed to accept invite." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    alreadyFriends: (existingCount ?? 0) > 0
  });
}
