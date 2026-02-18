"use client";

import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

type SessionSnapshot = {
  user: User | null;
  accessToken: string | null;
};

function getProviderNames(user: User | null) {
  if (!user) {
    return [];
  }
  const appMetadata = user.app_metadata as
    | { provider?: string; providers?: string[] }
    | undefined;
  const providers = Array.isArray(appMetadata?.providers)
    ? appMetadata.providers
    : [];
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
  return getProviderNames(user).includes("anonymous");
}

async function ensureClientSession(): Promise<SessionSnapshot> {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user && sessionData.session.access_token) {
    return {
      user: sessionData.session.user,
      accessToken: sessionData.session.access_token
    };
  }

  const { data: anonymousData, error: anonymousError } =
    await supabase.auth.signInAnonymously();
  if (anonymousError || !anonymousData.session?.access_token) {
    throw anonymousError || new Error("Failed to start guest session.");
  }
  return {
    user: anonymousData.session.user,
    accessToken: anonymousData.session.access_token
  };
}

export async function getSessionSnapshot(): Promise<SessionSnapshot> {
  return ensureClientSession();
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { accessToken } = await ensureClientSession();
  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(input, { ...init, headers });
}

export async function getAccessToken() {
  const { accessToken } = await ensureClientSession();
  return accessToken;
}

export async function getCurrentUser(): Promise<User | null> {
  const { user } = await ensureClientSession();
  return user;
}

export function onClientAuthStateChange(
  callback: (user: User | null) => void
) {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

export async function signUpWithPassword(email: string, password: string) {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
}

export async function signOutClient() {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function signOutToGuest() {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    throw signOutError;
  }
  const { data: guestData, error: guestError } =
    await supabase.auth.signInAnonymously();
  if (guestError || !guestData.user) {
    throw guestError || new Error("Failed to start guest session.");
  }
  return guestData.user;
}

export { supabase };
