import type { ImageSourcePropType } from 'react-native';
import type { User } from '@supabase/supabase-js';

import type { AvatarPresetId, UserProfile } from '@/lib/types';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export type AvatarPresetOption = {
  id: AvatarPresetId;
  label: string;
  kind: 'pin' | 'ball' | 'coconut' | 'sink' | 'leaf' | 'jar' | 'chair';
  source?: ImageSourcePropType;
  color?: string;
};

export const AVATAR_PRESET_OPTIONS: AvatarPresetOption[] = [
  {
    id: 'happy_pin',
    label: 'Happy Pin',
    kind: 'pin',
    source: require('../../assets/pins/happy_pin.png'),
  },
  {
    id: 'thinking_pin',
    label: 'Thinking Pin',
    kind: 'pin',
    source: require('../../assets/pins/thinking_pin.png'),
  },
  {
    id: 'idea_pin',
    label: 'Idea Pin',
    kind: 'pin',
    source: require('../../assets/pins/idea_pin.png'),
  },
  {
    id: 'ball_blue',
    label: 'Blue Ball',
    kind: 'ball',
    color: '#4C79CB',
  },
  {
    id: 'ball_red',
    label: 'Red Ball',
    kind: 'ball',
    color: '#D55A5A',
  },
  {
    id: 'ball_orange',
    label: 'Orange Ball',
    kind: 'ball',
    color: '#D98843',
  },
  {
    id: 'ball_purple',
    label: 'Purple Ball',
    kind: 'ball',
    color: '#7C63D7',
  },
  {
    id: 'ball_coconut',
    label: 'Coconut',
    kind: 'coconut',
    color: '#6B4226',
  },
  {
    id: 'sink',
    label: 'Sink',
    kind: 'sink',
  },
  {
    id: 'leaf',
    label: 'Leaf',
    kind: 'leaf',
  },
  {
    id: 'peanut_butter_jar',
    label: 'PB Jar',
    kind: 'jar',
  },
  {
    id: 'beach_chair',
    label: 'Beach Chair',
    kind: 'chair',
  },
];

export const AVATAR_PRESET_MAP = Object.fromEntries(
  AVATAR_PRESET_OPTIONS.map((option) => [option.id, option]),
) as Record<AvatarPresetId, AvatarPresetOption>;

export function normalizeUsernameInput(value: string) {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function isValidUsernameInput(value: string) {
  return USERNAME_PATTERN.test(normalizeUsernameInput(value));
}

function trimNullable(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getMetadata(user: {
  user_metadata?: Record<string, unknown> | null;
  raw_user_meta_data?: Record<string, unknown> | null;
}) {
  return user.user_metadata || user.raw_user_meta_data || null;
}

function getMetadataString(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function sanitizeUsernameSuggestion(value: string | null | undefined) {
  const trimmed = trimNullable(value);
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return null;
  }

  if (normalized.length >= 3) {
    return normalized.slice(0, 20);
  }

  return null;
}

export function getProfileInitials(input: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  initials?: string | null;
}) {
  const providedInitials = trimNullable(input.initials);
  if (providedInitials) {
    return providedInitials.slice(0, 2).toUpperCase();
  }

  const firstName = trimNullable(input.firstName);
  const lastName = trimNullable(input.lastName);
  const username = trimNullable(input.username);

  if (firstName) {
    const first = firstName.charAt(0).toUpperCase();
    const second = lastName
      ? lastName.charAt(0).toUpperCase()
      : username
        ? username.charAt(0).toUpperCase()
        : '';
    return `${first}${second}`.trim() || first;
  }

  if (username) {
    return username.charAt(0).toUpperCase();
  }

  return 'P';
}

export function formatHandle(username: string | null | undefined) {
  const normalized = trimNullable(username);
  return normalized || 'bowler';
}

export function buildLegacyUsernameFallback(input: {
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
}) {
  const directUsername = sanitizeUsernameSuggestion(input.username);
  if (directUsername) {
    return directUsername;
  }

  const fromDisplayName = sanitizeUsernameSuggestion(input.displayName);
  if (fromDisplayName) {
    return fromDisplayName;
  }

  const fromEmail = sanitizeUsernameSuggestion(input.email?.split('@')[0] ?? null);
  if (fromEmail) {
    return fromEmail;
  }

  if (input.userId) {
    return `bowler_${input.userId.slice(0, 8).toLowerCase()}`;
  }

  return 'bowler';
}

export function buildLegacyProfileFallback(user: Pick<User, 'id' | 'email'> & {
  user_metadata?: Record<string, unknown> | null;
  raw_user_meta_data?: Record<string, unknown> | null;
}): UserProfile {
  const metadata = getMetadata(user);
  const firstName =
    trimNullable(getMetadataString(metadata, ['first_name', 'given_name'])) ||
    trimNullable(getMetadataString(metadata, ['name', 'full_name'])?.split(/\s+/)[0] ?? null) ||
    trimNullable(user.email?.split('@')[0] ?? null) ||
    'Bowler';
  const lastName =
    trimNullable(getMetadataString(metadata, ['last_name', 'family_name'])) || null;
  const username =
    sanitizeUsernameSuggestion(getMetadataString(metadata, ['username', 'preferred_username', 'nick_name'])) ||
    buildLegacyUsernameFallback({
      displayName: firstName,
      email: user.email,
      userId: user.id,
    });

  return {
    userId: user.id,
    username,
    firstName,
    lastName,
    avatarKind: 'initials',
    avatarPresetId: null,
    avatarUrl: null,
    initials: getProfileInitials({
      firstName,
      lastName,
      username,
    }),
    profileComplete: true,
    avatarStepNeeded: false,
    usernameSuggestion: username,
  };
}
