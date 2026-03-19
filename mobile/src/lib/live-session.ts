import { formatAverage } from '@/lib/bowling';
import type {
  GameListItem,
  LiveExtraction,
  LiveFrame,
  LivePlayer,
  LiveSessionGame,
  LiveSessionStats,
  RecordingDraftGame,
} from '@/lib/types';

export type ResolvedLivePlayer = LivePlayer & {
  playerKey: string;
};

export type LivePlayerComparisonMetric =
  | 'games'
  | 'average'
  | 'bestScore'
  | 'bestSeries'
  | 'strikes'
  | 'bestFrame'
  | 'worstFrame'
  | 'strikeRate'
  | 'spareConversionRate'
  | 'nines';

export type LivePlayerComparisonRow = {
  playerKey: string;
  label: string;
  games: number;
  average: number | null;
  bestScore: number | null;
  bestSeries: number | null;
  strikes: number;
  bestFrame: number | null;
  bestFrameLabel: string;
  worstFrame: number | null;
  worstFrameLabel: string;
  strikeRate: number | null;
  spareConversionRate: number | null;
  nines: number;
};

function toNullableNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function clampPins(value: number | null, maxPins: number) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.max(0, Math.min(10, Math.trunc(value)));
  return Math.min(rounded, Math.max(0, maxPins));
}

