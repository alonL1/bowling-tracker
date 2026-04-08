import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromRequest } from "../../utils/auth";
import { buildPublicProfilesByUserId } from "../../utils/profiles";

export const runtime = "nodejs";

type LeaderboardMetrics = {
  bestGame: number;
  bestAverage: number;
  bestSeries: number;
  bestSession: number;
  mostGames: number;
  mostSessions: number;
  SessionScore: number;
  TotalPoints: number;
  SessionLength: number;
  StrikeRate: number;
  SpareRate: number;
  TotalStrikes: number;
  TotalSpares: number;
  MostNines: number;
};

type MutableMetrics = LeaderboardMetrics & {
  totalScoreSum: number;
  totalScoreCount: number;
  sessionIds: Set<string>;
  totalFrames: number;
};

type SessionAggregate = {
  userId: string;
  sessionId: string;
  total: number;
  count: number;
  gameCount: number;
};

type FrameShot = {
  shot_number: number;
  pins: number | null;
};

type FrameRow = {
  is_strike: boolean;
  is_spare: boolean;
  shots?: FrameShot[] | null;
};

type GameRow = {
  user_id: string | null;
  total_score: number | null;
  session_id: string | null;
  frames?: FrameRow[] | null;
};

function roundToTenths(value: number) {
  return Math.round(value * 10) / 10;
}

function createBlankMetrics(): MutableMetrics {
  return {
    bestGame: 0,
    bestAverage: 0,
    bestSeries: 0,
    bestSession: 0,
    mostGames: 0,
    mostSessions: 0,
    SessionScore: 0,
    TotalPoints: 0,
    SessionLength: 0,
    StrikeRate: 0,
    SpareRate: 0,
    TotalStrikes: 0,
    TotalSpares: 0,
    MostNines: 0,
    totalScoreSum: 0,
    totalScoreCount: 0,
    sessionIds: new Set<string>(),
    totalFrames: 0
  };
}

