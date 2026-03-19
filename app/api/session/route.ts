import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserIdFromRequest } from "../utils/auth";
import { normalizeLiveExtraction } from "../live-session/shared";
import { syncLoggedGameSelection } from "../utils/logged-scoreboard";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    sessionId?: string;
    name?: string;
    description?: string;
    gameSelections?: Array<{
      gameId?: string;
      selectedSelfPlayerKey?: string;
    }>;
  };

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required." },
      { status: 400 }
    );
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const gameSelections = Array.isArray(payload.gameSelections)
    ? payload.gameSelections
        .map((entry) => ({
          gameId: typeof entry?.gameId === "string" ? entry.gameId.trim() : "",
          selectedSelfPlayerKey:
            typeof entry?.selectedSelfPlayerKey === "string"
              ? entry.selectedSelfPlayerKey.trim()
              : "",
        }))
        .filter(
          (entry) => entry.gameId.length > 0 && entry.selectedSelfPlayerKey.length > 0
        )
    : [];

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: session, error } = await supabase
    .from("bowling_sessions")
    .update({
      name: name || null,
      description: description || null
    })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .select("id,name,description,created_at")
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: error?.message || "Failed to update session." },
      { status: 500 }
    );
  }

  if (gameSelections.length > 0) {
    const { data: sessionGames, error: gamesError } = await supabase
      .from("games")
      .select(
        "id,user_id,session_id,scoreboard_extraction,selected_self_player_key,selected_self_player_name,player_name"
      )
      .eq("session_id", sessionId)
      .eq("user_id", userId);

    if (gamesError) {
      return NextResponse.json(
        { error: gamesError.message || "Failed to load session games." },
        { status: 500 }
      );
    }

    const gamesById = new Map(
      (sessionGames ?? []).map((game) => [game.id as string, game])
    );

    for (const selection of gameSelections) {
      const game = gamesById.get(selection.gameId);
      if (!game) {
        return NextResponse.json(
          { error: `Game ${selection.gameId} was not found in this session.` },
          { status: 400 }
        );
      }

      const fullExtraction = normalizeLiveExtraction(game.scoreboard_extraction);
      const selectedPlayer = fullExtraction.players.find(
        (player) => player.playerKey === selection.selectedSelfPlayerKey
      );

      if (!selectedPlayer) {
        return NextResponse.json(
          {
            error:
              `Selected player ${selection.selectedSelfPlayerKey} was not found on game ${selection.gameId}.`,
          },
          { status: 400 }
        );
      }

      try {
        await syncLoggedGameSelection({
          supabase,
          gameId: selection.gameId,
          fullExtraction,
          selectedPlayer,
        });
      } catch (selectionError) {
        return NextResponse.json(
          {
            error:
              selectionError instanceof Error
                ? selectionError.message
                : "Failed to update selected players.",
          },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ session });
}

export async function DELETE(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    sessionId?: string;
    mode?: "sessionless" | "delete_games";
  };

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required." },
      { status: 400 }
    );
  }

  if (payload.mode !== "sessionless" && payload.mode !== "delete_games") {
    return NextResponse.json(
      { error: "mode must be sessionless or delete_games." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: session, error: sessionError } = await supabase
    .from("bowling_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json(
      { error: sessionError?.message || "Session not found." },
      { status: 404 }
    );
  }

  if (payload.mode === "sessionless") {
    const { error: updateError } = await supabase
      .from("games")
      .update({ session_id: null })
      .eq("session_id", sessionId)
      .eq("user_id", userId);
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to move games to sessionless." },
        { status: 500 }
      );
    }
  } else {
    const { error: deleteError } = await supabase
      .from("games")
      .delete()
      .eq("session_id", sessionId)
      .eq("user_id", userId);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to delete games in session." },
        { status: 500 }
      );
    }
  }

  const { error: sessionDeleteError } = await supabase
    .from("bowling_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (sessionDeleteError) {
    return NextResponse.json(
      { error: sessionDeleteError.message || "Failed to delete session." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