export function normalizePlayerKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function canonicalizePlayerLabel(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeLiveFrameShots(
  frameNumber: number,
  shots: Array<number | null | undefined>,
): [number | null, number | null, number | null] {
  const shot1 = clampPins(toNullableNumber(shots[0]), 10);
  const shot2Raw = toNullableNumber(shots[1]);
  const shot3Raw = toNullableNumber(shots[2]);

  if (frameNumber < 10) {
    if (shot1 === 10) {
      return [10, null, null];
    }
    const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
    return [shot1, shot2, null];
  }

  if (shot1 === 10) {
    const shot2 = clampPins(shot2Raw, 10);
    const shot3 = clampPins(shot3Raw, shot2 !== null && shot2 < 10 ? 10 - shot2 : 10);
    return [shot1, shot2, shot3];
  }

  const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
  const canHaveThird =
    shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10;
  const shot3 = canHaveThird ? clampPins(shot3Raw, 10) : null;
  return [shot1, shot2, shot3];
}

export function normalizeLivePlayers(extraction?: LiveExtraction | null): ResolvedLivePlayer[] {
  const rawPlayers = Array.isArray(extraction?.players) ? extraction?.players ?? [] : [];

  const normalizedPlayers = rawPlayers
    .map((player, playerIndex) => {
      const playerName = player.playerName?.trim() || `Player ${playerIndex + 1}`;
      const frameMap = new Map<number, LiveFrame>();

      (Array.isArray(player.frames) ? player.frames : []).forEach((frame, frameIndex) => {
        const frameNumber =
          typeof frame?.frame === 'number' && Number.isFinite(frame.frame)
            ? Math.max(1, Math.min(10, Math.trunc(frame.frame)))
            : frameIndex + 1;
        frameMap.set(frameNumber, frame);
      });

      const frames: LiveFrame[] = Array.from({ length: 10 }, (_, index) => {
        const frameNumber = index + 1;
        const frame = frameMap.get(frameNumber);
        return {
          frame: frameNumber,
          shots: normalizeLiveFrameShots(
            frameNumber,
            Array.isArray(frame?.shots) ? frame.shots : [],
          ),
        };
      });

      return {
        playerName,
        playerKey: normalizePlayerKey(playerName),
        totalScore: toNullableNumber(player.totalScore) ?? computeTotalScore(frames),
        frames,
      };
    })
    .filter((player) => player.playerName.trim().length > 0);

  const duplicateCounts = new Map<string, number>();
  return normalizedPlayers.map((player) => {
    const baseKey = normalizePlayerKey(player.playerName);
    const nextCount = (duplicateCounts.get(baseKey) ?? 0) + 1;
    duplicateCounts.set(baseKey, nextCount);
    if (nextCount === 1) {
      return player;
    }

    const playerName = `${player.playerName}(${nextCount})`;
    return {
      ...player,
      playerName,
      playerKey: normalizePlayerKey(playerName),
    };
  });
}

function getRollsForFrame(frame: LiveFrame) {
  if (frame.frame < 10) {
    if (frame.shots[0] === 10) {
      return [10];
    }
    return [frame.shots[0], frame.shots[1]];
  }
  return [frame.shots[0], frame.shots[1], frame.shots[2]];
}

function collectNextRolls(frames: LiveFrame[], fromFrame: number, needed: number) {
  const rolls: number[] = [];

  for (let frameNumber = fromFrame; frameNumber <= 10; frameNumber += 1) {
    const frame = frames.find((entry) => entry.frame === frameNumber);
    if (!frame) {
      continue;
    }
    for (const roll of getRollsForFrame(frame)) {
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

export function computeFrameScores(frames: LiveFrame[]) {
  return Array.from({ length: 10 }, (_, index) => {
    const frameNumber = index + 1;
    const frame = frames.find((entry) => entry.frame === frameNumber);
    if (!frame) {
      return null;
    }

    const [shot1, shot2, shot3] = frame.shots;

    if (frameNumber < 10) {
      if (shot1 === null) {
        return null;
      }
      if (shot1 === 10) {
        const bonus = collectNextRolls(frames, frameNumber + 1, 2);
        if (!bonus) {
          return null;
        }
        return 10 + bonus[0] + bonus[1];
      }
      if (shot2 === null) {
        return null;
      }
      if (shot1 + shot2 === 10) {
        const bonus = collectNextRolls(frames, frameNumber + 1, 1);
        if (!bonus) {
          return null;
        }
        return 10 + bonus[0];
      }
      return shot1 + shot2;
    }

    if (shot1 === null || shot2 === null) {
      return null;
    }
    if (shot1 === 10 || shot1 + shot2 === 10) {
      if (shot3 === null) {
        return null;
      }
      return shot1 + shot2 + shot3;
    }
    return shot1 + shot2;
  });
}

export function computeTotalScore(frames: LiveFrame[]) {
  const frameScores = computeFrameScores(frames);
  if (frameScores.some((score) => score === null)) {
    return null;
  }
  return frameScores.reduce<number>((sum, score) => sum + (score as number), 0);
}

function isStrikeFrame(frame: LiveFrame) {
  return frame.shots[0] === 10;
}

function isSpareFrame(frame: LiveFrame) {
  return (
    frame.shots[0] !== null &&
    frame.shots[1] !== null &&
    frame.shots[0] !== 10 &&
    frame.shots[0] + frame.shots[1] === 10
  );
}

function isSpareOpportunity(frame: LiveFrame) {
  return frame.shots[0] !== null && frame.shots[0] < 10 && frame.shots[1] !== null;
}

function formatPercentLabel(numerator: number, denominator: number) {
  if (!denominator) {
    return '—';
  }
  const value = (numerator / denominator) * 100;
  const formatted = value.toFixed(1);
  return `${formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted}%`;
}

function formatFrameAverageLabel(frameNumber: number, averageScore: number) {
  const formatted = averageScore.toFixed(1);
  return `Frame ${frameNumber} (${formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted})`;
}

function countNines(frames: LiveFrame[]) {
  return frames.reduce((count, frame) => {
    const [shot1, shot2] = frame.shots;
    if (shot1 === null || shot2 === null || shot1 === 10) {
      return count;
    }
    return shot1 + shot2 === 9 ? count + 1 : count;
  }, 0);
}

function computeBestSeries(scores: number[]) {
  if (scores.length < 3) {
    return null;
  }

  let bestSeries: number | null = null;
  for (let index = 0; index <= scores.length - 3; index += 1) {
    const series = scores[index] + scores[index + 1] + scores[index + 2];
    if (bestSeries === null || series > bestSeries) {
      bestSeries = series;
    }
  }

  return bestSeries;
}

export type ScoreboardGameLike =
  | Pick<LiveSessionGame, 'extraction'>
  | Pick<RecordingDraftGame, 'extraction'>;

export function getResolvedPlayersForGame(game: ScoreboardGameLike) {
  return normalizeLivePlayers(game.extraction);
}

export function getSelectedPlayersForGame(
  game: ScoreboardGameLike,
  selectedPlayerKeys: string[],
) {
  const selectedKeySet = new Set(selectedPlayerKeys);
  return getResolvedPlayersForGame(game).filter((player) => selectedKeySet.has(player.playerKey));
}

export function getSelectedPlayerCountForGame(
  game: ScoreboardGameLike,
  selectedPlayerKeys: string[],
) {
  const selectedKeySet = new Set(selectedPlayerKeys);
  return normalizeLivePlayers(game.extraction).filter((player) => selectedKeySet.has(player.playerKey))
    .length;
}

export function getFirstSelectionValidationError(
  games: ScoreboardGameLike[],
  selectedPlayerKeys: string[],
) {
  for (let index = 0; index < games.length; index += 1) {
    const selectedCount = getSelectedPlayerCountForGame(games[index], selectedPlayerKeys);
    if (selectedCount === 1) {
      continue;
    }

    if (selectedCount === 0) {
      return `Game ${index + 1} does not have a player selected as yourself. Choose exactly one name before continuing.`;
    }

    return `Game ${index + 1} has 2 or more players selected as yourself. If you really want both those scores logged as 'you' then you can add the same game again and select the other name.`;
  }

  return null;
}

export function getLiveGameScoreLabel(game: ScoreboardGameLike, selectedPlayerKeys: string[]) {
  const selectedPlayers = getSelectedPlayersForGame(game, selectedPlayerKeys);
  if (selectedPlayers.length === 0) {
    return 'Select player(s)';
  }

  return selectedPlayers
    .map((player) => (typeof player.totalScore === 'number' ? String(player.totalScore) : '—'))
    .join(', ');
}

export function buildProjectedLoggedGameCount(
  games: LiveSessionGame[],
  selectedPlayerKeys: string[],
) {
  return games.reduce((count, game) => {
    return count + (getSelectedPlayerCountForGame(game, selectedPlayerKeys) === 1 ? 1 : 0);
  }, 0);
}

export function buildLiveSessionStats(
  games: LiveSessionGame[],
  selectedPlayerKeys: string[],
): LiveSessionStats {
  const selectedKeySet = new Set(selectedPlayerKeys);
  const scores: number[] = [];
  const perPlayerScores = new Map<string, number[]>();
  let completedFrames = 0;
  let gameCount = 0;
  let strikes = 0;
  let spareOpportunities = 0;
  let spareConversions = 0;
  let nines = 0;
  const frameBuckets = new Map<number, number[]>();

  games.forEach((game) => {
    getResolvedPlayersForGame(game)
      .filter((player) => selectedKeySet.has(player.playerKey))
      .forEach((player) => {
        gameCount += 1;
        if (typeof player.totalScore === 'number') {
          scores.push(player.totalScore);
          const currentScores = perPlayerScores.get(player.playerKey);
          if (currentScores) {
            currentScores.push(player.totalScore);
          } else {
            perPlayerScores.set(player.playerKey, [player.totalScore]);
          }
        }

        const frameScores = computeFrameScores(player.frames);
        nines += countNines(player.frames);
        player.frames.forEach((frame, index) => {
          const frameScore = frameScores[index];
          if (frameScore === null) {
            return;
          }

          completedFrames += 1;
          if (isStrikeFrame(frame)) {
            strikes += 1;
          }
          if (isSpareOpportunity(frame)) {
            spareOpportunities += 1;
            if (isSpareFrame(frame)) {
              spareConversions += 1;
            }
          }

          const current = frameBuckets.get(frame.frame);
          if (current) {
            current.push(frameScore);
          } else {
            frameBuckets.set(frame.frame, [frameScore]);
          }
        });
      });
  });

  const frameAverages = Array.from(frameBuckets.entries())
    .map(([frameNumber, values]) => ({
      frameNumber,
      averageScore: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .filter((entry) => Number.isFinite(entry.averageScore));

  const bestFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
    (best, current) => {
      if (!best || current.averageScore > best.averageScore) {
        return current;
      }
      return best;
    },
    null,
  );

  const worstFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
    (worst, current) => {
      if (!worst || current.averageScore < worst.averageScore) {
        return current;
      }
      return worst;
    },
    null,
  );

  const bestScore = scores.length ? Math.max(...scores) : null;
  const bestSeries = Array.from(perPlayerScores.values()).reduce<number | null>((best, playerScores) => {
    const playerBestSeries = computeBestSeries(playerScores);
    if (playerBestSeries === null) {
      return best;
    }
    if (best === null || playerBestSeries > best) {
      return playerBestSeries;
    }
    return best;
  }, null);

  return {
    gameCountLabel: String(gameCount),
    averageLabel: formatAverage(scores),
    bestScoreLabel: bestScore === null ? '—' : String(bestScore),
    bestSeriesLabel: bestSeries === null ? '—' : String(bestSeries),
    strikesLabel: String(strikes),
    ninesLabel: String(nines),
    strikeRateLabel: formatPercentLabel(strikes, completedFrames),
    spareConversionRateLabel: formatPercentLabel(spareConversions, spareOpportunities),
    bestFrameLabel: bestFrame
      ? formatFrameAverageLabel(bestFrame.frameNumber, bestFrame.averageScore)
      : '—',
    worstFrameLabel: worstFrame
      ? formatFrameAverageLabel(worstFrame.frameNumber, worstFrame.averageScore)
      : '—',
  };
}

export function getLiveSessionTitle(name: string | null | undefined, sessionNumber: number) {
  const trimmed = name?.trim();
  return trimmed ? trimmed : `Session ${sessionNumber}`;
}

function formatShotSymbol(pins: number | null) {
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

export function formatFrameCell(frame: LiveFrame) {
  const [shot1, shot2, shot3] = frame.shots;

  if (frame.frame < 10) {
    if (shot1 === 10) {
      return 'X';
    }
    const first = formatShotSymbol(shot1);
    const second =
      shot1 !== null && shot2 !== null && shot1 < 10 && shot1 + shot2 === 10
        ? '/'
        : formatShotSymbol(shot2);
    return `${first} ${second}`.trim() || '—';
  }

  const parts = [
    shot1 === 10 ? 'X' : formatShotSymbol(shot1),
    shot1 === 10 && shot2 === 10
      ? 'X'
      : shot1 !== null && shot2 !== null && shot1 < 10 && shot1 + shot2 === 10
        ? '/'
        : formatShotSymbol(shot2),
    shot3 === 10 ? 'X' : formatShotSymbol(shot3),
  ].filter(Boolean);

  return parts.join(' ') || '—';
}

export function getLiveSessionDescription(description: string | null | undefined) {
  const trimmed = description?.trim();
  return trimmed ? trimmed : 'Edit to rename and add a description';
}

export function buildLivePlayerComparisons(games: ScoreboardGameLike[]): LivePlayerComparisonRow[] {
  const playerBuckets = new Map<
    string,
    {
      label: string;
      games: number;
      scores: number[];
      frameBuckets: Map<number, number[]>;
      completedFrames: number;
      strikes: number;
      spareOpportunities: number;
      spareConversions: number;
      nines: number;
    }
  >();

  games.forEach((game) => {
    getResolvedPlayersForGame(game).forEach((player) => {
      const existing = playerBuckets.get(player.playerKey) ?? {
        label: canonicalizePlayerLabel(player.playerName),
        games: 0,
        scores: [],
        frameBuckets: new Map<number, number[]>(),
        completedFrames: 0,
        strikes: 0,
        spareOpportunities: 0,
        spareConversions: 0,
        nines: 0,
      };

      existing.games += 1;
      if (typeof player.totalScore === 'number') {
        existing.scores.push(player.totalScore);
      }

      const frameScores = computeFrameScores(player.frames);
      existing.nines += countNines(player.frames);

      player.frames.forEach((frame, index) => {
        const frameScore = frameScores[index];
        if (frameScore === null) {
          return;
        }

        const frameBucket = existing.frameBuckets.get(frame.frame);
        if (frameBucket) {
          frameBucket.push(frameScore);
        } else {
          existing.frameBuckets.set(frame.frame, [frameScore]);
        }

        existing.completedFrames += 1;
        if (isStrikeFrame(frame)) {
          existing.strikes += 1;
        }
        if (isSpareOpportunity(frame)) {
          existing.spareOpportunities += 1;
          if (isSpareFrame(frame)) {
            existing.spareConversions += 1;
          }
        }
      });

      playerBuckets.set(player.playerKey, existing);
    });
  });

  return Array.from(playerBuckets.entries())
    .map(([playerKey, bucket]) => {
      const scoreTotal = bucket.scores.reduce((sum, score) => sum + score, 0);
      const frameAverages = Array.from(bucket.frameBuckets.entries())
        .map(([frameNumber, values]) => ({
          frameNumber,
          averageScore: values.reduce((sum, value) => sum + value, 0) / values.length,
        }))
        .filter((entry) => Number.isFinite(entry.averageScore));
      const bestFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
        (best, current) => {
          if (!best || current.averageScore > best.averageScore) {
            return current;
          }
          return best;
        },
        null,
      );
      const worstFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
        (worst, current) => {
          if (!worst || current.averageScore < worst.averageScore) {
            return current;
          }
          return worst;
        },
        null,
      );
      return {
        playerKey,
        label: bucket.label,
        games: bucket.games,
        average: bucket.scores.length ? scoreTotal / bucket.scores.length : null,
        bestScore: bucket.scores.length ? Math.max(...bucket.scores) : null,
        bestSeries: computeBestSeries(bucket.scores),
        strikes: bucket.strikes,
        bestFrame: bestFrame?.averageScore ?? null,
        bestFrameLabel: bestFrame
          ? formatFrameAverageLabel(bestFrame.frameNumber, bestFrame.averageScore)
          : '—',
        worstFrame: worstFrame?.averageScore ?? null,
        worstFrameLabel: worstFrame
          ? formatFrameAverageLabel(worstFrame.frameNumber, worstFrame.averageScore)
          : '—',
        strikeRate: bucket.completedFrames ? (bucket.strikes / bucket.completedFrames) * 100 : null,
        spareConversionRate: bucket.spareOpportunities
          ? (bucket.spareConversions / bucket.spareOpportunities) * 100
          : null,
        nines: bucket.nines,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

type LoggedGameLike = Pick<
  GameListItem,
  'player_name' | 'scoreboard_extraction' | 'selected_self_player_key'
>;

export function buildLoggedSessionStats(games: LoggedGameLike[]): LiveSessionStats {
  const scores: number[] = [];
  const perPlayerScores = new Map<string, number[]>();
  let completedFrames = 0;
  let gameCount = 0;
  let strikes = 0;
  let spareOpportunities = 0;
  let spareConversions = 0;
  let nines = 0;
  const frameBuckets = new Map<number, number[]>();

  games.forEach((game) => {
    const selectedKey =
      typeof game.selected_self_player_key === 'string' && game.selected_self_player_key.trim()
        ? game.selected_self_player_key.trim()
        : normalizePlayerKey(game.player_name);
    const player = getResolvedPlayersForGame({ extraction: game.scoreboard_extraction }).find(
      (entry) => entry.playerKey === selectedKey,
    );

    if (!player) {
      return;
    }

    gameCount += 1;
    if (typeof player.totalScore === 'number') {
      scores.push(player.totalScore);
      const currentScores = perPlayerScores.get(player.playerKey);
      if (currentScores) {
        currentScores.push(player.totalScore);
      } else {
        perPlayerScores.set(player.playerKey, [player.totalScore]);
      }
    }

    const frameScores = computeFrameScores(player.frames);
    nines += countNines(player.frames);
    player.frames.forEach((frame, index) => {
      const frameScore = frameScores[index];
      if (frameScore === null) {
        return;
      }

      completedFrames += 1;
      if (isStrikeFrame(frame)) {
        strikes += 1;
      }
      if (isSpareOpportunity(frame)) {
        spareOpportunities += 1;
        if (isSpareFrame(frame)) {
          spareConversions += 1;
        }
      }

      const current = frameBuckets.get(frame.frame);
      if (current) {
        current.push(frameScore);
      } else {
        frameBuckets.set(frame.frame, [frameScore]);
      }
    });
  });

  const frameAverages = Array.from(frameBuckets.entries())
    .map(([frameNumber, values]) => ({
      frameNumber,
      averageScore: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .filter((entry) => Number.isFinite(entry.averageScore));

  const bestFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
    (best, current) => {
      if (!best || current.averageScore > best.averageScore) {
        return current;
      }
      return best;
    },
    null,
  );

  const worstFrame = frameAverages.reduce<{ frameNumber: number; averageScore: number } | null>(
    (worst, current) => {
      if (!worst || current.averageScore < worst.averageScore) {
        return current;
      }
      return worst;
    },
    null,
  );

  const bestScore = scores.length ? Math.max(...scores) : null;
  const bestSeries = Array.from(perPlayerScores.values()).reduce<number | null>((best, playerScores) => {
    const playerBestSeries = computeBestSeries(playerScores);
    if (playerBestSeries === null) {
      return best;
    }
    if (best === null || playerBestSeries > best) {
      return playerBestSeries;
    }
    return best;
  }, null);

  return {
    gameCountLabel: String(gameCount),
    averageLabel: formatAverage(scores),
    bestScoreLabel: bestScore === null ? '—' : String(bestScore),
    bestSeriesLabel: bestSeries === null ? '—' : String(bestSeries),
    strikesLabel: String(strikes),
    ninesLabel: String(nines),
    strikeRateLabel: formatPercentLabel(strikes, completedFrames),
    spareConversionRateLabel: formatPercentLabel(spareConversions, spareOpportunities),
    bestFrameLabel: bestFrame
      ? formatFrameAverageLabel(bestFrame.frameNumber, bestFrame.averageScore)
      : '—',
    worstFrameLabel: worstFrame
      ? formatFrameAverageLabel(worstFrame.frameNumber, worstFrame.averageScore)
      : '—',
  };
}
