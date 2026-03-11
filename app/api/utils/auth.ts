import { createClient } from "@supabase/supabase-js";

type AuthUserLike = {
  is_anonymous?: boolean;
  email?: string | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
};

function isAnonymousUser(user: AuthUserLike) {
  if (user.is_anonymous) {
    return true;
  }
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];
  if (providers.includes("anonymous")) {
    return true;
  }
  return user.app_metadata?.provider === "anonymous";
}

export async function getUserIdFromRequest(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authHeader =
    request.headers.get("authorization") ||
    request.headers.get("Authorization") ||
    "";

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token || !supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }
  return data.user.id;
}

export async function getUserFromRequest(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authHeader =
    request.headers.get("authorization") ||
    request.headers.get("Authorization") ||
    "";

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { userId: null, accessToken: null, isGuest: false, email: null };
  }
  const token = authHeader.slice(7).trim();
  if (!token || !supabaseUrl || !supabaseServiceKey) {
    return { userId: null, accessToken: null, isGuest: false, email: null };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { userId: null, accessToken: null, isGuest: false, email: null };
  }
  return {
    userId: data.user.id,
    accessToken: token,
    isGuest: isAnonymousUser(data.user),
    email: data.user.email ?? null
  };
}
