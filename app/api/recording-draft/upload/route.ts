import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getServerSupabase } from "../../live-session/server";
import {
  ensureDefaultRecordingDraftGroup,
  ensureRecordingDraft,
  getRecordingDraftUserId,
  isRecordingDraftMode,
  loadRecordingDraftPayload,
  triggerWorkerIfConfigured,
} from "../server";

export const runtime = "nodejs";

type StorageItemInput = {
  storageKey?: string;
  capturedAtHint?: string | null;
  fileSizeBytes?: number | null;
  autoGroupIndex?: number | null;
};

function normalizeOptionalTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export async function POST(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getRecordingDraftUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    mode?: unknown;
    timezoneOffsetMinutes?: number | string | null;
    storageItems?: StorageItemInput[];
  };

  if (!isRecordingDraftMode(payload.mode)) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  const storageItems = Array.isArray(payload.storageItems)
    ? payload.storageItems.filter(
        (item): item is StorageItemInput =>
          Boolean(item && typeof item.storageKey === "string" && item.storageKey.trim())
      )
    : [];

  if (storageItems.length === 0) {
    return NextResponse.json(
      { error: "At least one storage item is required." },
      { status: 400 }
    );
  }

  const timezoneOffsetMinutes =
    typeof payload.timezoneOffsetMinutes === "string"
      ? Number.parseInt(payload.timezoneOffsetMinutes, 10)
      : typeof payload.timezoneOffsetMinutes === "number"
        ? payload.timezoneOffsetMinutes
        : new Date().getTimezoneOffset();

  try {
    const draft = await ensureRecordingDraft(userId, payload.mode);
    const { data: existingGroups, error: existingGroupsError } = await supabase
      .from("recording_draft_groups")
      .select("id,display_order")
      .eq("draft_id", draft.id)
      .order("display_order", { ascending: true });

    if (existingGroupsError) {
      throw new Error(existingGroupsError.message || "Failed to load draft groups.");
    }

    let groupIdByAutoIndex = new Map<number, string>();
    let nextDisplayOrder = (existingGroups ?? []).length;

    if (payload.mode !== "add_multiple_sessions") {
      const defaultGroup = await ensureDefaultRecordingDraftGroup(draft.id);
      groupIdByAutoIndex.set(0, defaultGroup.id);
    } else {
      const distinctAutoIndices = Array.from(
        new Set(
          storageItems.map((item) =>
            typeof item.autoGroupIndex === "number" ? item.autoGroupIndex : 0
          )
        )
      ).sort((left, right) => left - right);

      for (const autoGroupIndex of distinctAutoIndices) {
        const { data: createdGroup, error: groupError } = await supabase
          .from("recording_draft_groups")
          .insert({
            draft_id: draft.id,
            display_order: nextDisplayOrder,
            name: null,
            description: null,
            anchor_captured_at: null,
          })
          .select("id")
          .single();

        if (groupError || !createdGroup) {
          throw new Error(groupError?.message || "Failed to create recording draft group.");
        }

        groupIdByAutoIndex.set(autoGroupIndex, createdGroup.id);
        nextDisplayOrder += 1;
      }
    }

    const { data: existingGames, error: existingGamesError } = await supabase
      .from("recording_draft_games")
      .select("capture_order")
      .eq("draft_id", draft.id)
      .order("capture_order", { ascending: false })
      .limit(1);

    if (existingGamesError) {
      throw new Error(existingGamesError.message || "Failed to load existing draft games.");
    }

    let nextCaptureOrder = (existingGames?.[0]?.capture_order ?? 0) + 1;
    const createdDraftGames: Array<{ id: string; storageKey: string }> = [];
    const createdJobIds: string[] = [];

    try {
      for (const item of storageItems) {
        const autoGroupIndex =
          payload.mode === "add_multiple_sessions" && typeof item.autoGroupIndex === "number"
            ? item.autoGroupIndex
            : 0;
        const groupId = groupIdByAutoIndex.get(autoGroupIndex) ?? null;
        const normalizedCapturedAtHint = normalizeOptionalTimestamp(item.capturedAtHint);

        const { data: createdGame, error: gameError } = await supabase
          .from("recording_draft_games")
          .insert({
            draft_id: draft.id,
            group_id: groupId,
            capture_order: nextCaptureOrder,
            storage_key: item.storageKey?.trim(),
            captured_at_hint: normalizedCapturedAtHint,
            sort_at: normalizedCapturedAtHint,
            status: "queued",
          })
          .select("id,storage_key")
          .single();

        if (gameError || !createdGame) {
          throw new Error(gameError?.message || "Failed to create recording draft game.");
        }

        createdDraftGames.push({
          id: createdGame.id,
          storageKey: createdGame.storage_key,
        });

        const jobId = randomUUID();
        const { error: jobError } = await supabase.from("analysis_jobs").insert({
          id: jobId,
          storage_key: item.storageKey?.trim(),
          status: "queued",
          player_name: "recording-draft",
          user_id: userId,
          session_id: null,
          recording_draft_id: draft.id,
          recording_draft_game_id: createdGame.id,
          timezone_offset_minutes: Number.isFinite(timezoneOffsetMinutes)
            ? timezoneOffsetMinutes
            : new Date().getTimezoneOffset(),
          captured_at_hint: normalizedCapturedAtHint,
          file_size_bytes:
            typeof item.fileSizeBytes === "number" && Number.isFinite(item.fileSizeBytes)
              ? Math.max(0, Math.floor(item.fileSizeBytes))
              : null,
          job_type: "recording_draft",
        });

        if (jobError) {
          throw new Error(jobError.message || "Failed to queue recording draft job.");
        }

        createdJobIds.push(jobId);
        nextCaptureOrder += 1;
      }
    } catch (error) {
      if (createdJobIds.length > 0) {
        await supabase.from("analysis_jobs").delete().in("id", createdJobIds);
      }
      if (createdDraftGames.length > 0) {
        await supabase
          .from("recording_draft_games")
          .delete()
          .in(
            "id",
            createdDraftGames.map((game) => game.id)
          );
      }
      throw error;
    }

    await triggerWorkerIfConfigured(createdJobIds.length);

    return NextResponse.json(await loadRecordingDraftPayload(userId, payload.mode));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload to recording draft.",
      },
      { status: 500 }
    );
  }
}