function computeBestSeries(scores: number[]) {
  if (scores.length < 3) {
    return 0;
  }

  let bestSeries = 0;
  for (let index = 0; index <= scores.length - 3; index += 1) {
    const series = scores[index] + scores[index + 1] + scores[index + 2];
    if (series > bestSeries) {
      bestSeries = series;
    }
  }

  return bestSeries;
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration." },
      { status: 500 }
    );
  }

  const user = await getUserFromRequest(request);
  if (!user.userId || !user.accessToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (user.isGuest) {
    return NextResponse.json(
      { error: "Sign in with an account to view friends leaderboards." },
      { status: 403 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: friends, error: friendsError } = await supabase
    .from("friendships")
    .select("friend_user_id")
    .eq("user_id", user.userId);

  if (friendsError) {
    return NextResponse.json(
      { error: friendsError.message || "Failed to load friends." },
      { status: 500 }
    );
  }

  const participantIds = Array.from(
    new Set([
      user.userId,
      ...(friends || [])
        .map((row) => row.friend_user_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    ])
  );

  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select(
      "user_id,total_score,session_id,frames:frames(is_strike,is_spare,shots:shots(shot_number,pins))"
    )
    .in("user_id", participantIds);

  if (gamesError) {
    return NextResponse.json(
      { error: gamesError.message || "Failed to load game stats." },
      { status: 500 }
    );
  }

  const metricsByUser = new Map<string, MutableMetrics>();
  participantIds.forEach((participantId) => {
    metricsByUser.set(participantId, createBlankMetrics());
  });

  const sessionAggregates = new Map<string, SessionAggregate>();
  const scoresByUserSession = new Map<string, number[]>();

  ((games as GameRow[] | null) || []).forEach((game) => {
    const userId = game.user_id;
    if (!userId) {
      return;
    }

    const metrics = metricsByUser.get(userId) ?? createBlankMetrics();
    metrics.mostGames += 1;

    const score = typeof game.total_score === "number" ? game.total_score : null;
    if (score !== null) {
      metrics.bestGame = Math.max(metrics.bestGame, score);
      metrics.totalScoreSum += score;
      metrics.totalScoreCount += 1;
      metrics.TotalPoints += score;
    }

    const sessionId = typeof game.session_id === "string" ? game.session_id : null;
    if (sessionId) {
      metrics.sessionIds.add(sessionId);
      const key = `${userId}:${sessionId}`;
      const aggregate = sessionAggregates.get(key) ?? {
        userId,
        sessionId,
        total: 0,
        count: 0,
        gameCount: 0
      };
      aggregate.gameCount += 1;
      if (score !== null) {
        aggregate.total += score;
        aggregate.count += 1;
        const scores = scoresByUserSession.get(key) ?? [];
        scores.push(score);
        scoresByUserSession.set(key, scores);
      }
      sessionAggregates.set(key, aggregate);
    }

    const frames = Array.isArray(game.frames) ? game.frames : [];
    frames.forEach((frame) => {
      metrics.totalFrames += 1;
      if (frame.is_strike) {
        metrics.TotalStrikes += 1;
      }
      if (frame.is_spare) {
        metrics.TotalSpares += 1;
      }

      const shots = Array.isArray(frame.shots) ? frame.shots : [];
      const shot1 = shots.find((shot) => shot.shot_number === 1)?.pins;
      const shot2 = shots.find((shot) => shot.shot_number === 2)?.pins;
      if (
        typeof shot1 === "number" &&
        typeof shot2 === "number" &&
        shot1 + shot2 === 9 &&
        !frame.is_spare
      ) {
        metrics.MostNines += 1;
      }
    });

    metricsByUser.set(userId, metrics);
  });

  sessionAggregates.forEach((aggregate) => {
    const metrics = metricsByUser.get(aggregate.userId);
    if (!metrics) {
      return;
    }
    metrics.SessionScore = Math.max(metrics.SessionScore, aggregate.total);
    metrics.SessionLength = Math.max(metrics.SessionLength, aggregate.gameCount);
    if (aggregate.count > 0) {
      const average = aggregate.total / aggregate.count;
      metrics.bestSession = Math.max(metrics.bestSession, average);
    }
  });

  metricsByUser.forEach((metrics, userId) => {
    metrics.mostSessions = metrics.sessionIds.size;
    metrics.bestAverage =
      metrics.totalScoreCount > 0
        ? metrics.totalScoreSum / metrics.totalScoreCount
        : 0;
    metrics.bestSeries = Array.from(scoresByUserSession.entries()).reduce((bestSeries, [key, scores]) => {
      if (!key.startsWith(`${userId}:`)) {
        return bestSeries;
      }
      return Math.max(bestSeries, computeBestSeries(scores));
    }, 0);
    metrics.StrikeRate =
      metrics.totalFrames > 0
        ? (metrics.TotalStrikes / metrics.totalFrames) * 100
        : 0;
    metrics.SpareRate =
      metrics.totalFrames - metrics.TotalStrikes > 0
        ? (metrics.TotalSpares / (metrics.totalFrames - metrics.TotalStrikes)) * 100
        : 0;
  });

  let publicProfiles;
  try {
    publicProfiles = await buildPublicProfilesByUserId(supabase, participantIds);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load participant profiles."
      },
      { status: 500 }
    );
  }

  const participants = participantIds.map((participantId) => {
      const metrics = metricsByUser.get(participantId) ?? createBlankMetrics();
      const publicProfile = publicProfiles.get(participantId);
      const normalizedMetrics: LeaderboardMetrics = {
        bestGame: metrics.bestGame,
        bestAverage: roundToTenths(metrics.bestAverage),
        bestSeries: metrics.bestSeries,
        bestSession: roundToTenths(metrics.bestSession),
        mostGames: metrics.mostGames,
        mostSessions: metrics.mostSessions,
        SessionScore: metrics.SessionScore,
        TotalPoints: metrics.TotalPoints,
        SessionLength: metrics.SessionLength,
        StrikeRate: roundToTenths(metrics.StrikeRate),
        SpareRate: roundToTenths(metrics.SpareRate),
        TotalStrikes: metrics.TotalStrikes,
        TotalSpares: metrics.TotalSpares,
        MostNines: metrics.MostNines
      };

      return {
        userId: participantId,
        username: publicProfile?.username || "bowler",
        avatarKind: publicProfile?.avatarKind || "initials",
        avatarPresetId: publicProfile?.avatarPresetId || null,
        avatarUrl: publicProfile?.avatarUrl || null,
        initials: publicProfile?.initials || "P",
        metrics: normalizedMetrics
      };
    });

  return NextResponse.json({
    selfUserId: user.userId,
    participants
  });
}
