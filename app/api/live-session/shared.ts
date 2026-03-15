type RawLiveFrame = {
  frame?: number | null;
  shots?: Array<number | null>;
};

export type LiveExtraction = {
  players: RawLivePlayer[];
};

export type RawLivePlayer = {
  playerName?: string | null;
  totalScore?: number | null;
  frames?: RawLiveFrame[];
};

export type NormalizedLiveFrame = {
  frame: number;
  shots: [number | null, number | null, number | null];
};

export type NormalizedLivePlayer = {
  playerName: string;
  playerKey: string;
  totalScore: number | null;
  frames: NormalizedLiveFrame[];
};

export function normalizeOptionalTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function normalizePlayerKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function canonicalizePlayerLabel(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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

function toNullableNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

export function normalizeFrameShots(
  frameNumber: number,
  shots: Array<number | null | undefined>
): [number | null, number | null, number | null] {
  const shot1 = clampPins(shots[0] ?? null, 10);
  const shot2Raw = shots[1] ?? null;
  const shot3Raw = shots[2] ?? null;

  if (frameNumber < 10) {
    if (shot1 === 10) {
      return [10, null, null];
    }
    const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
    return [shot1, shot2, null];
  }

  if (shot1 === 10) {
    const shot2 = clampPins(shot2Raw, 10);
    const shot3 = clampPins(
      shot3Raw,
      shot2 !== null && shot2 < 10 ? 10 - shot2 : 10
    );
    return [shot1, shot2, shot3];
  }

  const shot2 = clampPins(shot2Raw, shot1 === null ? 10 : 10 - shot1);
  const canHaveThird =
    shot1 !== null && shot2 !== null && shot1 !== 10 && shot1 + shot2 === 10;
  const shot3 = canHaveThird ? clampPins(shot3Raw, 10) : null;
  return [shot1, shot2, shot3];
}

export function normalizeLivePlayers(players: RawLivePlayer[]) {
  return players
    .map((player, playerIndex) => {
      const nameSource =
        typeof player.playerName === "string" ? player.playerName.trim() : "";
      const playerName =
        nameSource || `Player ${playerIndex + 1}`;
      const playerKey = normalizePlayerKey(playerName);
      const frameMap = new Map<number, RawLiveFrame>();

      (Array.isArray(player.frames) ? player.frames : []).forEach((frame, frameIndex) => {
        const frameNumber =
          typeof frame?.frame === "number" && Number.isFinite(frame.frame)
            ? Math.max(1, Math.min(10, Math.trunc(frame.frame)))
            : frameIndex + 1;
        frameMap.set(frameNumber, frame);
      });

      const frames: NormalizedLiveFrame[] = Array.from({ length: 10 }, (_, index) => {
        const frameNumber = index + 1;
        const frame = frameMap.get(frameNumber);
        return {
          frame: frameNumber,
          shots: normalizeFrameShots(
            frameNumber,
            Array.isArray(frame?.shots) ? frame.shots.map(toNullableNumber) : []
          ),
        };
      });

      return {
        playerName,
        playerKey,
        totalScore: toNullableNumber(player.totalScore) ?? computeTotalScore(frames),
        frames,
      } satisfies NormalizedLivePlayer;
    })
    .filter((player) => player.playerName.trim().length > 0);
}

export function normalizeLiveExtraction(value: unknown) {
  const players = Array.isArray((value as LiveExtraction | null | undefined)?.players)
    ? (((value as LiveExtraction).players ?? []) as RawLivePlayer[])
    : [];
  return {
    players: normalizeLivePlayers(players),
  };
}

function getRollsForFrame(frame: NormalizedLiveFrame) {
  if (frame.frame < 10) {
    if (frame.shots[0] === 10) {
      return [10];
    }
    return [frame.shots[0], frame.shots[1]];
  }
  return [frame.shots[0], frame.shots[1], frame.shots[2]];
}

function collectNextRolls(frames: NormalizedLiveFrame[], fromFrame: number, needed: number) {
  const rolls: number[] = [];

  for (let frameNumber = fromFrame; frameNumber <= 10; frameNumber += 1) {
    const frame = frames.find((entry) => entry.frame === frameNumber);
    if (!frame) {
      continue;
    }
    for (const roll of getRollsForFrame(frame)) {
      if (typeof roll !== "number") {
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

export function computeFrameScores(frames: NormalizedLiveFrame[]) {
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

export function computeTotalScore(frames: NormalizedLiveFrame[]) {
  const frameScores = computeFrameScores(frames);
  if (frameScores.some((score) => score === null)) {
    return null;
  }
  return frameScores.reduce<number>((sum, score) => sum + (score as number), 0);
}

export function buildPlayerOptions(
  games: Array<{ extraction?: { players?: RawLivePlayer[] | null } | null }>
) {
  const options: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();

  games.forEach((game) => {
    const normalizedPlayers = normalizeLivePlayers(
      Array.isArray(game.extraction?.players) ? game.extraction?.players ?? [] : []
    );
    normalizedPlayers.forEach((player) => {
      if (seen.has(player.playerKey)) {
        return;
      }
      seen.add(player.playerKey);
      options.push({
        key: player.playerKey,
        label: canonicalizePlayerLabel(player.playerName),
      });
    });
  });

  return options;
}

export function normalizeSelectedPlayerKeys(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? normalizePlayerKey(entry) : ""))
    .filter(Boolean);
}

export function serializeLiveExtraction(players: NormalizedLivePlayer[]): LiveExtraction {
  return {
    players: players.map((player) => ({
      playerName: player.playerName,
      totalScore: player.totalScore,
      frames: player.frames.map((frame) => ({
        frame: frame.frame,
        shots: [...frame.shots],
      })),
    })),
  };
}

export function syncSelectedPlayerKeys(
  previousPlayers: NormalizedLivePlayer[],
  nextPlayers: NormalizedLivePlayer[],
  currentSelectedKeys: string[]
) {
  const currentSelectedSet = new Set(normalizeSelectedPlayerKeys(currentSelectedKeys));
  const previousPlayerKeySet = new Set(previousPlayers.map((player) => player.playerKey));
  const mappedKeys = new Set<string>();

  Array.from(currentSelectedSet).forEach((selectedKey) => {
    if (!previousPlayerKeySet.has(selectedKey)) {
      mappedKeys.add(selectedKey);
      return;
    }

    const selectedIndex = previousPlayers.findIndex(
      (player) => player.playerKey === selectedKey
    );
    const replacement =
      selectedIndex >= 0
        ? nextPlayers[selectedIndex]?.playerKey ?? null
        : null;
    if (replacement) {
      mappedKeys.add(replacement);
    }
  });

  nextPlayers.forEach((player) => {
    if (currentSelectedSet.has(player.playerKey)) {
      mappedKeys.add(player.playerKey);
    }
  });

  return Array.from(mappedKeys);
}
