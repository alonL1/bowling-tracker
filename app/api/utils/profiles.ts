import type { SupabaseClient, User } from "@supabase/supabase-js";

export const PROFILE_AVATAR_BUCKET =
  process.env.SUPABASE_PROFILE_AVATAR_BUCKET || "profile-avatars";

export const AVATAR_PRESET_IDS = [
  "happy_pin",
  "thinking_pin",
  "idea_pin",
  "ball_blue",
  "ball_red",
  "ball_orange",
  "ball_purple",
  "ball_coconut",
  "sink",
  "leaf",
  "peanut_butter_jar",
  "beach_chair"
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];
export type AvatarKind = "initials" | "preset" | "uploaded";

export type ProfileRow = {
  user_id: string;
  username: string | null;
  username_normalized: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_kind: AvatarKind;
  avatar_preset_id: AvatarPresetId | null;
  avatar_storage_key: string | null;
  avatar_updated_at: string | null;
  avatar_onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicProfilePayload = {
  userId: string;
  username: string;
  displayName: string;
  avatarKind: AvatarKind;
  avatarPresetId: AvatarPresetId | null;
  avatarUrl: string | null;
  initials: string;
};

export type UserProfilePayload = {
  userId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarKind: AvatarKind;
  avatarPresetId: AvatarPresetId | null;
  avatarUrl: string | null;
  initials: string;
  profileComplete: boolean;
  avatarStepNeeded: boolean;
  usernameSuggestion: string | null;
};

export const PROFILE_SELECT =
  "user_id,username,username_normalized,first_name,last_name,avatar_kind,avatar_preset_id,avatar_storage_key,avatar_updated_at,avatar_onboarding_completed_at,created_at,updated_at";

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

type AuthUserLike = Pick<User, "id" | "email"> & {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  raw_user_meta_data?: Record<string, unknown> | null;
};

function trimNullable(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getMetadata(user: AuthUserLike | null | undefined) {
  const withRaw = user as AuthUserLike | undefined;
  return (
    withRaw?.user_metadata ||
    withRaw?.raw_user_meta_data ||
    null
  );
}

function getMetadataString(
  metadata: Record<string, unknown> | null,
  keys: string[]
) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function sanitizeUsernameSuggestion(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return null;
  }

  if (normalized.length >= 3) {
    return normalized.slice(0, 20);
  }

  return null;
}

export function normalizeUsernameInput(input: string) {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function validateUsernameInput(input: string) {
  const normalized = normalizeUsernameInput(input);
  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error(
      "Username must be 3-20 characters and use only lowercase letters, numbers, and underscores."
    );
  }
  return normalized;
}

function getMetadataUsername(metadata: Record<string, unknown> | null) {
  const raw = getMetadataString(metadata, ["username", "preferred_username", "nick_name"]);
  if (!raw) {
    return null;
  }

  try {
    return validateUsernameInput(raw);
  } catch {
    return null;
  }
}

export function buildUsernameSuggestion(user: AuthUserLike) {
  const metadata = getMetadata(user);
  const candidates = [
    getMetadataUsername(metadata),
    sanitizeUsernameSuggestion(getMetadataString(metadata, ["username", "preferred_username", "nick_name"])),
    sanitizeUsernameSuggestion(getMetadataString(metadata, ["given_name"])),
    sanitizeUsernameSuggestion(getMetadataString(metadata, ["name", "full_name"])),
    sanitizeUsernameSuggestion(trimNullable(user.email?.split("@")[0] ?? null)),
    user.id ? `bowler_${user.id.slice(0, 8).toLowerCase()}` : null
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate.length >= 3) {
      return candidate.slice(0, 20);
    }
  }

  return "bowler";
}

function getSeedFields(user: AuthUserLike) {
  const metadata = getMetadata(user);
  return {
    firstName:
      trimNullable(getMetadataString(metadata, ["first_name", "given_name"])) || null,
    lastName:
      trimNullable(getMetadataString(metadata, ["last_name", "family_name"])) || null,
    username: getMetadataUsername(metadata)
  };
}

export function buildInitials(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
  userId?: string | null;
}) {
  const first = trimNullable(input.firstName);
  const last = trimNullable(input.lastName);
  const username = trimNullable(input.username);
  const emailPrefix = trimNullable(input.email?.split("@")[0] ?? null);

  if (first) {
    const firstInitial = first.charAt(0).toUpperCase();
    const secondInitial = last
      ? last.charAt(0).toUpperCase()
      : username
        ? username.charAt(0).toUpperCase()
        : "";
    return `${firstInitial}${secondInitial}`.trim() || firstInitial;
  }

  if (username) {
    return username.charAt(0).toUpperCase();
  }

  if (emailPrefix) {
    return emailPrefix.charAt(0).toUpperCase();
  }

  if (input.userId) {
    return input.userId.charAt(0).toUpperCase();
  }

  return "P";
}

export function buildLegacyDisplayName(input: {
  username?: string | null;
  email?: string | null;
  userId?: string | null;
}) {
  const username = trimNullable(input.username);
  if (username) {
    return username;
  }

  const emailPrefix = trimNullable(input.email?.split("@")[0] ?? null);
  if (emailPrefix) {
    return emailPrefix;
  }

  if (input.userId) {
    return `bowler_${input.userId.slice(0, 8).toLowerCase()}`;
  }

  return "bowler";
}

