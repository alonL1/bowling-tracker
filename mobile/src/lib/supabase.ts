import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Expo Supabase environment. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env.local.',
  );
}

const storage = {
  getItem(key: string) {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') {
        return Promise.resolve(null);
      }
      return Promise.resolve(window.localStorage.getItem(key));
    }
    return AsyncStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
      return Promise.resolve();
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
      return Promise.resolve();
    }
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

function getProviderNames(user: User | null) {
  if (!user) {
    return [];
  }

  const appMetadata = user.app_metadata as
    | { provider?: string; providers?: string[] }
    | undefined;
  const providers = Array.isArray(appMetadata?.providers) ? [...appMetadata.providers] : [];

  if (appMetadata?.provider && !providers.includes(appMetadata.provider)) {
    providers.push(appMetadata.provider);
  }

  return providers;
}

export function isGuestUser(user: User | null) {
  if (!user) {
    return false;
  }

  const anonymousFlag = (user as User & { is_anonymous?: boolean }).is_anonymous;
  if (anonymousFlag) {
    return true;
  }

  return getProviderNames(user).includes('anonymous');
}

export type SessionSnapshot = {
  user: User | null;
  session: Session | null;
  accessToken: string | null;
};

export async function ensureMobileSession(): Promise<SessionSnapshot> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (!userError && userData.user) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) {
      return {
        user: userData.user,
        session: sessionData.session,
        accessToken: sessionData.session.access_token,
      };
    }
  }

  const { data: anonymousData, error: anonymousError } = await supabase.auth.signInAnonymously();
  if (anonymousError || !anonymousData.session?.access_token) {
    throw anonymousError || new Error('Failed to start guest session.');
  }

  return {
    user: anonymousData.session.user,
    session: anonymousData.session,
    accessToken: anonymousData.session.access_token,
  };
}

export async function getSessionSnapshot() {
  return ensureMobileSession();
}

export async function signOutToGuest() {
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
  if (signOutError && signOutError.status !== 403) {
    throw signOutError;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw error || new Error('Failed to start guest session.');
  }

  return data.user;
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
    return;
  }
  supabase.auth.stopAutoRefresh();
});
