import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';
import { Alert, Platform } from 'react-native';

import { isGuestUser } from '@/lib/supabase';

export const DEFAULT_POST_AUTH_PATH = '/(tabs)/record';
const TUTORIAL_VERSION = 'v1';
const TUTORIAL_STORAGE_PREFIX = `pinpoint-getting-started-${TUTORIAL_VERSION}`;
const WARMUP_TAG_TIP_STORAGE_KEY = 'pinpoint-warmup-tag-tip-seen-v1';
const WARMUP_TAG_TIP_TITLE = 'About the warmup tag';
const WARMUP_TAG_TIP_MESSAGE =
  'Mark a game as warmup if you were just doing a throw-around or a warmup game. These games will not be included in the friends leaderboard.';

export function getSafePostAuthPath(
  raw: string | string[] | undefined,
  fallback: string = DEFAULT_POST_AUTH_PATH,
) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  if (
    trimmed.startsWith('/welcome') ||
    trimmed.startsWith('/login') ||
    trimmed.startsWith('/complete-profile') ||
    trimmed.startsWith('/choose-avatar') ||
    trimmed.startsWith('/getting-started')
  ) {
    return fallback;
  }

  return trimmed || fallback;
}

export function getTutorialIdentity(user: User | null) {
  if (!user) {
    return null;
  }

  return `${isGuestUser(user) ? 'guest' : 'user'}:${user.id}`;
}

function getTutorialStorageKey(identity: string) {
  return `${TUTORIAL_STORAGE_PREFIX}:${identity}`;
}

export async function loadTutorialSeen(identity: string | null) {
  if (!identity) {
    return false;
  }

  const value = await AsyncStorage.getItem(getTutorialStorageKey(identity));
  return value === '1';
}

export async function saveTutorialSeen(identity: string | null) {
  if (!identity) {
    return;
  }

  await AsyncStorage.setItem(getTutorialStorageKey(identity), '1');
}

export async function clearTutorialSeen(identity: string | null) {
  if (!identity) {
    return;
  }

  await AsyncStorage.removeItem(getTutorialStorageKey(identity));
}

export async function hasSeenWarmupTagTip() {
  const value = await AsyncStorage.getItem(WARMUP_TAG_TIP_STORAGE_KEY);
  return value === '1';
}

export async function markWarmupTagTipSeen() {
  await AsyncStorage.setItem(WARMUP_TAG_TIP_STORAGE_KEY, '1');
}

export async function clearWarmupTagTipSeen() {
  await AsyncStorage.removeItem(WARMUP_TAG_TIP_STORAGE_KEY);
}

export async function showWarmupTagTipIfNeeded() {
  if (await hasSeenWarmupTagTip()) {
    return;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${WARMUP_TAG_TIP_TITLE}\n\n${WARMUP_TAG_TIP_MESSAGE}`);
    await markWarmupTagTipSeen();
    return;
  }

  await new Promise<void>((resolve) => {
    Alert.alert(
      WARMUP_TAG_TIP_TITLE,
      WARMUP_TAG_TIP_MESSAGE,
      [
        {
          text: 'OK',
          onPress: () => {
            void markWarmupTagTipSeen().finally(resolve);
          },
        },
      ],
      { cancelable: false },
    );
  });
}
