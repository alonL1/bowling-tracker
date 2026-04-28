import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";

export const runtime = "nodejs";

function normalizeOptionalUuid(value?: string | null) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") {
    return null;
  }
  return trimmed;
}

type SessionRow = {
  id: string;
  name: string | null;
  description: string | null;
  started_at: string | null;
  created_at: string | null;
};

type SessionGameRow = {
  session_id: string | null;
  played_at: string | null;
  created_at: string | null;
};

function parseDate(value?: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortSessionsByFirstGameDate(
  sessions: SessionRow[],
  games: SessionGameRow[]
) {
  const firstGameBySessionId = new Map<string, string>();
  const firstGameTimeBySessionId = new Map<string, number>();

  for (const game of games) {
    if (!game.session_id) {
      continue;
    }
    const dateSource = game.played_at || game.created_at;
    const timestamp = parseDate(dateSource);
    if (!dateSource || timestamp === 0) {
      continue;
    }
    const existing = firstGameTimeBySessionId.get(game.session_id) ?? 0;
    if (existing === 0 || timestamp < existing) {
      firstGameTimeBySessionId.set(game.session_id, timestamp);
      firstGameBySessionId.set(game.session_id, dateSource);
    }
  }

  return sessions
    .map((session) => {
      const firstGameDate = firstGameBySessionId.get(session.id) ?? null;
      return {
        ...session,
        started_at: firstGameDate || session.started_at,
        firstGameTs:
          (firstGameTimeBySessionId.get(session.id) ??
            parseDate(session.started_at)) || parseDate(session.created_at),
        createdAtTs: parseDate(session.created_at),
      };
    })
    .sort((left, right) => {
      const firstGameDiff = right.firstGameTs - left.firstGameTs;
      if (firstGameDiff !== 0) {
        return firstGameDiff;
      }
      const createdAtDiff = right.createdAtTs - left.createdAtTs;
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return right.id.localeCompare(left.id);
    })
    .map(({ firstGameTs, createdAtTs, ...session }) => session);
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId =
    normalizeOptionalUuid(await getUserIdFromRequest(request)) ?? devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("bowling_sessions")
    .select("id,name,description,started_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load sessions." },
      { status: 500 }
    );
  }

  const { data: sessionGames, error: sessionGamesError } = await supabase
    .from("games")
    .select("session_id,played_at,created_at")
    .eq("user_id", userId)
    .not("session_id", "is", null);

  if (sessionGamesError) {
    return NextResponse.json(
      { error: sessionGamesError.message || "Failed to load session dates." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessions: sortSessionsByFirstGameDate(data || [], sessionGames || [])
  });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId =
    normalizeOptionalUuid(await getUserIdFromRequest(request)) ?? devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    name?: string;
    description?: string;
  };

  const name =
    typeof payload.name === "string" ? payload.name.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("bowling_sessions")
    .insert({
      user_id: userId,
      name: name || null,
      description: description || null
    })
    .select("id,name,description,started_at,created_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to create session." },
      { status: 500 }
    );
  }

  return NextResponse.json({ session: data });
}
