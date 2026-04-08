import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../../../utils/auth";
import { buildPublicProfilesByUserId } from "../../../utils/profiles";

export const runtime = "nodejs";

export async function GET(
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

  const token = typeof params.token === "string" ? params.token.trim() : "";
  if (!token) {
    return NextResponse.json(
      { valid: false, error: "Invite token is required." },
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
      { valid: false, error: linkError.message || "Failed to load invite." },
      { status: 500 }
    );
  }

  if (!link?.inviter_user_id) {
    return NextResponse.json(
      { valid: false, error: "Invite link is invalid." },
      { status: 404 }
    );
  }

  const inviterUserId = link.inviter_user_id as string;
  let inviter = null;
  try {
    const publicProfiles = await buildPublicProfilesByUserId(supabase, [inviterUserId]);
    inviter = publicProfiles.get(inviterUserId) || null;
  } catch (error) {
    return NextResponse.json(
      {
        valid: false,
        error:
          error instanceof Error ? error.message : "Failed to load inviter profile."
      },
      { status: 500 }
    );
  }

  const viewer = await getUserFromRequest(request);
  const authRequired = !viewer.userId || viewer.isGuest;
  const selfInvite = Boolean(viewer.userId && viewer.userId === inviterUserId);

  let alreadyFriends = false;
  if (!authRequired && viewer.userId && !selfInvite) {
    const { count, error: friendshipError } = await supabase
      .from("friendships")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", viewer.userId)
      .eq("friend_user_id", inviterUserId);
    if (friendshipError) {
      return NextResponse.json(
        {
          valid: false,
          error: friendshipError.message || "Failed to check friendship."
        },
        { status: 500 }
      );
    }
    alreadyFriends = (count ?? 0) > 0;
  }

  return NextResponse.json({
    valid: true,
    inviter: {
      userId: inviterUserId,
      displayName: inviter?.displayName || inviter?.username || "bowler",
      username: inviter?.username || "bowler",
      avatarKind: inviter?.avatarKind || "initials",
      avatarPresetId: inviter?.avatarPresetId || null,
      avatarUrl: inviter?.avatarUrl || null,
      initials: inviter?.initials || "P"
    },
    authRequired,
    selfInvite,
    alreadyFriends,
    canAccept: !authRequired && !selfInvite && !alreadyFriends
  });
}
