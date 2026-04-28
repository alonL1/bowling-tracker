import { formatTenths } from '@/lib/number-format';
import type { FrameDetail, GameDetail, GameListItem, SessionItem } from '@/lib/types';

export type SessionGroup = {
  key: string;
  sessionId: string | null;
  session: SessionItem | null;
  title: string;
  description: string | null;
  dateMonth: string;
  dateDay: string;
  gameCount: number;
  averageLabel: string;
  games: GameListItem[];
  isSessionless: boolean;
};

export type FrameGridCell = {
  frameNumber: number;
  shots: string[];
  running: string;
};

function parseDate(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function sortGamesByPlayedAtAsc<T extends Pick<GameListItem, 'played_at' | 'created_at'>>(games: T[]) {
  return [...games].sort((left, right) => {
    const diff =
      parseDate(left.played_at || left.created_at) - parseDate(right.played_at || right.created_at);
    if (diff !== 0) {
      return diff;
    }
    return left.created_at.localeCompare(right.created_at);
  });
}

function getFirstGameTimestamp(games: Array<Pick<GameListItem, 'played_at' | 'created_at'>>) {
  return games.reduce((earliest, game) => {
    const timestamp = parseDate(game.played_at || game.created_at);
    if (timestamp === 0) {
      return earliest;
    }
    if (earliest === 0 || timestamp < earliest) {
      return timestamp;
    }
    return earliest;
  }, 0);
}

export function formatAverage(scores: number[]) {
  if (scores.length === 0) {
    return '—';
  }

  const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return formatTenths(avg);
}

export function buildSessionGroups(games: GameListItem[]) {
  const grouped = new Map<string, { session: SessionItem | null; games: GameListItem[] }>();
  const sessionless: GameListItem[] = [];

  for (const game of games) {
    if (!game.session_id) {
      sessionless.push(game);
      continue;
    }

    const current = grouped.get(game.session_id);
    if (current) {
      current.games.push(game);
      if (!current.session && game.session) {
        current.session = game.session;
      }
      continue;
    }

    grouped.set(game.session_id, {
      session: game.session ?? null,
      games: [game],
    });
  }

  const orderedSessionRecords = [...grouped.entries()]
    .map(([sessionId, value]) => ({
      sessionId,
      session: value.session ?? ({ id: sessionId } as SessionItem),
      games: value.games,
      createdAtTs: parseDate(value.session?.created_at),
      firstGameTs: getFirstGameTimestamp(value.games),
    }))
    .sort((left, right) => {
      const diff = left.firstGameTs - right.firstGameTs;
      if (diff !== 0) {
        return diff;
      }
      const createdAtDiff = left.createdAtTs - right.createdAtTs;
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      const startedAtDiff = parseDate(left.session.started_at) - parseDate(right.session.started_at);
      if (startedAtDiff !== 0) {
        return startedAtDiff;
      }
      return left.sessionId.localeCompare(right.sessionId);
    });

  const sessionNumberById = new Map<string, number>();
  orderedSessionRecords.forEach((record, index) => {
    sessionNumberById.set(record.sessionId, index + 1);
  });

  const displaySessionRecords = [...orderedSessionRecords].sort((left, right) => {
    const diff = right.firstGameTs - left.firstGameTs;
    if (diff !== 0) {
      return diff;
    }
    const createdAtDiff = right.createdAtTs - left.createdAtTs;
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }
    const startedAtDiff = parseDate(right.session.started_at) - parseDate(left.session.started_at);
    if (startedAtDiff !== 0) {
      return startedAtDiff;
    }
    return right.sessionId.localeCompare(left.sessionId);
  });

  const gameTitleMap = new Map<string, string>();

  const groups: SessionGroup[] = displaySessionRecords.map((record) => {
    const orderedGames = sortGamesByPlayedAtAsc(record.games);
    orderedGames.forEach((game, index) => {
      gameTitleMap.set(game.id, game.game_name?.trim() || `Game ${index + 1}`);
    });

    const firstGame = orderedGames[0];
    const firstDateSource =
      firstGame?.played_at || firstGame?.created_at || record.session.started_at || null;
    const firstDate = firstDateSource ? new Date(firstDateSource) : null;
    const scores = orderedGames
      .map((game) => game.total_score)
      .filter((score): score is number => typeof score === 'number');

    return {
      key: record.sessionId,
      sessionId: record.sessionId,
      session: record.session,
      title:
        record.session.name?.trim() ||
        `Session ${sessionNumberById.get(record.sessionId) ?? ''}`.trim(),
      description: record.session.description?.trim() || null,
      dateMonth: firstDate
        ? firstDate.toLocaleDateString('en-US', { month: 'short' })
        : '--',
      dateDay: firstDate ? firstDate.toLocaleDateString('en-US', { day: 'numeric' }) : '--',
      gameCount: orderedGames.length,
      averageLabel: formatAverage(scores),
      games: orderedGames,
      isSessionless: false,
    };
  });

  if (sessionless.length > 0) {
    const orderedGames = sortGamesByPlayedAtAsc(sessionless);
    orderedGames.forEach((game, index) => {
      gameTitleMap.set(game.id, game.game_name?.trim() || `Game ${index + 1}`);
    });
    const firstGame = orderedGames[0];
    const firstDateSource = firstGame?.played_at || firstGame?.created_at || null;
    const firstDate = firstDateSource ? new Date(firstDateSource) : null;
    const scores = orderedGames
      .map((game) => game.total_score)
      .filter((score): score is number => typeof score === 'number');

    groups.push({
      key: 'sessionless',
      sessionId: null,
      session: null,
      title: 'Sessionless games',
      description: 'These games were not given a session.',
      dateMonth: firstDate
        ? firstDate.toLocaleDateString('en-US', { month: 'short' })
        : '--',
      dateDay: firstDate ? firstDate.toLocaleDateString('en-US', { day: 'numeric' }) : '--',
      gameCount: orderedGames.length,
      averageLabel: formatAverage(scores),
      games: orderedGames,
      isSessionless: true,
    });
  }

  return {
    groups,
    gameTitleMap,
    sessionNumberById,
  };
}

