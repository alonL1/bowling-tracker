import type { Session, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { queryClient, QUERY_CACHE_OWNER_STORAGE_KEY } from '@/lib/query-client';
import {
  ensureMobileSession,
  isGuestUser,
  signInWithGoogleOAuth,
  signOutToGuest,
  supabase,
} from '@/lib/supabase';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  continueAsGuest: () => Promise<void>;
  signOutToGuestSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    const syncQueryCacheOwner = async (nextUserId: string | null) => {
      try {
        const currentOwner = await AsyncStorage.getItem(QUERY_CACHE_OWNER_STORAGE_KEY);
        if (currentOwner !== nextUserId) {
          queryClient.clear();
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

    ensureMobileSession()
      .then(async (snapshot) => {
        if (!mounted) {
          return;
        }
        const nextUserId = snapshot.session?.user?.id ?? null;
        await syncQueryCacheOwner(nextUserId);
        setSession(snapshot.session ?? null);
        lastUserIdRef.current = nextUserId;
      })
      .catch((error) => {
        console.error('Failed to initialize mobile auth session.', error);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;
      if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== nextUserId) {
        queryClient.clear();
      }
      void syncQueryCacheOwner(nextUserId);
      lastUserIdRef.current = nextUserId;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      isGuest: isGuestUser(session?.user ?? null),
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          throw error;
        }
      },
      async signUpWithPassword(email, password) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) {
          throw error;
        }
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
        await signOutToGuest();
      },
    }),
    [loading, session],
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
