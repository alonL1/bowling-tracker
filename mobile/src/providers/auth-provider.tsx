import type { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fetchOwnProfile } from '@/lib/backend';
import { buildLegacyProfileFallback } from '@/lib/profile';
import { queryClient, QUERY_CACHE_OWNER_STORAGE_KEY } from '@/lib/query-client';
import {
  ensureMobileSession,
  isGuestUser,
  signInWithApple as signInWithAppleFlow,
  signInWithGoogleOAuth,
  signOutToGuest,
  supabase,
} from '@/lib/supabase';
import type { UserProfile } from '@/lib/types';

type SignUpWithPasswordInput = {
  firstName: string;
  lastName?: string | null;
  username: string;
  email: string;
  password: string;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  isGuest: boolean;
  profileComplete: boolean;
  avatarStepNeeded: boolean;
  refreshProfile: () => Promise<UserProfile | null>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (input: SignUpWithPasswordInput) => Promise<void>;
  signInWithApple: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  continueAsGuest: () => Promise<void>;
  signOutToGuestSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isMissingProfileRouteError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('non-JSON response (404)')
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const mountedRef = useRef(true);
  const profileRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    const resetQueryCache = async () => {
      try {
        await queryClient.cancelQueries();
      } catch (error) {
        console.error('Failed to cancel active queries during auth reset.', error);
      }

      queryClient.clear();
    };

    const syncQueryCacheOwner = async (nextUserId: string | null) => {
      try {
        const currentOwner = await AsyncStorage.getItem(QUERY_CACHE_OWNER_STORAGE_KEY);
        if (currentOwner !== nextUserId) {
          await resetQueryCache();
        }

        if (nextUserId) {
          await AsyncStorage.setItem(QUERY_CACHE_OWNER_STORAGE_KEY, nextUserId);
        } else {
          await AsyncStorage.removeItem(QUERY_CACHE_OWNER_STORAGE_KEY);
        }
      } catch (error) {
        console.error('Failed to sync query cache owner.', error);
      }
    };

    const syncProfileState = async (nextUser: User | null) => {
      const requestId = ++profileRequestIdRef.current;

      if (!nextUser || isGuestUser(nextUser)) {
        if (mountedRef.current && profileRequestIdRef.current === requestId) {
          setProfile(null);
          setProfileLoading(false);
        }
        return null;
      }

      if (mountedRef.current) {
        setProfileLoading(true);
      }

      try {
        const payload = await fetchOwnProfile();
        if (mountedRef.current && profileRequestIdRef.current === requestId) {
          setProfile(payload.profile);
        }
        return payload.profile;
      } catch (error) {
        if (isMissingProfileRouteError(error)) {
          const fallbackProfile = buildLegacyProfileFallback(nextUser);
          console.warn(
            'Account profile route is unavailable on the current backend. Using legacy fallback profile until the backend is updated.',
          );
          if (mountedRef.current && profileRequestIdRef.current === requestId) {
            setProfile(fallbackProfile);
          }
          return fallbackProfile;
        }

        console.error('Failed to load account profile.', error);
        if (mountedRef.current && profileRequestIdRef.current === requestId) {
          setProfile(null);
        }
        return null;
      } finally {
        if (mountedRef.current && profileRequestIdRef.current === requestId) {
          setProfileLoading(false);
        }
      }
    };

    const applySessionSnapshot = async (nextSession: Session | null) => {
      const nextUser = nextSession?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      await syncQueryCacheOwner(nextUserId);
      if (!mountedRef.current) {
        return;
      }
      setSession(nextSession);
      lastUserIdRef.current = nextUserId;
      await syncProfileState(nextUser);
    };

    ensureMobileSession()
      .then(async (snapshot) => {
        await applySessionSnapshot(snapshot.session ?? null);
      })
      .catch((error) => {
        console.error('Failed to initialize mobile auth session.', error);
      })
      .finally(() => {
        if (mountedRef.current) {
          setSessionReady(true);
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;
      if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== nextUserId) {
        void resetQueryCache();
      }
      void syncQueryCacheOwner(nextUserId);
      lastUserIdRef.current = nextUserId;
      setSession(nextSession);
      void syncProfileState(nextSession?.user ?? null);
      setSessionReady(true);
    });

    return () => {
      mountedRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const loading = !sessionReady || profileLoading;

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isGuest: isGuestUser(session?.user ?? null),
      profileComplete: Boolean(profile?.profileComplete),
      avatarStepNeeded: Boolean(profile?.avatarStepNeeded),
      async refreshProfile() {
        const nextUser = session?.user ?? null;
        if (!nextUser || isGuestUser(nextUser)) {
          setProfile(null);
          return null;
        }

        setProfileLoading(true);
        try {
          const payload = await fetchOwnProfile();
          setProfile(payload.profile);
          return payload.profile;
        } catch (error) {
          if (isMissingProfileRouteError(error) && nextUser) {
            const fallbackProfile = buildLegacyProfileFallback(nextUser);
            console.warn(
              'Account profile route is unavailable on the current backend. Using legacy fallback profile until the backend is updated.',
            );
            setProfile(fallbackProfile);
            return fallbackProfile;
          }

          console.error('Failed to refresh account profile.', error);
          setProfile(null);
          return null;
        } finally {
          setProfileLoading(false);
        }
      },
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          throw error;
        }
      },
      async signUpWithPassword(input) {
        const { error } = await supabase.auth.signUp({
          email: input.email.trim(),
          password: input.password,
          options: {
            data: {
              first_name: input.firstName.trim(),
              last_name: input.lastName?.trim() || null,
              username: input.username.trim().replace(/^@+/, '').toLowerCase(),
            },
          },
        });
        if (error) {
          throw error;
        }
      },
      async signInWithApple() {
        return signInWithAppleFlow();
      },
      async signInWithGoogle() {
        return signInWithGoogleOAuth();
      },
      async continueAsGuest() {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) {
          throw error;
        }
      },
      async signOutToGuestSession() {
        await queryClient.cancelQueries();
        await signOutToGuest();
      },
    }),
    [loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}
