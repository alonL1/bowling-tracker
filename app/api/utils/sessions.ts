import type { SupabaseClient } from "@supabase/supabase-js";

export async function deleteSessionIfEmpty(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ deleted: boolean }> {
  const { count, error } = await supabase
    .from("games")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message || "Failed to check session games.");
  }

  if ((count ?? 0) > 0) {
    return { deleted: false };
  }

  const { error: deleteError } = await supabase
    .from("bowling_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (deleteError) {
    throw new Error(deleteError.message || "Failed to delete empty session.");
  }

  return { deleted: true };
}
