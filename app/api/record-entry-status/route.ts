import { NextResponse } from "next/server";

import { getActiveLiveSessionRecord, getLiveUserId, getServerSupabase } from "../live-session/server";
import {
  getActiveRecordingDraftRecord,
} from "../recording-draft/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const userId = await getLiveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const [liveSession, uploadDraft, multipleDraft, existingDraft] = await Promise.all([
      getActiveLiveSessionRecord(supabase, userId),
      getActiveRecordingDraftRecord(userId, "upload_session"),
      getActiveRecordingDraftRecord(userId, "add_multiple_sessions"),
      getActiveRecordingDraftRecord(userId, "add_existing_session"),
    ]);

    return NextResponse.json({
      status: {
        liveSession: Boolean(liveSession?.id),
        uploadSessionDraft: Boolean(uploadDraft?.id),
        addMultipleSessionsDraft: Boolean(multipleDraft?.id),
        addExistingSessionDraft: Boolean(existingDraft?.id),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load record entry status.",
      },
      { status: 500 }
    );
  }
}
