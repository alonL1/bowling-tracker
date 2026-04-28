import type { GameDetail, GameListItem, SessionItem, UserProfile } from '@/lib/types';

export const localLogsSupported = false;

export type LocalLogsSyncPayload = {
  nextCursor: string;
  profile?: UserProfile | null;
  sessions?: SessionItem[];
  games?: Array<GameDetail & { session?: SessionItem | null; updated_at?: string | null }>;
  deletedSessions?: string[];
  deletedGames?: string[];
};

export type LocalLogsSyncMeta = {
  user_id: string;
  logs_cursor: string | null;
  last_success_at: string | null;
  schema_version: number | null;
};

export async function loadLocalSyncMeta(_userId: string): Promise<LocalLogsSyncMeta | null> {
  return null;
}

export async function loadLocalProfile(_userId: string) {
  return null;
}

export async function saveLocalProfile(_profile: UserProfile) {
  // Web keeps the existing React Query/browser cache behavior.
}

export async function loadLocalGames(_userId: string): Promise<GameListItem[]> {
  return [];
}

export async function loadLocalGame(_userId: string, _gameId: string): Promise<GameDetail | null> {
  return null;
}

export async function applyLocalLogsSync(
  _userId: string,
  _payload: LocalLogsSyncPayload,
) {
  // SQLite local logs are mobile-only.
}

export async function clearLocalLogsForUser(_userId: string) {
  // SQLite local logs are mobile-only.
}
