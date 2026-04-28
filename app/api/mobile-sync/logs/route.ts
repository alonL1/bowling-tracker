import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getUserFromRequest } from "../../utils/auth";
import {
  ensureProfileForAuthUser,
  toUserProfilePayload,
} from "../../utils/profiles";

export const runtime = "nodejs";

type TombstoneRow = {
  entity_type: string;
  entity_id: string;
};

function normalizeSince(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))
  );
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const authViewer = await getUserFromRequest(request);
  const devUserId = process.env.DEV_USER_ID;
  const viewer =
    authViewer.userId || !devUserId
      ? authViewer
      : {
          ...authViewer,
          userId: devUserId,
          isGuest: false,
        };
  if (!viewer.userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const since = normalizeSince(searchParams.get("since"));
  const serverTime = new Date().toISOString();

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    const profile =
      !viewer.isGuest && viewer.authUser
        ? toUserProfilePayload(
            supabase,
            await ensureProfileForAuthUser(supabase, viewer.authUser),
            viewer.authUser
          )
        : null;

    let sessionQuery = supabase
      .from("bowling_sessions")
      .select("id,name,description,started_at,created_at,updated_at")
      .eq("user_id", viewer.userId);

    if (since) {
      sessionQuery = sessionQuery.gt("updated_at", since);
    }

    const { data: sessions, error: sessionsError } = await sessionQuery;
    if (sessionsError) {
      throw new Error(sessionsError.message || "Failed to load synced sessions.");
    }

    let gameQuery = supabase
      .from("games")
      .select(
        [
          "id",
          "game_name",
          "player_name",
          "total_score",
          "status",
          "played_at",
          "created_at",
          "updated_at",
          "session_id",
          "scoreboard_extraction",
          "selected_self_player_key",
          "selected_self_player_name",
          "session:bowling_sessions(id,name,description,started_at,created_at,updated_at)",
          "frames:frames(id,game_id,frame_number,is_strike,is_spare,frame_score,updated_at,shots:shots(id,frame_id,shot_number,pins,updated_at))",
        ].join(",")
      )
      .eq("user_id", viewer.userId);

    if (since) {
      gameQuery = gameQuery.gt("updated_at", since);
    }

    const { data: games, error: gamesError } = await gameQuery;
    if (gamesError) {
      throw new Error(gamesError.message || "Failed to load synced games.");
    }

    let tombstoneQuery = supabase
      .from("mobile_sync_tombstones")
      .select("entity_type,entity_id")
      .eq("user_id", viewer.userId);

    if (since) {
      tombstoneQuery = tombstoneQuery.gt("deleted_at", since);
    } else {
      tombstoneQuery = tombstoneQuery.limit(0);
    }

    const { data: tombstones, error: tombstonesError } = await tombstoneQuery;
    if (tombstonesError) {
      throw new Error(tombstonesError.message || "Failed to load deleted logs.");
    }

    const deletedSessions = dedupeStrings(
      ((tombstones ?? []) as TombstoneRow[])
        .filter((row) => row.entity_type === "session")
        .map((row) => row.entity_id)
    );
    const deletedGames = dedupeStrings(
      ((tombstones ?? []) as TombstoneRow[])
        .filter((row) => row.entity_type === "game")
        .map((row) => row.entity_id)
    );

    return NextResponse.json({
      serverTime,
      profile,
      sessions: sessions ?? [],
      games: games ?? [],
      deletedSessions,
      deletedGames,
      nextCursor: serverTime,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync logs.",
      },
      { status: 500 }
    );
  }
}
