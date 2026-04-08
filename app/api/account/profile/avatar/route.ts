import { NextResponse } from "next/server";

import { getAccountSupabase } from "../../shared";
import { getUserFromRequest } from "../../../utils/auth";
import {
  PROFILE_SELECT,
  PROFILE_AVATAR_BUCKET,
  ensureProfileForAuthUser,
  toUserProfilePayload
} from "../../../utils/profiles";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const viewer = await getUserFromRequest(request);
  if (!viewer.userId || !viewer.authUser) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (viewer.isGuest) {
    return NextResponse.json(
      { error: "Guests do not have an account profile." },
      { status: 403 }
    );
  }

  const supabase = getAccountSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  try {
    const current = await ensureProfileForAuthUser(supabase, viewer.authUser);

    if (current.avatar_storage_key) {
      await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([current.avatar_storage_key]);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({
        avatar_kind: "initials",
        avatar_preset_id: null,
        avatar_storage_key: null,
        avatar_updated_at: now,
        avatar_onboarding_completed_at: current.avatar_onboarding_completed_at || now
      })
      .eq("user_id", viewer.userId)
      .select(PROFILE_SELECT)
      .single();

    if (updateError) {
      throw new Error(updateError.message || "Failed to remove avatar.");
    }

    return NextResponse.json({
      profile: toUserProfilePayload(supabase, updated, viewer.authUser)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to remove avatar."
      },
      { status: 500 }
    );
  }
}
