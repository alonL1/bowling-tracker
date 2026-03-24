import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DeletionCounts = {
  analysisJobs: number;
  inviteLinks: number;
  friendships: number;
  liveSessions: number;
  drafts: number;
  games: number;
  sessions: number;
  submitLogs: number;
  storageObjects: number;
};

export function getAccountSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

async function collectStorageKeys(supabase: SupabaseClient, userId: string) {
  const keys = new Set<string>();

  const { data: analysisJobs, error: analysisJobsError } = await supabase
    .from("analysis_jobs")
    .select("storage_key")
    .eq("user_id", userId);

  if (analysisJobsError) {
    throw new Error(analysisJobsError.message || "Failed to load account jobs.");
  }

  (analysisJobs ?? []).forEach((job) => {
    if (typeof job.storage_key === "string" && job.storage_key.length > 0) {
      keys.add(job.storage_key);
    }
  });

  const { data: liveSessions, error: liveSessionsError } = await supabase
    .from("live_sessions")
    .select("id")
    .eq("user_id", userId);

  if (liveSessionsError) {
    throw new Error(liveSessionsError.message || "Failed to load live sessions.");
  }

  const liveSessionIds = (liveSessions ?? [])
    .map((session) => session.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (liveSessionIds.length > 0) {
    const { data: liveSessionGames, error: liveSessionGamesError } = await supabase
      .from("live_session_games")
      .select("storage_key")
      .in("live_session_id", liveSessionIds);

    if (liveSessionGamesError) {
      throw new Error(liveSessionGamesError.message || "Failed to load live session uploads.");
    }

    (liveSessionGames ?? []).forEach((game) => {
      if (typeof game.storage_key === "string" && game.storage_key.length > 0) {
        keys.add(game.storage_key);
      }
    });
  }

  const { data: drafts, error: draftsError } = await supabase
    .from("recording_drafts")
    .select("id")
    .eq("user_id", userId);

  if (draftsError) {
    throw new Error(draftsError.message || "Failed to load recording drafts.");
  }

  const draftIds = (drafts ?? [])
    .map((draft) => draft.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (draftIds.length > 0) {
    const { data: draftGames, error: draftGamesError } = await supabase
      .from("recording_draft_games")
      .select("storage_key")
      .in("draft_id", draftIds);

    if (draftGamesError) {
      throw new Error(draftGamesError.message || "Failed to load draft uploads.");
    }

    (draftGames ?? []).forEach((game) => {
      if (typeof game.storage_key === "string" && game.storage_key.length > 0) {
        keys.add(game.storage_key);
      }
    });
  }

  return Array.from(keys);
}

export async function purgeUserData(supabase: SupabaseClient, userId: string) {
  const storageKeys = await collectStorageKeys(supabase, userId);

  const [{ count: analysisJobs, error: analysisJobsError }, { count: inviteLinks, error: inviteLinksError }] =
    await Promise.all([
      supabase
        .from("analysis_jobs")
        .delete({ count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("friend_invite_links")
        .delete({ count: "exact" })
        .eq("inviter_user_id", userId),
    ]);

  if (analysisJobsError) {
    throw new Error(analysisJobsError.message || "Failed to delete analysis jobs.");
  }
  if (inviteLinksError) {
    throw new Error(inviteLinksError.message || "Failed to delete invite links.");
  }

  const [{ count: ownFriendships, error: ownFriendshipsError }, { count: friendSideFriendships, error: friendSideFriendshipsError }] =
    await Promise.all([
      supabase
        .from("friendships")
        .delete({ count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("friendships")
        .delete({ count: "exact" })
        .eq("friend_user_id", userId),
    ]);

  if (ownFriendshipsError) {
    throw new Error(ownFriendshipsError.message || "Failed to delete friendships.");
  }
  if (friendSideFriendshipsError) {
    throw new Error(friendSideFriendshipsError.message || "Failed to delete reverse friendships.");
  }

  const [{ count: liveSessions, error: liveSessionsError }, { count: drafts, error: draftsError }] =
    await Promise.all([
      supabase
        .from("live_sessions")
        .delete({ count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("recording_drafts")
        .delete({ count: "exact" })
        .eq("user_id", userId),
    ]);

  if (liveSessionsError) {
    throw new Error(liveSessionsError.message || "Failed to delete live sessions.");
  }
  if (draftsError) {
    throw new Error(draftsError.message || "Failed to delete recording drafts.");
  }

  const [{ count: games, error: gamesError }, { count: sessions, error: sessionsError }, { count: submitLogs, error: submitLogsError }] =
    await Promise.all([
      supabase
        .from("games")
        .delete({ count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("bowling_sessions")
        .delete({ count: "exact" })
        .eq("user_id", userId),
      supabase
        .from("submit_request_logs")
        .delete({ count: "exact" })
        .eq("user_id", userId),
    ]);

  if (gamesError) {
    throw new Error(gamesError.message || "Failed to delete games.");
  }
  if (sessionsError) {
    throw new Error(sessionsError.message || "Failed to delete sessions.");
  }
  if (submitLogsError) {
    throw new Error(submitLogsError.message || "Failed to delete submit logs.");
  }

  if (storageKeys.length > 0) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "scoreboards-temp";
    const { error: storageError } = await supabase.storage.from(bucket).remove(storageKeys);
    if (storageError) {
      throw new Error(storageError.message || "Failed to delete uploaded files.");
    }
  }

  return {
    analysisJobs: analysisJobs ?? 0,
    inviteLinks: inviteLinks ?? 0,
    friendships: (ownFriendships ?? 0) + (friendSideFriendships ?? 0),
    liveSessions: liveSessions ?? 0,
    drafts: drafts ?? 0,
    games: games ?? 0,
    sessions: sessions ?? 0,
    submitLogs: submitLogs ?? 0,
    storageObjects: storageKeys.length,
  } satisfies DeletionCounts;
}
