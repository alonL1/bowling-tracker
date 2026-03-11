import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../../utils/auth";

export const runtime = "nodejs";

type SupabaseAnyClient = SupabaseClient<any, "public", any>;

function buildInviteUrl(request: Request, token: string) {
  const url = new URL(request.url);
  return `${url.origin}/friends/invite/${token}`;
}

async function getOrCreateInviteToken(
  supabase: SupabaseAnyClient,
  inviterUserId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("friend_invite_links")
    .select("token")
    .eq("inviter_user_id", inviterUserId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Failed to load invite link.");
  }
  if (existing?.token) {
    return existing.token;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(24).toString("base64url");
    const { data, error } = await supabase
      .from("friend_invite_links")
      .insert({
        inviter_user_id: inviterUserId,
        token
      })
      .select("token")
      .single();

    if (!error && data?.token) {
      return data.token;
    }

    if (error?.code === "23505") {
      const { data: resolved, error: resolvedError } = await supabase
        .from("friend_invite_links")
        .select("token")
        .eq("inviter_user_id", inviterUserId)
        .maybeSingle();
      if (resolvedError) {
        throw new Error(resolvedError.message || "Failed to load invite link.");
      }
      if (resolved?.token) {
        return resolved.token;
      }
      continue;
    }

    throw new Error(error?.message || "Failed to create invite link.");
  }

  throw new Error("Failed to generate a unique invite token.");
}

export async function POST(request: Request) {
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
      { error: "Sign in with an account to invite friends." },
      { status: 403 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  try {
    const token = await getOrCreateInviteToken(supabase, user.userId);
    return NextResponse.json({
      token,
      inviteUrl: buildInviteUrl(request, token)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create invite link."
      },
      { status: 500 }
    );
  }
}
