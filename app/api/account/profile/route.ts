import { NextResponse } from "next/server";

import { getAccountSupabase } from "../shared";
import { getUserFromRequest } from "../../utils/auth";
import {
  PROFILE_SELECT,
  ensureProfileForAuthUser,
  toUserProfilePayload,
  validateUsernameInput
} from "../../utils/profiles";

export const runtime = "nodejs";

function trimNullable(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: Request) {
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
    const profile = await ensureProfileForAuthUser(supabase, viewer.authUser);
    return NextResponse.json({
      profile: toUserProfilePayload(supabase, profile, viewer.authUser)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load account profile."
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
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

  let payload:
    | {
        username?: string;
        firstName?: string | null;
        lastName?: string | null;
        completeAvatarOnboarding?: boolean;
      }
    | undefined;

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const firstName = trimNullable(payload?.firstName);
  const lastName = trimNullable(payload?.lastName);

  if (!firstName) {
    return NextResponse.json(
      { error: "First name is required." },
      { status: 400 }
    );
  }

  let username: string;
  try {
    username = validateUsernameInput(payload?.username || "");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Username is not valid."
      },
      { status: 400 }
    );
  }

  try {
    await ensureProfileForAuthUser(supabase, viewer.authUser);

    const { data: duplicate, error: duplicateError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("username_normalized", username)
      .neq("user_id", viewer.userId)
      .maybeSingle();

    if (duplicateError) {
      throw new Error(duplicateError.message || "Failed to validate username.");
    }

    if (duplicate?.user_id) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({
        username,
        username_normalized: username,
        first_name: firstName,
        last_name: lastName,
        ...(payload?.completeAvatarOnboarding
          ? {
              avatar_onboarding_completed_at:
                new Date().toISOString()
            }
          : {})
      })
      .eq("user_id", viewer.userId)
      .select(PROFILE_SELECT)
      .single();

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          { error: "That username is already taken." },
          { status: 409 }
        );
      }

      throw new Error(updateError.message || "Failed to save profile.");
    }

    return NextResponse.json({
      profile: toUserProfilePayload(
        supabase,
        updated,
        viewer.authUser
      )
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save profile."
      },
      { status: 500 }
    );
  }
}
