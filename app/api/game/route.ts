import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ShotUpdate = {
  id?: string | null;
  shotNumber: number;
  pins: number | null;
};

type FrameUpdate = {
  frameId: string;
  frameNumber: number;
  shots: ShotUpdate[];
};

function isValidPins(value: number | null) {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 10);
}

function computeStrike(shot1: number | null) {
  return shot1 === 10;
}

function computeSpare(shot1: number | null, shot2: number | null) {
  return shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10;
}

function getShotPins(frame: FrameUpdate, shotNumber: number) {
  return frame.shots.find((shot) => shot.shotNumber === shotNumber)?.pins ?? null;
}

function computeTotalScore(frames: FrameUpdate[]) {
  const frameMap = new Map<number, FrameUpdate>();
  for (const frame of frames) {
    frameMap.set(frame.frameNumber, frame);
  }

  const orderedFrames = Array.from({ length: 10 }, (_, index) =>
    frameMap.get(index + 1)
  );
  if (orderedFrames.some((frame) => !frame)) {
    return null;
  }

  const rolls: Array<number | null> = [];
  const frameRollIndex: number[] = [];

  orderedFrames.forEach((frame, index) => {
    if (!frame) {
      return;
    }
    frameRollIndex[index] = rolls.length;
    const shot1 = getShotPins(frame, 1);
    const shot2 = getShotPins(frame, 2);
    const shot3 = getShotPins(frame, 3);

    rolls.push(shot1);
    if (frame.frameNumber < 10) {
      if (shot1 !== 10) {
        rolls.push(shot2);
      }
    } else {
      rolls.push(shot2);
      if (shot3 !== null && shot3 !== undefined) {
        rolls.push(shot3);
      }
    }
  });

  let total = 0;

  for (let frameIndex = 0; frameIndex < 9; frameIndex += 1) {
    const rollIndex = frameRollIndex[frameIndex];
    const shot1 = rolls[rollIndex];
    if (shot1 === null || shot1 === undefined) {
      return null;
    }

    if (shot1 === 10) {
      const bonus1 = rolls[rollIndex + 1];
      const bonus2 = rolls[rollIndex + 2];
      if (
        bonus1 === null ||
        bonus1 === undefined ||
        bonus2 === null ||
        bonus2 === undefined
      ) {
        return null;
      }
      total += 10 + bonus1 + bonus2;
    } else {
      const shot2 = rolls[rollIndex + 1];
      if (shot2 === null || shot2 === undefined) {
        return null;
      }
      if (shot1 + shot2 === 10) {
        const bonus = rolls[rollIndex + 2];
        if (bonus === null || bonus === undefined) {
          return null;
        }
        total += 10 + bonus;
      } else {
        total += shot1 + shot2;
      }
    }
  }

  const tenth = orderedFrames[9];
  if (!tenth) {
    return null;
  }
  const tenthShot1 = getShotPins(tenth, 1);
  const tenthShot2 = getShotPins(tenth, 2);
  if (tenthShot1 === null || tenthShot2 === null) {
    return null;
  }
  total += tenthShot1 + tenthShot2;
  if (tenthShot1 === 10 || tenthShot1 + tenthShot2 === 10) {
    const tenthShot3 = getShotPins(tenth, 3);
    if (tenthShot3 === null || tenthShot3 === undefined) {
      return null;
    }
    total += tenthShot3;
  }

  return total;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const gameIdParam = searchParams.get("gameId");

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  if (!jobId && !gameIdParam) {
    return NextResponse.json(
      { error: "jobId or gameId is required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  let gameId = gameIdParam;
  if (!gameId && jobId) {
    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .select("game_id")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: jobError?.message || "Job not found." },
        { status: 404 }
      );
    }

    gameId = job.game_id;
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select(
      "id,game_name,player_name,total_score,status,played_at,created_at,frames:frames(id,frame_number,is_strike,is_spare,frame_score,shots:shots(id,shot_number,pins))"
    )
    .eq("id", gameId)
    .single();

  if (gameError || !game) {
    return NextResponse.json(
      { error: gameError?.message || "Game not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ game });
}

export async function PATCH(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const payload = (await request.json()) as {
    gameId?: string;
    playedAt?: string | null;
    frames?: FrameUpdate[];
  };

  if (!payload.gameId || !payload.frames) {
    return NextResponse.json(
      { error: "gameId and frames are required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  for (const frame of payload.frames) {
    const shotMap = new Map<number, ShotUpdate>();
    for (const shot of frame.shots) {
      if (!isValidPins(shot.pins)) {
        return NextResponse.json(
          { error: "Pins must be between 0 and 10." },
          { status: 400 }
        );
      }
      shotMap.set(shot.shotNumber, shot);
    }

    const shot1 = shotMap.get(1)?.pins ?? null;
    const shot2 = shotMap.get(2)?.pins ?? null;

    const isStrike = computeStrike(shot1);
    const isSpare = computeSpare(shot1, shot2);

    const { error: frameError } = await supabase
      .from("frames")
      .update({ is_strike: isStrike, is_spare: isSpare })
      .eq("id", frame.frameId);

    if (frameError) {
      return NextResponse.json(
        { error: frameError.message || "Failed to update frame." },
        { status: 500 }
      );
    }

    for (const shot of frame.shots) {
      if (shot.id) {
        const { error: shotError } = await supabase
          .from("shots")
          .update({ pins: shot.pins })
          .eq("id", shot.id);

        if (shotError) {
          return NextResponse.json(
            { error: shotError.message || "Failed to update shot." },
            { status: 500 }
          );
        }
      } else {
        const { error: insertError } = await supabase.from("shots").insert({
          frame_id: frame.frameId,
          shot_number: shot.shotNumber,
          pins: shot.pins
        });

        if (insertError) {
          return NextResponse.json(
            { error: insertError.message || "Failed to insert shot." },
            { status: 500 }
          );
        }
      }
    }
  }

  const updates: {
    total_score?: number | null;
    status?: string;
    played_at?: string;
  } = {};
  if (payload.playedAt) {
    const parsed = new Date(payload.playedAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "playedAt must be a valid datetime." },
        { status: 400 }
      );
    }
    updates.played_at = parsed.toISOString();
  }
  updates.total_score = computeTotalScore(payload.frames);
  updates.status = "reviewed";

  const { error: gameError } = await supabase
    .from("games")
    .update(updates)
    .eq("id", payload.gameId);

  if (gameError) {
    return NextResponse.json(
      { error: gameError.message || "Failed to update game." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
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

  let payload: { gameId?: string } = {};
  try {
    payload = (await request.json()) as { gameId?: string };
  } catch {
    payload = {};
  }

  if (!payload.gameId) {
    return NextResponse.json(
      { error: "gameId is required." },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { error: deleteError } = await supabase
    .from("games")
    .delete()
    .eq("id", payload.gameId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message || "Failed to delete game." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
