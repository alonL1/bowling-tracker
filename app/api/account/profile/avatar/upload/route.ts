import { NextResponse } from "next/server";

import { getAccountSupabase } from "../../../shared";
import { getUserFromRequest } from "../../../../utils/auth";
import {
  PROFILE_AVATAR_BUCKET,
  PROFILE_SELECT,
  ensureProfileForAuthUser,
  toUserProfilePayload
} from "../../../../utils/profiles";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

function getExtension(fileName: string | null | undefined, mimeType: string | null | undefined) {
  const safeMimeType = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  if (safeMimeType === "image/png") {
    return "png";
  }
  if (safeMimeType === "image/webp") {
    return "webp";
  }
  if (safeMimeType === "image/heic") {
    return "heic";
  }
  if (safeMimeType === "image/heif") {
    return "heif";
  }
  if (safeMimeType === "image/jpeg" || safeMimeType === "image/jpg") {
    return "jpg";
  }

  const match = typeof fileName === "string" ? fileName.match(/\.([a-z0-9]+)$/i) : null;
  const extension = match?.[1]?.toLowerCase();
  if (
    extension === "png" ||
    extension === "webp" ||
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "heic" ||
    extension === "heif"
  ) {
    return extension === "jpeg" ? "jpg" : extension;
  }

  return "jpg";
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return value !== null && typeof value !== "string";
}

export async function POST(request: Request) {
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Avatar upload must use multipart form data." },
      { status: 400 }
    );
  }

  const avatar = formData.get("avatar");
  if (!isFileLike(avatar)) {
    return NextResponse.json(
      { error: "Avatar image is required." },
      { status: 400 }
    );
  }

  const fileSize = typeof avatar.size === "number" ? avatar.size : 0;
  if (!fileSize || fileSize > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "Profile pictures must be 8 MB or smaller." },
      { status: 400 }
    );
  }

  const mimeType = avatar.type || "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are supported." },
      { status: 400 }
    );
  }

  try {
    const current = await ensureProfileForAuthUser(supabase, viewer.authUser);
    const extension = getExtension(avatar.name, mimeType);
    const storageKey = `${viewer.userId}/avatar.${extension}`;
    const buffer = Buffer.from(await avatar.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(storageKey, buffer, {
        upsert: true,
        contentType: mimeType
      });

    if (uploadError) {
      throw new Error(uploadError.message || "Failed to upload avatar.");
    }

    if (current.avatar_storage_key && current.avatar_storage_key !== storageKey) {
      await supabase.storage
        .from(PROFILE_AVATAR_BUCKET)
        .remove([current.avatar_storage_key]);
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({
        avatar_kind: "uploaded",
        avatar_preset_id: null,
        avatar_storage_key: storageKey,
        avatar_updated_at: now,
        avatar_onboarding_completed_at: current.avatar_onboarding_completed_at || now
      })
      .eq("user_id", viewer.userId)
      .select(PROFILE_SELECT)
      .single();

    if (updateError) {
      throw new Error(updateError.message || "Failed to save avatar.");
    }

    return NextResponse.json({
      profile: toUserProfilePayload(supabase, updated, viewer.authUser)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to upload avatar."
      },
      { status: 500 }
    );
  }
}