function toSymbol(pins: number | null) {
  if (pins === null || pins === undefined) {
    return '';
  }
  if (pins === 10) {
    return 'X';
  }
  if (pins === 0) {
    return '-';
  }
  return String(pins);
}

function getShotPins(frame: FrameDetail | undefined, shotNumber: number) {
  if (!frame?.shots) {
    return null;
  }
  return frame.shots.find((shot) => shot.shot_number === shotNumber)?.pins ?? null;
}

function getFrameRolls(frame: FrameDetail | undefined, frameNumber: number) {
  const shot1 = getShotPins(frame, 1);
  const shot2 = getShotPins(frame, 2);
  const shot3 = getShotPins(frame, 3);

  if (frameNumber < 10) {
    if (shot1 === 10) {
      return [10];
    }
    return [shot1, shot2];
  }

  return [shot1, shot2, shot3];
}

function collectNextRolls(framesByNumber: Map<number, FrameDetail>, fromFrame: number, needed: number) {
  const rolls: number[] = [];

  for (let frameNumber = fromFrame; frameNumber <= 10; frameNumber += 1) {
    const frame = framesByNumber.get(frameNumber);
    const frameRolls = getFrameRolls(frame, frameNumber);
    for (const roll of frameRolls) {
      if (typeof roll !== 'number') {
        continue;
      }
      rolls.push(roll);
      if (rolls.length === needed) {
        return rolls;
      }
    }
  }

  return null;
}

function computeRunningTotals(framesByNumber: Map<number, FrameDetail>) {
  const frameScores: Array<number | null> = Array(10).fill(null);

  for (let frameNumber = 1; frameNumber <= 10; frameNumber += 1) {
    const frame = framesByNumber.get(frameNumber);
    const shot1 = getShotPins(frame, 1);
    const shot2 = getShotPins(frame, 2);
    const shot3 = getShotPins(frame, 3);

    if (frameNumber < 10) {
      if (shot1 === null || shot1 === undefined) {
        continue;
      }
      if (shot1 === 10) {
        const bonus = collectNextRolls(framesByNumber, frameNumber + 1, 2);
        if (!bonus) {
          continue;
        }
        frameScores[frameNumber - 1] = 10 + bonus[0] + bonus[1];
        continue;
      }
      if (shot2 === null || shot2 === undefined) {
        continue;
      }
      if (shot1 + shot2 === 10) {
        const bonus = collectNextRolls(framesByNumber, frameNumber + 1, 1);
        if (!bonus) {
          continue;
        }
        frameScores[frameNumber - 1] = 10 + bonus[0];
      } else {
        frameScores[frameNumber - 1] = shot1 + shot2;
      }
      continue;
    }

    if (shot1 === null || shot1 === undefined || shot2 === null || shot2 === undefined) {
      continue;
    }
    if (shot1 === 10 || shot1 + shot2 === 10) {
      if (shot3 === null || shot3 === undefined) {
        continue;
      }
      frameScores[frameNumber - 1] = shot1 + shot2 + shot3;
    } else {
      frameScores[frameNumber - 1] = shot1 + shot2;
    }
  }

  const running: Array<number | null> = Array(10).fill(null);
  let cumulative = 0;
  let blocked = false;

  for (let index = 0; index < frameScores.length; index += 1) {
    if (blocked || frameScores[index] === null) {
      blocked = true;
      running[index] = null;
      continue;
    }
    cumulative += frameScores[index] ?? 0;
    running[index] = cumulative;
  }

  return running;
}

export function buildFrameGrid(game: GameDetail): FrameGridCell[] {
  const framesByNumber = new Map<number, FrameDetail>();
  (game.frames ?? []).forEach((frame) => {
    framesByNumber.set(frame.frame_number, frame);
  });

  const fallbackRunning = computeRunningTotals(framesByNumber);

  return Array.from({ length: 10 }, (_, index) => {
    const frameNumber = index + 1;
    const frame = framesByNumber.get(frameNumber);
    const shot1 = getShotPins(frame, 1);
    const shot2 = getShotPins(frame, 2);
    const shot3 = getShotPins(frame, 3);
    let shots: string[] = [];

    if (frameNumber < 10) {
      if (shot1 === 10) {
        shots = ['', 'X'];
      } else {
        const first = toSymbol(shot1);
        const second = shot1 !== null && shot2 !== null && shot1 + shot2 === 10 ? '/' : toSymbol(shot2);
        shots = [first, second];
      }
    } else {
      const first = shot1 === 10 ? 'X' : toSymbol(shot1);
      const second =
        shot1 !== null && shot1 !== 10 && shot2 !== null && shot1 + shot2 === 10
          ? '/'
          : shot2 === 10
            ? 'X'
            : toSymbol(shot2);
      const third =
        shot3 === null || shot3 === undefined
          ? ''
          : shot3 === 10
            ? 'X'
            : toSymbol(shot3);
      shots = [first, second, third];
    }

    const runningValue =
      typeof frame?.frame_score === 'number' ? frame.frame_score : fallbackRunning[frameNumber - 1];

    return {
      frameNumber,
      shots,
      running: typeof runningValue === 'number' ? String(runningValue) : '',
    };
  });
}
