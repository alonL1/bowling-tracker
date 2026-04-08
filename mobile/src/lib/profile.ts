import type { ImageSourcePropType } from 'react-native';

import type { AvatarPresetId } from '@/lib/types';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export type AvatarPresetOption = {
  id: AvatarPresetId;
  label: string;
  kind: 'pin' | 'ball';
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
  return normalized ? `@${normalized}` : '@bowler';
}
