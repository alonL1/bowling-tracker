import { getUserIdFromRequest } from "../utils/auth";
import { buildPlayerOptions, normalizeSelectedPlayerKeys } from "../live-session/shared";
import { getServerSupabase, triggerWorkerIfConfigured } from "../live-session/server";

export const RECORDING_DRAFT_MODES = [
  "upload_session",
  "add_multiple_sessions",
  "add_existing_session",
] as const;

export type RecordingDraftMode = (typeof RECORDING_DRAFT_MODES)[number];

export const DEFAULT_BUCKET = "scoreboards-temp";

export function isRecordingDraftMode(value: unknown): value is RecordingDraftMode {
  return RECORDING_DRAFT_MODES.includes(value as RecordingDraftMode);
}

export async function getRecordingDraftUserId(request: Request) {
  return getUserIdFromRequest(request);
}

export function buildRecordingDraftProgress(
  games: Array<{ status?: string | null }>
) {
  const total = games.length;
  const queued = games.filter((game) => game.status === "queued").length;
  const processing = games.filter((game) => game.status === "processing").length;
  const ready = games.filter((game) => game.status === "ready").length;
  const error = games.filter((game) => game.status === "error").length;

  return {
    total,
    queued,
    processing,
    ready,
    error,
    completed: ready + error,
  };
}

export async function getActiveRecordingDraftRecord(
  userId: string,
  mode: RecordingDraftMode
) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const { data, error } = await supabase
    .from("recording_drafts")
    .select(
      "id,user_id,mode,status,selected_player_keys,target_session_id,name,description,created_at,updated_at"
    )
    .eq("user_id", userId)
    .eq("mode", mode)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load recording draft.");
  }

  return data;
}

export async function createRecordingDraft(
  userId: string,
  mode: RecordingDraftMode
) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const { data, error } = await supabase
    .from("recording_drafts")
    .insert({
      user_id: userId,
      mode,
      status: "active",
      selected_player_keys: [],
    })
    .select(
      "id,user_id,mode,status,selected_player_keys,target_session_id,name,description,created_at,updated_at"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create recording draft.");
  }

  return data;
}

export async function ensureRecordingDraft(
  userId: string,
  mode: RecordingDraftMode
) {
  const existing = await getActiveRecordingDraftRecord(userId, mode);
  if (existing) {
    return existing;
  }
  return createRecordingDraft(userId, mode);
}

export async function ensureDefaultRecordingDraftGroup(draftId: string) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("recording_draft_groups")
    .select("id,draft_id,display_order,name,description,anchor_captured_at,created_at,updated_at")
    .eq("draft_id", draftId)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Failed to load draft group.");
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("recording_draft_groups")
    .insert({
      draft_id: draftId,
      display_order: 0,
      name: null,
      description: null,
      anchor_captured_at: null,
    })
    .select("id,draft_id,display_order,name,description,anchor_captured_at,created_at,updated_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create draft group.");
  }

  return data;
}

export async function loadRecordingDraftPayload(
  userId: string,
  mode: RecordingDraftMode
) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const draft = await getActiveRecordingDraftRecord(userId, mode);
  if (!draft) {
    return { draft: null };
  }

  const [{ data: groups, error: groupsError }, { data: games, error: gamesError }] =
    await Promise.all([
      supabase
        .from("recording_draft_groups")
        .select("id,draft_id,display_order,name,description,anchor_captured_at,created_at,updated_at")
        .eq("draft_id", draft.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("recording_draft_games")
        .select(
          "id,draft_id,group_id,capture_order,storage_key,status,captured_at_hint,captured_at,sort_at,last_error,created_at,updated_at,extraction"
        )
        .eq("draft_id", draft.id)
        .order("capture_order", { ascending: true }),
    ]);

  if (groupsError) {
    throw new Error(groupsError.message || "Failed to load draft groups.");
  }
  if (gamesError) {
    throw new Error(gamesError.message || "Failed to load draft games.");
  }

  const orderedGroups = [...(groups ?? [])];
  const gamesByGroupId = new Map<string | null, typeof games>();
  (games ?? []).forEach((game) => {
    const key = game.group_id ?? null;
    const current = gamesByGroupId.get(key);
    if (current) {
      current.push(game);
    } else {
      gamesByGroupId.set(key, [game]);
    }
  });

  const effectiveGroups =
    orderedGroups.length > 0
      ? orderedGroups
      : [
          {
            id: "default",
            draft_id: draft.id,
            display_order: 0,
            name: null,
            description: null,
            anchor_captured_at: null,
            created_at: draft.created_at,
            updated_at: draft.updated_at,
          },
        ];

  const groupsWithGames = effectiveGroups.map((group) => {
    const groupGames = [...(gamesByGroupId.get(group.id) ?? gamesByGroupId.get(null) ?? [])].sort(
      (left, right) => {
        const leftTime = Date.parse(
          left.sort_at || left.captured_at || left.captured_at_hint || left.created_at || ""
        );
        const rightTime = Date.parse(
          right.sort_at || right.captured_at || right.captured_at_hint || right.created_at || ""
        );
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.capture_order - right.capture_order;
      }
    );

    return {
      ...group,
      games: groupGames,
    };
  });

  return {
    draft: {
      id: draft.id,
      mode: draft.mode,
      status: draft.status,
      selectedPlayerKeys: normalizeSelectedPlayerKeys(draft.selected_player_keys),
      playerOptions: buildPlayerOptions(games ?? []),
      targetSessionId: draft.target_session_id,
      name: draft.name,
      description: draft.description,
      groups: groupsWithGames,
      progress: buildRecordingDraftProgress(games ?? []),
    },
  };
}

export async function discardRecordingDraft(
  userId: string,
  mode: RecordingDraftMode
) {
  const supabase = getServerSupabase();
  if (!supabase) {
    throw new Error("Missing Supabase configuration.");
  }

  const draft = await getActiveRecordingDraftRecord(userId, mode);
  if (!draft) {
    return { ok: true, discarded: false };
  }

  const { data: draftGames, error: gamesError } = await supabase
    .from("recording_draft_games")
    .select("id,storage_key")
    .eq("draft_id", draft.id);

  if (gamesError) {
    throw new Error(gamesError.message || "Failed to load draft games.");
  }

  await supabase
    .from("analysis_jobs")
    .delete()
    .eq("recording_draft_id", draft.id)
    .eq("user_id", userId);

  if (draftGames && draftGames.length > 0) {
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;
    await supabase.storage
      .from(bucket)
      .remove(
        draftGames
          .map((game) => game.storage_key)
          .filter((storageKey) => typeof storageKey === "string" && storageKey.length > 0)
      );
  }

  await supabase.from("recording_draft_groups").delete().eq("draft_id", draft.id);
  await supabase.from("recording_draft_games").delete().eq("draft_id", draft.id);
  await supabase
    .from("recording_drafts")
    .update({
      status: "discarded",
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
    .eq("user_id", userId);

  return { ok: true, discarded: true };
}

export function normalizeSortAt(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export { triggerWorkerIfConfigured };
