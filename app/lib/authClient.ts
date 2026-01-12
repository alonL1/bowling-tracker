"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

async function ensureAnonSession() {
  if (!supabase) {
    throw new Error("Supabase client not configured.");
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    return sessionData.session.access_token;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw error;
  }
  return data.session?.access_token ?? null;
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = await ensureAnonSession();
  const headers = new Headers(init?.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

export async function getAccessToken() {
  return ensureAnonSession();
}

export { supabase };
