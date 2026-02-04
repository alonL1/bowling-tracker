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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const devUserId = normalizeOptionalUuid(process.env.DEV_USER_ID);

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
  }

  const userId = (await getUserIdFromRequest(request)) || devUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: job, error } = await supabase
    .from("analysis_jobs")
    .select("id,status,last_error,updated_at,game_id")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (error || !job) {
    return NextResponse.json(
      { error: error?.message || "Job not found." },
      { status: 404 }
    );
  }

  const normalizedStatus = job.status === "ready" ? "logged" : job.status;

  return NextResponse.json({
    jobId: job.id,
    status: normalizedStatus,
    lastError: job.last_error,
    updatedAt: job.updated_at,
    gameId: job.game_id
  });
}
