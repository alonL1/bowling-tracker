import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  FrameDetail,
  GameDetail,
  GameListItem,
  SessionItem,
  UserProfile,
} from '@/lib/types';

const DATABASE_NAME = 'pinpoint-local-logs.db';
const DATABASE_VERSION = 1;

export const localLogsSupported = true;

type LocalSyncMetaRow = {
  user_id: string;
  logs_cursor: string | null;
  last_success_at: string | null;
  schema_version: number | null;
};

type LocalProfileRow = {
  user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_kind: UserProfile['avatarKind'] | null;
  avatar_preset_id: UserProfile['avatarPresetId'] | null;
  avatar_url: string | null;
  initials: string | null;
  profile_complete: number | null;
  avatar_step_needed: number | null;
  username_suggestion: string | null;
  updated_at: string | null;
};

type LocalGameRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  game_name: string | null;
  player_name: string;
  total_score: number | null;
  status: string;
  played_at: string | null;
  created_at: string;
  updated_at: string | null;
  scoreboard_extraction: string | null;
  selected_self_player_key: string | null;
  selected_self_player_name: string | null;
  session_name: string | null;
  session_description: string | null;
  session_started_at: string | null;
  session_created_at: string | null;
  session_updated_at: string | null;
};

type LocalFrameRow = {
  id: string;
  game_id: string;
  frame_number: number;
  is_strike: number;
  is_spare: number;
  frame_score: number | null;
  updated_at: string | null;
};

type LocalShotRow = {
  id: string;
  frame_id: string;
  shot_number: number;
  pins: number | null;
  updated_at: string | null;
};

export type LocalLogsSyncPayload = {
  nextCursor: string;
  profile?: UserProfile | null;
  sessions?: SessionItem[];
  games?: Array<GameDetail & { session?: SessionItem | null; updated_at?: string | null }>;
  deletedSessions?: string[];
  deletedGames?: string[];
};

let dbPromise: Promise<SQLiteDatabase> | null = null;

function encodeJson(value: unknown) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function decodeJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function openLocalLogsDb() {
  if (!localLogsSupported) {
    throw new Error('Local logs are only stored on mobile.');
  }

  if (!dbPromise) {
    dbPromise = import('expo-sqlite').then(async (SQLite) => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await migrateLocalLogsDb(db);
      return db;
    });
  }

  return dbPromise;
}