export function isProfileComplete(profile: Pick<ProfileRow, "username" | "first_name"> | null) {
  if (!profile) {
    return false;
  }
  return Boolean(trimNullable(profile.username) && trimNullable(profile.first_name));
}

export function avatarStepNeeded(profile: Pick<ProfileRow, "avatar_onboarding_completed_at" | "username" | "first_name"> | null) {
  if (!profile || !isProfileComplete(profile)) {
    return false;
  }
  return !profile.avatar_onboarding_completed_at;
}

export function buildAvatarUrl(
  supabase: SupabaseClient,
  storageKey: string | null,
  updatedAt: string | null
) {
  if (!storageKey) {
    return null;
  }

  const { data } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(storageKey);
  const publicUrl = data.publicUrl || null;
  if (!publicUrl) {
    return null;
  }

  if (!updatedAt) {
    return publicUrl;
  }

  const version = Date.parse(updatedAt);
  if (!Number.isFinite(version)) {
    return publicUrl;
  }

  return `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${version}`;
}

export async function ensureProfileForAuthUser(
  supabase: SupabaseClient,
  authUser: AuthUserLike
) {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", authUser.id)
    .maybeSingle<ProfileRow>();

  if (existingError) {
    throw new Error(existingError.message || "Failed to load profile.");
  }

  const seed = getSeedFields(authUser);

  if (!existing) {
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .upsert({
        user_id: authUser.id,
        username: seed.username,
        username_normalized: seed.username,
        first_name: seed.firstName,
        last_name: seed.lastName,
        avatar_kind: "initials"
      }, {
        onConflict: "user_id"
      })
      .select(PROFILE_SELECT)
      .single<ProfileRow>();

    if (insertError) {
      throw new Error(insertError.message || "Failed to create profile.");
    }

    return inserted;
  }

  const patch: Partial<ProfileRow> = {};

  if (!trimNullable(existing.first_name) && seed.firstName) {
    patch.first_name = seed.firstName;
  }

  if (!trimNullable(existing.last_name) && seed.lastName) {
    patch.last_name = seed.lastName;
  }

  if (!trimNullable(existing.username) && seed.username) {
    patch.username = seed.username;
    patch.username_normalized = seed.username;
  }

  if (Object.keys(patch).length === 0) {
    return existing;
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", authUser.id)
    .select(PROFILE_SELECT)
    .single<ProfileRow>();

  if (updateError) {
    throw new Error(updateError.message || "Failed to update profile.");
  }

  return updated;
}

export function toUserProfilePayload(
  supabase: SupabaseClient,
  profile: ProfileRow,
  authUser: AuthUserLike
): UserProfilePayload {
  return {
    userId: profile.user_id,
    username: trimNullable(profile.username),
    firstName: trimNullable(profile.first_name),
    lastName: trimNullable(profile.last_name),
    avatarKind: profile.avatar_kind || "initials",
    avatarPresetId: profile.avatar_preset_id || null,
    avatarUrl: buildAvatarUrl(
      supabase,
      profile.avatar_storage_key,
      profile.avatar_updated_at
    ),
    initials: buildInitials({
      firstName: profile.first_name,
      lastName: profile.last_name,
      username: profile.username,
      email: authUser.email,
      userId: profile.user_id
    }),
    profileComplete: isProfileComplete(profile),
    avatarStepNeeded: avatarStepNeeded(profile),
    usernameSuggestion:
      trimNullable(profile.username) || buildUsernameSuggestion(authUser)
  };
}

export async function buildPublicProfilesByUserId(
  supabase: SupabaseClient,
  userIds: string[]
) {
  const uniqueUserIds = Array.from(
    new Set(userIds.filter((value) => typeof value === "string" && value.length > 0))
  );

  if (uniqueUserIds.length === 0) {
    return new Map<string, PublicProfilePayload>();
  }

  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .in("user_id", uniqueUserIds);

  if (profilesError) {
    throw new Error(profilesError.message || "Failed to load public profiles.");
  }

  const byUserId = new Map<string, ProfileRow>();
  (profileRows || []).forEach((row) => {
    byUserId.set(row.user_id, row as ProfileRow);
  });

  const results = new Map<string, PublicProfilePayload>();

  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const profile = byUserId.get(userId) || null;
      const needsFallback = !trimNullable(profile?.username ?? null);

      let fallbackEmail: string | null = null;
      if (needsFallback) {
        const { data: authUserData } = await supabase.auth.admin.getUserById(userId);
        fallbackEmail = authUserData.user?.email ?? null;
      }

      const username =
        trimNullable(profile?.username ?? null) ||
        buildUsernameSuggestion({
          id: userId,
          email: fallbackEmail ?? undefined,
          user_metadata: null
        });
      const displayName = buildLegacyDisplayName({
        username: trimNullable(profile?.username ?? null),
        email: fallbackEmail,
        userId
      });

      results.set(userId, {
        userId,
        username,
        displayName,
        avatarKind: profile?.avatar_kind || "initials",
        avatarPresetId: profile?.avatar_preset_id || null,
        avatarUrl: buildAvatarUrl(
          supabase,
          profile?.avatar_storage_key || null,
          profile?.avatar_updated_at || null
        ),
        initials: buildInitials({
          firstName: profile?.first_name || null,
          lastName: profile?.last_name || null,
          username,
          email: fallbackEmail,
          userId
        })
      });
    })
  );

  return results;
}
