import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (Platform.OS === 'web') {
  import('expo-web-browser')
    .then((WebBrowser) => WebBrowser.maybeCompleteAuthSession())
    .catch(() => {
      // Ignore web auth session bootstrapping failures outside browser environments.
    });
}

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

type AppleFullName = {
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
} | null;

async function getOAuthRedirectUri() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/login`;
  }

  return Linking.createURL('login');
}

async function signInWithBrowserOAuth(provider: 'apple' | 'google') {
  const WebBrowser = await import('expo-web-browser');
  const redirectTo = await getOAuthRedirectUri();
  const providerLabel = provider === 'apple' ? 'Apple' : 'Google';
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.url) {
    throw new Error(`${providerLabel} sign-in did not return an auth URL.`);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    return false;
  }

  await createSessionFromUrl(result.url);
  return true;
}

export async function createSessionFromUrl(url: string) {
  const parsedUrl = new URL(url);
  const queryParams = parsedUrl.searchParams;
  const hashParams = new URLSearchParams(
    parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash,
  );
  const getParam = (key: string) => queryParams.get(key) ?? hashParams.get(key);

  const errorCode = getParam('error_code') ?? getParam('error');
  const errorDescription = getParam('error_description');

  if (errorCode) {
    throw new Error(errorDescription || errorCode);
  }

  const accessToken = getParam('access_token');
  const refreshToken = getParam('refresh_token');
  const code = getParam('code');

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    return data.session;
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw error;
    }

    return data.session;
  }

  return null;
}

export async function signInWithGoogleOAuth() {
  return signInWithBrowserOAuth('google');
}

function getAppleProfileUpdates(fullName: AppleFullName) {
  if (!fullName) {
    return null;
  }

  const givenName = fullName.givenName?.trim() ?? '';
  const middleName = fullName.middleName?.trim() ?? '';
  const familyName = fullName.familyName?.trim() ?? '';
  const fullNameValue = [givenName, middleName, familyName].filter(Boolean).join(' ').trim();

  const updates: Record<string, string> = {};

  if (fullNameValue) {
    updates.full_name = fullNameValue;
  }
  if (givenName) {
    updates.given_name = givenName;
  }
  if (familyName) {
    updates.family_name = familyName;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

async function syncAppleProfile(fullName: AppleFullName) {
  const updates = getAppleProfileUpdates(fullName);
  if (!updates) {
    return;
  }

  const { error } = await supabase.auth.updateUser({
    data: updates,
  });

  if (error) {
    console.error('Failed to persist Apple profile details.', error);
  }
}

async function signInWithNativeAppleId() {
  if (Platform.OS !== 'ios') {
    throw new Error('Native Apple sign-in is only available on iPhone and iPad.');
  }

  const AppleAuthentication = await import('expo-apple-authentication');
  const appleSignInAvailable = await AppleAuthentication.isAvailableAsync();
  if (!appleSignInAvailable) {
    throw new Error('Apple sign-in is not available on this device.');
  }

  const Crypto = await import('expo-crypto');

  try {
    const nonce = Crypto.randomUUID();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });

    if (!credential.identityToken) {
      throw new Error('Apple sign-in did not return an identity token.');
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce,
    });

    if (error) {
      throw error;
    }

    await syncAppleProfile(credential.fullName);
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined;

    if (code === 'ERR_REQUEST_CANCELED') {
      return false;
    }

    throw error;
  }
}

export async function signInWithApple() {
  if (Platform.OS === 'ios') {
    return signInWithNativeAppleId();
  }

  if (Platform.OS === 'web') {
    return signInWithBrowserOAuth('apple');
  }

  throw new Error('Apple sign-in is only available on iPhone, iPad, and web.');
}

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
