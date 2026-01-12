import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      {
        error:
          "Server is missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
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
