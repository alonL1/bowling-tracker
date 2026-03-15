import { formatAverage } from '@/lib/bowling';
import type { LiveExtraction, LiveFrame, LivePlayer, LiveSessionGame, LiveSessionStats } from '@/lib/types';

export type ResolvedLivePlayer = LivePlayer & {
  playerKey: string;
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

  return rawPlayers
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

export function getResolvedPlayersForGame(game: LiveSessionGame) {
  return normalizeLivePlayers(game.extraction);
}

export function getSelectedPlayersForGame(game: LiveSessionGame, selectedPlayerKeys: string[]) {
  const selectedKeySet = new Set(selectedPlayerKeys);
  return getResolvedPlayersForGame(game).filter((player) => selectedKeySet.has(player.playerKey));
}

export function getLiveGameScoreLabel(game: LiveSessionGame, selectedPlayerKeys: string[]) {
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
  const selectedKeySet = new Set(selectedPlayerKeys);
  return games.reduce((count, game) => {
    return (
      count +
      getResolvedPlayersForGame(game).filter((player) => selectedKeySet.has(player.playerKey)).length
    );
  }, 0);
}

export function buildLiveSessionStats(
  games: LiveSessionGame[],
  selectedPlayerKeys: string[],
): LiveSessionStats {
  const selectedKeySet = new Set(selectedPlayerKeys);
  const scores: number[] = [];
  let completedFrames = 0;
  let strikes = 0;
  let spares = 0;
  let spareOpportunities = 0;
  let spareConversions = 0;
  const frameBuckets = new Map<number, number[]>();

  games.forEach((game) => {
    getResolvedPlayersForGame(game)
      .filter((player) => selectedKeySet.has(player.playerKey))
      .forEach((player) => {
        if (typeof player.totalScore === 'number') {
          scores.push(player.totalScore);
        }

        const frameScores = computeFrameScores(player.frames);
        player.frames.forEach((frame, index) => {
          const frameScore = frameScores[index];
          if (frameScore === null) {
            return;
          }

          completedFrames += 1;
          if (isStrikeFrame(frame)) {
            strikes += 1;
          }
          if (isSpareFrame(frame)) {
            spares += 1;
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

  return {
    averageLabel: formatAverage(scores),
    strikeRateLabel: formatPercentLabel(strikes, completedFrames),
    spareRateLabel: formatPercentLabel(spares, completedFrames),
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
    return `${first}${second}`.trim() || '—';
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
