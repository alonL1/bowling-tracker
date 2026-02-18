import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../../utils/auth";

export const runtime = "nodejs";

function isAnonymousUser(user: {
  is_anonymous?: boolean;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}) {
  if (user.is_anonymous) {
    return true;
  }
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata?.providers
    : [];
  if (providers.includes("anonymous")) {
    return true;
  }
  return user.app_metadata?.provider === "anonymous";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const destination = await getUserFromRequest(request);
  if (!destination.userId || !destination.accessToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    guestAccessToken?: string;
    action?: "check" | "move";
  };
  const guestAccessToken =
    typeof payload.guestAccessToken === "string"
      ? payload.guestAccessToken.trim()
      : "";
  const action = payload.action === "check" ? "check" : "move";
  if (!guestAccessToken) {
    return NextResponse.json(
      { error: "guestAccessToken is required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: destinationUserData, error: destinationUserError } =
    await supabase.auth.getUser(destination.accessToken);
  if (destinationUserError || !destinationUserData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (isAnonymousUser(destinationUserData.user)) {
    return NextResponse.json(
      { error: "Sign in with an account before moving guest logs." },
      { status: 400 }
    );
  }

  const { data: guestUserData, error: guestUserError } =
    await supabase.auth.getUser(guestAccessToken);
  if (guestUserError || !guestUserData.user) {
    return NextResponse.json(
      { error: "Invalid guest session." },
      { status: 401 }
    );
  }

  if (!isAnonymousUser(guestUserData.user)) {
    return NextResponse.json(
      { error: "guestAccessToken must belong to a guest session." },
      { status: 400 }
    );
  }

  if (guestUserData.user.id === destination.userId) {
    return NextResponse.json({
      ok: true,
      moved: { sessions: 0, games: 0, jobs: 0 },
      check: { sessions: 0, games: 0, jobs: 0, total: 0 }
    });
  }

  if (action === "check") {
    const { count: sessionsCount, error: sessionsCountError } = await supabase
      .from("bowling_sessions")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", guestUserData.user.id);
    if (sessionsCountError) {
      return NextResponse.json(
        { error: sessionsCountError.message || "Failed to check sessions." },
        { status: 500 }
      );
    }

    const { count: gamesCount, error: gamesCountError } = await supabase
      .from("games")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", guestUserData.user.id);
    if (gamesCountError) {
      return NextResponse.json(
        { error: gamesCountError.message || "Failed to check games." },
        { status: 500 }
      );
    }

    const { count: jobsCount, error: jobsCountError } = await supabase
      .from("analysis_jobs")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", guestUserData.user.id);
    if (jobsCountError) {
      return NextResponse.json(
        { error: jobsCountError.message || "Failed to check analysis jobs." },
        { status: 500 }
      );
    }

    const sessions = sessionsCount ?? 0;
    const games = gamesCount ?? 0;
    const jobs = jobsCount ?? 0;
    return NextResponse.json({
      ok: true,
      check: {
        sessions,
        games,
        jobs,
        total: sessions + games + jobs
      }
    });
  }

  const {
    error: sessionMoveError,
    data: movedSessions
  } = await supabase
    .from("bowling_sessions")
    .update({ user_id: destination.userId })
    .eq("user_id", guestUserData.user.id)
    .select("id");

  if (sessionMoveError) {
    return NextResponse.json(
      { error: sessionMoveError.message || "Failed to move sessions." },
      { status: 500 }
    );
  }

  const {
    error: gamesMoveError,
    data: movedGames
  } = await supabase
    .from("games")
    .update({ user_id: destination.userId })
    .eq("user_id", guestUserData.user.id)
    .select("id");

  if (gamesMoveError) {
    return NextResponse.json(
      { error: gamesMoveError.message || "Failed to move games." },
      { status: 500 }
    );
  }

  const {
    error: jobsMoveError,
    data: movedJobs
  } = await supabase
    .from("analysis_jobs")
    .update({ user_id: destination.userId })
    .eq("user_id", guestUserData.user.id)
    .select("id");

  if (jobsMoveError) {
    return NextResponse.json(
      { error: jobsMoveError.message || "Failed to move analysis jobs." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    moved: {
      sessions: movedSessions?.length ?? 0,
      games: movedGames?.length ?? 0,
      jobs: movedJobs?.length ?? 0
    }
  });
}
