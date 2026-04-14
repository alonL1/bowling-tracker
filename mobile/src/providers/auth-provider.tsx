import type { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { fetchOwnProfile } from '@/lib/backend';
import {
  clearTutorialSeen,
  getTutorialIdentity,
  loadTutorialSeen,
  saveTutorialSeen,
} from '@/lib/onboarding';
import { buildLegacyProfileFallback } from '@/lib/profile';
import { queryClient, QUERY_CACHE_OWNER_STORAGE_KEY } from '@/lib/query-client';
import {
  getExistingSessionSnapshot,
  isGuestUser,
  signInWithApple as signInWithAppleFlow,
  signInWithGoogleOAuth,
  signOutCurrentSession,
  startGuestSession,
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
  tutorialSeen: boolean;
  refreshProfile: () => Promise<UserProfile | null>;
  markTutorialSeen: () => Promise<void>;
  resetTutorialSeen: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (input: SignUpWithPasswordInput) => Promise<void>;
  signInWithApple: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  continueAsGuest: () => Promise<void>;
  signOutToGuestSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getAuthIdentityKey(user: User | null) {
  if (!user) {
    return 'signed_out';
  }

  return `${isGuestUser(user) ? 'guest' : 'user'}:${user.id}`;
}

function isMissingProfileRouteError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes('non-JSON response (404)')
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tutorialSeen, setTutorialSeen] = useState(false);
  const [resolvedIdentityKey, setResolvedIdentityKey] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const pendingIdentityKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const derivedStateRequestIdRef = useRef(0);

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

    const syncProfileState = async (
      nextUser: User | null,
      requestId: number,
      accessToken?: string | null,
    ) => {
      if (!nextUser || isGuestUser(nextUser)) {
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setProfile(null);
        }
        return null;
      }

      try {
        const payload = await fetchOwnProfile(accessToken);
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setProfile(payload.profile);
        }
        return payload.profile;
      } catch (error) {
        if (isMissingProfileRouteError(error)) {
          const fallbackProfile = buildLegacyProfileFallback(nextUser);
          console.warn(
            'Account profile route is unavailable on the current backend. Using legacy fallback profile until the backend is updated.',
          );
          if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
            setProfile(fallbackProfile);
          }
          return fallbackProfile;
        }

        console.error('Failed to load account profile.', error);
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setProfile(null);
        }
        return null;
      }
    };

    const syncTutorialState = async (nextUser: User | null, requestId: number) => {
      const identity = getTutorialIdentity(nextUser);

      if (!identity) {
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setTutorialSeen(false);
        }
        return false;
      }

      try {
        const seen = await loadTutorialSeen(identity);
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setTutorialSeen(seen);
        }
        return seen;
      } catch (error) {
        console.error('Failed to load tutorial state.', error);
        if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
          setTutorialSeen(false);
        }
        return false;
      }
    };

    const syncDerivedState = async (nextSession: Session | null, force = false) => {
      const nextUser = nextSession?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const nextIdentityKey = getAuthIdentityKey(nextUser);
      const identityChanged = force || lastUserIdRef.current !== nextUserId;
      const duplicatePendingIdentity =
        !identityChanged && pendingIdentityKeyRef.current === nextIdentityKey;

      lastUserIdRef.current = nextUserId;
      if (mountedRef.current) {
        setSession(nextSession);
      }

      if (identityChanged) {
        pendingIdentityKeyRef.current = nextIdentityKey;
        derivedStateRequestIdRef.current += 1;
        if (mountedRef.current) {
          setResolvedIdentityKey(null);
        }
      } else if (duplicatePendingIdentity) {
        return;
      }

      await syncQueryCacheOwner(nextUserId);
      if (!mountedRef.current) {
        return;
      }

      if (!identityChanged) {
        if (mountedRef.current) {
          setResolvedIdentityKey(nextIdentityKey);
        }
        return;
      }

      const requestId = derivedStateRequestIdRef.current;
      await syncProfileState(nextUser, requestId, nextSession?.access_token ?? null);
      await syncTutorialState(nextUser, requestId);

      if (mountedRef.current && derivedStateRequestIdRef.current === requestId) {
        pendingIdentityKeyRef.current = null;
        setResolvedIdentityKey(nextIdentityKey);
      }
    };

    getExistingSessionSnapshot()
      .then(async (snapshot) => {
        await syncDerivedState(snapshot.session ?? null);
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
      setSessionReady(true);
      void syncDerivedState(nextSession, false);
    });

    return () => {
      mountedRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const loading =
    !sessionReady ||
    resolvedIdentityKey !== getAuthIdentityKey(session?.user ?? null);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      isGuest: isGuestUser(session?.user ?? null),
      profileComplete: Boolean(profile?.profileComplete),
      avatarStepNeeded: Boolean(profile?.avatarStepNeeded),
      tutorialSeen,
      async refreshProfile() {
        const nextUser = session?.user ?? null;
        if (!nextUser || isGuestUser(nextUser)) {
          setProfile(null);
          return null;
        }

        try {
          const payload = await fetchOwnProfile(session?.access_token ?? null);
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
        }
      },
      async markTutorialSeen() {
        const identity = getTutorialIdentity(session?.user ?? null);
        await saveTutorialSeen(identity);
        setTutorialSeen(true);
      },
      async resetTutorialSeen() {
        const identity = getTutorialIdentity(session?.user ?? null);
        await clearTutorialSeen(identity);
        setTutorialSeen(false);
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
        await startGuestSession();
      },
      async signOutToGuestSession() {
        await queryClient.cancelQueries();
        await signOutCurrentSession();
      },
    }),
    [loading, profile, session, tutorialSeen],
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