async function migrateLocalLogsDb(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS sync_meta (
      user_id TEXT PRIMARY KEY NOT NULL,
      logs_cursor TEXT,
      last_success_at TEXT,
      schema_version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      avatar_kind TEXT,
      avatar_preset_id TEXT,
      avatar_url TEXT,
      initials TEXT,
      profile_complete INTEGER NOT NULL DEFAULT 0,
      avatar_step_needed INTEGER NOT NULL DEFAULT 0,
      username_suggestion TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      started_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      game_name TEXT,
      player_name TEXT NOT NULL,
      total_score INTEGER,
      status TEXT NOT NULL,
      played_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      scoreboard_extraction TEXT,
      selected_self_player_key TEXT,
      selected_self_player_name TEXT
    );

    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY NOT NULL,
      game_id TEXT NOT NULL,
      frame_number INTEGER NOT NULL,
      is_strike INTEGER NOT NULL DEFAULT 0,
      is_spare INTEGER NOT NULL DEFAULT 0,
      frame_score INTEGER,
      updated_at TEXT,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY NOT NULL,
      frame_id TEXT NOT NULL,
      shot_number INTEGER NOT NULL,
      pins INTEGER,
      updated_at TEXT,
      FOREIGN KEY(frame_id) REFERENCES frames(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_local_sessions_user_id
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_local_sessions_started_at
      ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_local_games_user_id
      ON games(user_id);
    CREATE INDEX IF NOT EXISTS idx_local_games_session_id
      ON games(session_id);
    CREATE INDEX IF NOT EXISTS idx_local_games_played_at
      ON games(played_at);
    CREATE INDEX IF NOT EXISTS idx_local_games_created_at
      ON games(created_at);
    CREATE INDEX IF NOT EXISTS idx_local_frames_game_order
      ON frames(game_id, frame_number);
    CREATE INDEX IF NOT EXISTS idx_local_shots_frame_order
      ON shots(frame_id, shot_number);

    PRAGMA user_version = ${DATABASE_VERSION};
  `);
}

function mapProfile(row: LocalProfileRow): UserProfile {
  return {
    userId: row.user_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarKind: row.avatar_kind || 'initials',
    avatarPresetId: row.avatar_preset_id,
    avatarUrl: row.avatar_url,
    initials: row.initials || 'P',
    profileComplete: Boolean(row.profile_complete),
    avatarStepNeeded: Boolean(row.avatar_step_needed),
    usernameSuggestion: row.username_suggestion || row.username,
  };
}

function mapSessionFromGameRow(row: LocalGameRow): SessionItem | null {
  if (!row.session_id) {
    return null;
  }

  return {
    id: row.session_id,
    name: row.session_name,
    description: row.session_description,
    started_at: row.session_started_at,
    created_at: row.session_created_at,
    local_sync: null,
  };
}

function mapGameListRow(row: LocalGameRow): GameListItem {
  return {
    id: row.id,
    game_name: row.game_name,
    player_name: row.player_name,
    total_score: row.total_score,
    status: row.status,
    played_at: row.played_at,
    created_at: row.created_at,
    session_id: row.session_id,
    scoreboard_extraction: decodeJson(row.scoreboard_extraction),
    selected_self_player_key: row.selected_self_player_key,
    selected_self_player_name: row.selected_self_player_name,
    session: mapSessionFromGameRow(row),
    local_sync: null,
  };
}

function mapGameDetail(row: LocalGameRow, frames: LocalFrameRow[], shots: LocalShotRow[]): GameDetail {
  const shotsByFrameId = new Map<string, LocalShotRow[]>();
  shots.forEach((shot) => {
    const current = shotsByFrameId.get(shot.frame_id) ?? [];
    current.push(shot);
    shotsByFrameId.set(shot.frame_id, current);
  });

  return {
    id: row.id,
    game_name: row.game_name,
    player_name: row.player_name,
    total_score: row.total_score,
    status: row.status,
    played_at: row.played_at,
    created_at: row.created_at,
    session_id: row.session_id,
    scoreboard_extraction: decodeJson(row.scoreboard_extraction),
    selected_self_player_key: row.selected_self_player_key,
    selected_self_player_name: row.selected_self_player_name,
    frames: frames.map((frame) => ({
      id: frame.id,
      frame_number: frame.frame_number,
      is_strike: Boolean(frame.is_strike),
      is_spare: Boolean(frame.is_spare),
      frame_score: frame.frame_score,
      shots: (shotsByFrameId.get(frame.id) ?? []).map((shot) => ({
        id: shot.id,
        shot_number: shot.shot_number,
        pins: shot.pins,
      })),
    })),
    local_sync: null,
  };
}

export async function loadLocalSyncMeta(userId: string) {
  if (!localLogsSupported) {
    return null;
  }

  const db = await openLocalLogsDb();
  const rows = await db.getAllAsync<LocalSyncMetaRow>(
    'SELECT user_id, logs_cursor, last_success_at, schema_version FROM sync_meta WHERE user_id = ? LIMIT 1',
    userId,
  );
  return rows[0] ?? null;
}

export async function loadLocalProfile(userId: string) {
  if (!localLogsSupported) {
    return null;
  }

  const db = await openLocalLogsDb();
  const rows = await db.getAllAsync<LocalProfileRow>(
    'SELECT * FROM profiles WHERE user_id = ? LIMIT 1',
    userId,
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function saveLocalProfile(profile: UserProfile) {
  if (!localLogsSupported) {
    return;
  }

  const db = await openLocalLogsDb();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO profiles (
        user_id, username, first_name, last_name, avatar_kind, avatar_preset_id,
        avatar_url, initials, profile_complete, avatar_step_needed, username_suggestion, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    profile.userId,
    profile.username,
    profile.firstName,
    profile.lastName,
    profile.avatarKind,
    profile.avatarPresetId,
    profile.avatarUrl,
    profile.initials,
    profile.profileComplete ? 1 : 0,
    profile.avatarStepNeeded ? 1 : 0,
    profile.usernameSuggestion,
    new Date().toISOString(),
  );
}

export async function loadLocalGames(userId: string) {
  if (!localLogsSupported) {
    return [];
  }

  const db = await openLocalLogsDb();
  const rows = await db.getAllAsync<LocalGameRow>(
    `
      SELECT
        g.*,
        s.name AS session_name,
        s.description AS session_description,
        s.started_at AS session_started_at,
        s.created_at AS session_created_at,
        s.updated_at AS session_updated_at
      FROM games g
      LEFT JOIN sessions s ON s.id = g.session_id AND s.user_id = g.user_id
      WHERE g.user_id = ?
      ORDER BY COALESCE(g.played_at, g.created_at) DESC, g.created_at DESC
    `,
    userId,
  );
  return rows.map(mapGameListRow);
}

export async function loadLocalGame(userId: string, gameId: string) {
  if (!localLogsSupported) {
    return null;
  }

  const db = await openLocalLogsDb();
  const games = await db.getAllAsync<LocalGameRow>(
    `
      SELECT
        g.*,
        s.name AS session_name,
        s.description AS session_description,
        s.started_at AS session_started_at,
        s.created_at AS session_created_at,
        s.updated_at AS session_updated_at
      FROM games g
      LEFT JOIN sessions s ON s.id = g.session_id AND s.user_id = g.user_id
      WHERE g.user_id = ? AND g.id = ?
      LIMIT 1
    `,
    userId,
    gameId,
  );
  const game = games[0];
  if (!game) {
    return null;
  }

  const frames = await db.getAllAsync<LocalFrameRow>(
    'SELECT * FROM frames WHERE game_id = ? ORDER BY frame_number ASC',
    gameId,
  );
  const frameIds = frames.map((frame) => frame.id);
  const shots =
    frameIds.length === 0
      ? []
      : await db.getAllAsync<LocalShotRow>(
          `SELECT * FROM shots WHERE frame_id IN (${frameIds.map(() => '?').join(',')}) ORDER BY shot_number ASC`,
          ...frameIds,
        );

  return mapGameDetail(game, frames, shots);
}

export async function applyLocalLogsSync(userId: string, payload: LocalLogsSyncPayload) {
  if (!localLogsSupported) {
    return;
  }

  const db = await openLocalLogsDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const gameId of payload.deletedGames ?? []) {
      await tx.runAsync('DELETE FROM games WHERE user_id = ? AND id = ?', userId, gameId);
    }

    for (const sessionId of payload.deletedSessions ?? []) {
      await tx.runAsync('DELETE FROM games WHERE user_id = ? AND session_id = ?', userId, sessionId);
      await tx.runAsync('DELETE FROM sessions WHERE user_id = ? AND id = ?', userId, sessionId);
    }

    if (payload.profile) {
      await tx.runAsync(
        `
          INSERT OR REPLACE INTO profiles (
            user_id, username, first_name, last_name, avatar_kind, avatar_preset_id,
            avatar_url, initials, profile_complete, avatar_step_needed, username_suggestion, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        payload.profile.userId,
        payload.profile.username,
        payload.profile.firstName,
        payload.profile.lastName,
        payload.profile.avatarKind,
        payload.profile.avatarPresetId,
        payload.profile.avatarUrl,
        payload.profile.initials,
        payload.profile.profileComplete ? 1 : 0,
        payload.profile.avatarStepNeeded ? 1 : 0,
        payload.profile.usernameSuggestion,
        new Date().toISOString(),
      );
    }

    for (const session of payload.sessions ?? []) {
      await tx.runAsync(
        `
          INSERT OR REPLACE INTO sessions (
            id, user_id, name, description, started_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        session.id,
        userId,
        session.name ?? null,
        session.description ?? null,
        session.started_at ?? null,
        session.created_at ?? null,
        (session as SessionItem & { updated_at?: string | null }).updated_at ?? session.created_at ?? null,
      );
    }

    for (const game of payload.games ?? []) {
      const session = game.session ?? null;
      if (session?.id) {
        await tx.runAsync(
          `
            INSERT OR REPLACE INTO sessions (
              id, user_id, name, description, started_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          session.id,
          userId,
          session.name ?? null,
          session.description ?? null,
          session.started_at ?? null,
          session.created_at ?? null,
          (session as SessionItem & { updated_at?: string | null }).updated_at ?? session.created_at ?? null,
        );
      }

      await tx.runAsync(
        `
          INSERT OR REPLACE INTO games (
            id, user_id, session_id, game_name, player_name, total_score, status,
            played_at, created_at, updated_at, scoreboard_extraction,
            selected_self_player_key, selected_self_player_name
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        game.id,
        userId,
        game.session_id ?? null,
        game.game_name ?? null,
        game.player_name,
        game.total_score ?? null,
        game.status,
        game.played_at ?? null,
        game.created_at ?? new Date().toISOString(),
        game.updated_at ?? game.created_at ?? null,
        encodeJson(game.scoreboard_extraction),
        game.selected_self_player_key ?? null,
        game.selected_self_player_name ?? null,
      );

      await tx.runAsync('DELETE FROM frames WHERE game_id = ?', game.id);

      for (const frame of game.frames ?? []) {
        const frameId = frame.id ?? `${game.id}:frame:${frame.frame_number}`;
        await tx.runAsync(
          `
            INSERT OR REPLACE INTO frames (
              id, game_id, frame_number, is_strike, is_spare, frame_score, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          frameId,
          game.id,
          frame.frame_number,
          frame.is_strike ? 1 : 0,
          frame.is_spare ? 1 : 0,
          frame.frame_score ?? null,
          (frame as FrameDetail & { updated_at?: string | null }).updated_at ?? null,
        );

        for (const shot of frame.shots ?? []) {
          const shotId = shot.id ?? `${frameId}:shot:${shot.shot_number}`;
          await tx.runAsync(
            `
              INSERT OR REPLACE INTO shots (
                id, frame_id, shot_number, pins, updated_at
              )
              VALUES (?, ?, ?, ?, ?)
            `,
            shotId,
            frameId,
            shot.shot_number,
            shot.pins ?? null,
            (shot as { updated_at?: string | null }).updated_at ?? null,
          );
        }
      }
    }

    const lastSuccessAt = new Date().toISOString();
    await tx.runAsync(
      `
        INSERT OR REPLACE INTO sync_meta (
          user_id, logs_cursor, last_success_at, schema_version
        )
        VALUES (?, ?, ?, ?)
      `,
      userId,
      payload.nextCursor,
      lastSuccessAt,
      DATABASE_VERSION,
    );
  });
}

export async function clearLocalLogsForUser(userId: string) {
  if (!localLogsSupported) {
    return;
  }

  const db = await openLocalLogsDb();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM games WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM sessions WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM profiles WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM sync_meta WHERE user_id = ?', userId);
  });
}
