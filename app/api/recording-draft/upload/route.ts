import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getServerSupabase } from "../../live-session/server";
import { isUniqueViolation } from "../../utils/mobile-sync-operations";
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
  clientCaptureId?: string | null;
  localDraftId?: string | null;
  localGroupId?: string | null;
};

type ExistingDraftCapture = {
  jobId: string | null;
  draftId: string;
  draftGameId: string;
  groupId: string | null;
  captureOrder: number;
  storageKey: string;
  capturedAtHint: string | null;
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

function normalizeOptionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function findExistingDraftCapture(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  userId: string,
  clientCaptureId: string
) {
  const { data: draftGame, error: draftGameError } = await supabase
    .from("recording_draft_games")
    .select("id,draft_id,group_id,capture_order,storage_key,captured_at_hint")
    .eq("client_capture_id", clientCaptureId)
    .maybeSingle();

  if (draftGameError) {
    throw new Error(
      draftGameError.message || "Failed to load existing recording draft game."
    );
  }

  if (!draftGame) {
    return null;
  }

  const { data: draft, error: draftError } = await supabase
    .from("recording_drafts")
    .select("id,user_id")
    .eq("id", draftGame.draft_id)
    .maybeSingle();

  if (draftError) {
    throw new Error(draftError.message || "Failed to load recording draft.");
  }

  if (!draft || draft.user_id !== userId) {
    return null;
  }

  const { data: analysisJob, error: analysisJobError } = await supabase
    .from("analysis_jobs")
    .select("id")
    .eq("recording_draft_game_id", draftGame.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (analysisJobError) {
    throw new Error(
      analysisJobError.message || "Failed to load existing recording draft job."
    );
  }

  return {
    jobId: analysisJob?.id ?? null,
    draftId: draft.id as string,
    draftGameId: draftGame.id as string,
    groupId:
      typeof draftGame.group_id === "string" ? draftGame.group_id : null,
    captureOrder: Number(draftGame.capture_order ?? 0),
    storageKey: draftGame.storage_key as string,
    capturedAtHint:
      typeof draftGame.captured_at_hint === "string"
        ? draftGame.captured_at_hint
        : null,
  } satisfies ExistingDraftCapture;
}

async function ensureRecordingDraftJob(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  existingCapture: ExistingDraftCapture,
  userId: string,
  timezoneOffsetMinutes: number | null,
  fileSizeBytes: number | null
) {
  if (existingCapture.jobId) {
    return existingCapture.jobId;
  }

  const jobId = randomUUID();
  const { error } = await supabase.from("analysis_jobs").insert({
    id: jobId,
    storage_key: existingCapture.storageKey,
    status: "queued",
    player_name: "recording-draft",
    user_id: userId,
    session_id: null,
    recording_draft_id: existingCapture.draftId,
    recording_draft_game_id: existingCapture.draftGameId,
    timezone_offset_minutes: timezoneOffsetMinutes,
    captured_at_hint: existingCapture.capturedAtHint,
    file_size_bytes: fileSizeBytes,
    job_type: "recording_draft",
  });

  if (error) {
    throw new Error(error.message || "Failed to queue recording draft job.");
  }

  await triggerWorkerIfConfigured(1);
  return jobId;
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
    normalizeOptionalInteger(payload.timezoneOffsetMinutes) ??
    new Date().getTimezoneOffset();

  try {
    const draft = await ensureRecordingDraft(userId, payload.mode);
    const { data: existingGroups, error: existingGroupsError } = await supabase
      .from("recording_draft_groups")
      .select("id,display_order,client_group_id")
      .eq("draft_id", draft.id)
      .order("display_order", { ascending: true });

    if (existingGroupsError) {
      throw new Error(existingGroupsError.message || "Failed to load draft groups.");
    }

    let groupIdByAutoIndex = new Map<number, string>();
    const groupIdByClientGroupId = new Map<string, string>();
    let nextDisplayOrder = (existingGroups ?? []).length;

    (existingGroups ?? []).forEach((group) => {
      const clientGroupId = normalizeOptionalString(group.client_group_id);
      if (clientGroupId) {
        groupIdByClientGroupId.set(clientGroupId, group.id as string);
      }
    });

    if (payload.mode !== "add_multiple_sessions") {
      const defaultGroup = await ensureDefaultRecordingDraftGroup(draft.id);
      groupIdByAutoIndex.set(0, defaultGroup.id);
    } else {
      const groupDefinitions = Array.from(
        new Map(
          storageItems.map((item) => {
            const autoGroupIndex =
              typeof item.autoGroupIndex === "number" ? item.autoGroupIndex : 0;
            const clientGroupId =
              normalizeOptionalString(item.localGroupId) ??
              `auto-group-${autoGroupIndex}`;
            return [
              clientGroupId,
              {
                autoGroupIndex,
                clientGroupId,
              },
            ];
          })
        ).values()
      ).sort((left, right) => left.autoGroupIndex - right.autoGroupIndex);

      for (const groupDefinition of groupDefinitions) {
        const existingGroupId = groupIdByClientGroupId.get(
          groupDefinition.clientGroupId
        );
        if (existingGroupId) {
          groupIdByAutoIndex.set(groupDefinition.autoGroupIndex, existingGroupId);
          continue;
        }

        const { data: createdGroup, error: groupError } = await supabase
          .from("recording_draft_groups")
          .insert({
            draft_id: draft.id,
            client_group_id: groupDefinition.clientGroupId,
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

        groupIdByAutoIndex.set(groupDefinition.autoGroupIndex, createdGroup.id);
        groupIdByClientGroupId.set(groupDefinition.clientGroupId, createdGroup.id);
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
    const createdGames: Array<{
      clientCaptureId?: string | null;
      draftId: string;
      groupId?: string | null;
      draftGameId: string;
      captureOrder: number;
    }> = [];

    try {
      for (const item of storageItems) {
        const clientCaptureId = normalizeOptionalString(item.clientCaptureId);
        if (clientCaptureId) {
          const existingCapture = await findExistingDraftCapture(
            supabase,
            userId,
            clientCaptureId
          );

          if (existingCapture) {
            await ensureRecordingDraftJob(
              supabase,
              existingCapture,
              userId,
              timezoneOffsetMinutes,
              typeof item.fileSizeBytes === "number" &&
                Number.isFinite(item.fileSizeBytes)
                ? Math.max(0, Math.floor(item.fileSizeBytes))
                : null
            );

            createdGames.push({
              clientCaptureId,
              draftId: existingCapture.draftId,
              groupId: existingCapture.groupId,
              draftGameId: existingCapture.draftGameId,
              captureOrder: existingCapture.captureOrder,
            });
            continue;
          }
        }

        const autoGroupIndex =
          payload.mode === "add_multiple_sessions" && typeof item.autoGroupIndex === "number"
            ? item.autoGroupIndex
            : 0;
        const localGroupId = normalizeOptionalString(item.localGroupId);
        const groupId =
          (localGroupId ? groupIdByClientGroupId.get(localGroupId) : null) ??
          groupIdByAutoIndex.get(autoGroupIndex) ??
          null;
        const normalizedCapturedAtHint = normalizeOptionalTimestamp(item.capturedAtHint);

        const { data: createdGame, error: gameError } = await supabase
          .from("recording_draft_games")
          .insert({
            draft_id: draft.id,
            group_id: groupId,
            client_capture_id: clientCaptureId,
            capture_order: nextCaptureOrder,
            storage_key: item.storageKey?.trim(),
            captured_at_hint: normalizedCapturedAtHint,
            sort_at: normalizedCapturedAtHint,
            status: "queued",
          })
          .select("id,storage_key")
          .single();

        if (gameError || !createdGame) {
          if (clientCaptureId && isUniqueViolation(gameError)) {
            const existingCapture = await findExistingDraftCapture(
              supabase,
              userId,
              clientCaptureId
            );

            if (existingCapture) {
              await ensureRecordingDraftJob(
                supabase,
                existingCapture,
                userId,
                timezoneOffsetMinutes,
                typeof item.fileSizeBytes === "number" &&
                  Number.isFinite(item.fileSizeBytes)
                  ? Math.max(0, Math.floor(item.fileSizeBytes))
                  : null
              );

              createdGames.push({
                clientCaptureId,
                draftId: existingCapture.draftId,
                groupId: existingCapture.groupId,
                draftGameId: existingCapture.draftGameId,
                captureOrder: existingCapture.captureOrder,
              });
              continue;
            }
          }

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
        createdGames.push({
          clientCaptureId,
          draftId: draft.id,
          groupId,
          draftGameId: createdGame.id,
          captureOrder: nextCaptureOrder,
        });
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

    return NextResponse.json({
      ...(await loadRecordingDraftPayload(userId, payload.mode)),
      createdGames,
    });
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
