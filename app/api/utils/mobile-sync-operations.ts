import type { SupabaseClient } from "@supabase/supabase-js";

export const MOBILE_SYNC_SCOPE = {
  liveSessionEnd: "live_session_end",
  recordingDraftFinalize: "recording_draft_finalize",
} as const;

export type MobileSyncScope =
  (typeof MOBILE_SYNC_SCOPE)[keyof typeof MOBILE_SYNC_SCOPE];

type MobileSyncOperationRow = {
  id: string;
  status: "pending" | "completed" | "failed";
  response: unknown;
  updated_at: string | null;
};

const STALE_PENDING_MS = 2 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function isStale(updatedAt: string | null) {
  if (!updatedAt) {
    return true;
  }
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }
  return Date.now() - updatedAtMs >= STALE_PENDING_MS;
}

export function normalizeClientOperationKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

async function loadMobileSyncOperation(
  supabase: SupabaseClient,
  userId: string,
  scope: MobileSyncScope,
  operationKey: string
) {
  const { data, error } = await supabase
    .from("mobile_sync_operations")
    .select("id,status,response,updated_at")
    .eq("user_id", userId)
    .eq("scope", scope)
    .eq("operation_key", operationKey)
    .maybeSingle<MobileSyncOperationRow>();

  if (error) {
    throw new Error(error.message || "Failed to load mobile sync operation.");
  }

  return data;
}

export async function beginMobileSyncOperation<TResponse>(
  supabase: SupabaseClient,
  userId: string,
  scope: MobileSyncScope,
  operationKey: string
): Promise<
  | { kind: "completed"; response: TResponse }
  | { kind: "claimed" }
  | { kind: "in_progress" }
> {
  const existing = await loadMobileSyncOperation(
    supabase,
    userId,
    scope,
    operationKey
  );

  if (existing?.status === "completed" && existing.response) {
    return {
      kind: "completed",
      response: existing.response as TResponse,
    };
  }

  if (existing) {
    if (existing.status === "pending" && !isStale(existing.updated_at)) {
      return { kind: "in_progress" };
    }

    const { error: updateError } = await supabase
      .from("mobile_sync_operations")
      .update({
        status: "pending",
        response: null,
        last_error: null,
        updated_at: nowIso(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(
        updateError.message || "Failed to update mobile sync operation."
      );
    }

    return { kind: "claimed" };
  }

  const { error: insertError } = await supabase
    .from("mobile_sync_operations")
    .insert({
      user_id: userId,
      scope,
      operation_key: operationKey,
      status: "pending",
      response: null,
      last_error: null,
    });

  if (!insertError) {
    return { kind: "claimed" };
  }

  if (isUniqueViolation(insertError)) {
    const conflict = await loadMobileSyncOperation(
      supabase,
      userId,
      scope,
      operationKey
    );

    if (conflict?.status === "completed" && conflict.response) {
      return {
        kind: "completed",
        response: conflict.response as TResponse,
      };
    }

    return { kind: "in_progress" };
  }

  throw new Error(insertError.message || "Failed to create mobile sync operation.");
}

export async function completeMobileSyncOperation(
  supabase: SupabaseClient,
  userId: string,
  scope: MobileSyncScope,
  operationKey: string,
  response: unknown
) {
  const { error } = await supabase
    .from("mobile_sync_operations")
    .upsert(
      {
        user_id: userId,
        scope,
        operation_key: operationKey,
        status: "completed",
        response,
        last_error: null,
        updated_at: nowIso(),
      },
      {
        onConflict: "user_id,scope,operation_key",
      }
    );

  if (error) {
    throw new Error(error.message || "Failed to complete mobile sync operation.");
  }
}

export async function failMobileSyncOperation(
  supabase: SupabaseClient,
  userId: string,
  scope: MobileSyncScope,
  operationKey: string,
  errorMessage: string
) {
  const { error } = await supabase
    .from("mobile_sync_operations")
    .upsert(
      {
        user_id: userId,
        scope,
        operation_key: operationKey,
        status: "failed",
        response: null,
        last_error: errorMessage,
        updated_at: nowIso(),
      },
      {
        onConflict: "user_id,scope,operation_key",
      }
    );

  if (error) {
    throw new Error(error.message || "Failed to mark mobile sync operation failed.");
  }
}
