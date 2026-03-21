type SessionRow = {
  id: string;
  name: string | null;
  description: string | null;
  started_at: string | null;
  created_at: string | null;
};

type GameRow = {
  id: string;
  session_id: string | null;
  total_score: number | null;
  played_at: string | null;
  created_at: string;
};

export type SessionSummary = {
  id: string;
  title: string;
  dateMonth: string;
  dateDay: string;
  gameCount: number;
  averageLabel: string;
};

function parseDate(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function formatAverage(scores: number[]) {
  if (scores.length === 0) {
    return '—';
  }

  const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return formatTenths(avg);
}

export function buildSessionSummaries(
  sessions: SessionRow[],
  games: GameRow[],
): SessionSummary[] {
  const gamesBySessionId = new Map<string, GameRow[]>();

  for (const game of games) {
    if (!game.session_id) {
      continue;
    }

    const existing = gamesBySessionId.get(game.session_id);
    if (existing) {
      existing.push(game);
      continue;
    }

    gamesBySessionId.set(game.session_id, [game]);
  }

  const sessionsWithGames = sessions.filter((session) => {
    return (gamesBySessionId.get(session.id)?.length ?? 0) > 0;
  });

  const sortAscending = [...sessionsWithGames].sort((a, b) => {
    const diff = parseDate(a.created_at) - parseDate(b.created_at);
    if (diff !== 0) {
      return diff;
    }
    return a.id.localeCompare(b.id);
  });

  const sessionNumberById = new Map<string, number>();
  sortAscending.forEach((session, index) => {
    sessionNumberById.set(session.id, index + 1);
  });

  const displaySessions = [...sessionsWithGames].sort((a, b) => {
    const diff = parseDate(b.created_at) - parseDate(a.created_at);
    if (diff !== 0) {
      return diff;
    }
    return b.id.localeCompare(a.id);
  });

  return displaySessions.map((session) => {
    const sessionGames = [...(gamesBySessionId.get(session.id) ?? [])].sort((a, b) => {
      return parseDate(a.played_at || a.created_at) - parseDate(b.played_at || b.created_at);
    });

    const firstGame = sessionGames[0];
    const firstDateSource = session.started_at || firstGame?.played_at || firstGame?.created_at;
    const firstDate = firstDateSource ? new Date(firstDateSource) : null;
    const scores = sessionGames
      .map((game) => game.total_score)
      .filter((score): score is number => typeof score === 'number');

    return {
      id: session.id,
      title: session.name?.trim() || `Session ${sessionNumberById.get(session.id) ?? ''}`.trim(),
      dateMonth: firstDate
        ? firstDate.toLocaleDateString('en-US', { month: 'short' })
        : '--',
      dateDay: firstDate ? firstDate.toLocaleDateString('en-US', { day: 'numeric' }) : '--',
      gameCount: sessionGames.length,
      averageLabel: formatAverage(scores),
    };
  });
}
import { formatTenths } from '@/lib/number-format';
