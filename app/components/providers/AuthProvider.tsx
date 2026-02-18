"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  getCurrentUser,
  isGuestUser,
  onClientAuthStateChange,
  signOutToGuest
} from "../../lib/authClient";

type AuthContextValue = {
  user: User | null;
  isGuest: boolean;
  loading: boolean;
  error: string;
  signOutToGuestSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      try {
        const current = await getCurrentUser();
        if (!mounted) {
          return;
        }
        setUser(current);
      } catch (nextError) {
        if (!mounted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to initialize account."
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initialize();
    const { data: subscription } = onClientAuthStateChange((nextUser) => {
      setUser(nextUser);
      setError("");
    });
    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  const signOutToGuestSession = async () => {
    const guestUser = await signOutToGuest();
    setUser(guestUser);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isGuest: isGuestUser(user),
      loading,
      error,
      signOutToGuestSession
    }),
    [user, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
