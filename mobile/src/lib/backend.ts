import { apiJson } from '@/lib/api';
import type {
  GameDetail,
  GameListItem,
  InviteLinkResponse,
  InviteLookupResponse,
  LeaderboardRow,
  LivePlayer,
  LiveSessionCaptureResponse,
  LiveSessionEndResponse,
  LiveSessionResponse,
  SessionItem,
  SessionMode,
  StatusResponse,
} from '@/lib/types';

export const queryKeys = {
  games: ['games'] as const,
  game: (gameId: string) => ['game', gameId] as const,
  sessions: ['sessions'] as const,
  liveSession: ['live-session'] as const,
  leaderboard: ['leaderboard'] as const,
  inviteLookup: (token: string) => ['invite-lookup', token] as const,
};

export async function fetchGames() {
  return apiJson<{ games: GameListItem[]; count: number | null }>('/api/games');
}

export async function fetchGameById(gameId: string) {
  return apiJson<{ game: GameDetail }>(`/api/game?gameId=${encodeURIComponent(gameId)}`);
}

export async function fetchGameFromJobId(jobId: string) {
  return apiJson<{ game: GameDetail }>(`/api/game?jobId=${encodeURIComponent(jobId)}`);
}

export async function fetchSessions() {
  return apiJson<{ sessions: SessionItem[] }>('/api/sessions');
}

export async function createSession(name = '', description = '') {
  return apiJson<{ session: SessionItem }>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

export async function updateSession(sessionId: string, name: string, description: string) {
  return apiJson<{ session: SessionItem }>('/api/session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, name, description }),
  });
}

export async function deleteSession(sessionId: string, mode: 'sessionless' | 'delete_games') {
  return apiJson<{ ok: boolean }>('/api/session', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, mode }),
  });
}

export async function moveGameToSession(gameId: string, sessionId: string | null) {
  return apiJson<{ ok: boolean }>('/api/game/session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, sessionId }),
  });
}

export async function deleteGame(gameId: string) {
  return apiJson<{ ok: boolean }>('/api/game', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId }),
  });
}

export type GameUpdatePayload = {
  gameId: string;
  playedAt?: string | null;
  frames: Array<{
    frameId?: string | null;
    frameNumber: number;
    shots: Array<{
      id?: string | null;
      shotNumber: number;
      pins: number | null;
    }>;
  }>;
};

export async function updateGame(payload: GameUpdatePayload) {
  return apiJson<{ ok: boolean }>('/api/game', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export type ChatResponse = {
  answer?: string;
  meta?: string;
  onlineError?: string;
  offlineAnswer?: string;
  offlineMeta?: string;
  offlineNote?: string;
};

export async function sendChat(question: string, gameId?: string | null) {
  return apiJson<ChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      gameId,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    }),
  });
}

export async function fetchLeaderboard() {
  return apiJson<{ selfUserId: string; participants: LeaderboardRow[] }>('/api/friends/leaderboard');
}

export async function createInvite() {
  return apiJson<InviteLinkResponse>('/api/friends/invite', {
    method: 'POST',
  });
}

export async function lookupInvite(token: string) {
  return apiJson<InviteLookupResponse>(`/api/friends/invite/${encodeURIComponent(token)}`);
}

export async function acceptInvite(token: string) {
  return apiJson<{ ok: boolean; alreadyFriends?: boolean }>(
    `/api/friends/invite/${encodeURIComponent(token)}/accept`,
    {
      method: 'POST',
    },
  );
}

export async function claimGuest(guestAccessToken: string, action: 'check' | 'move' = 'move') {
  return apiJson<{
    ok: boolean;
    check?: { sessions?: number; games?: number; jobs?: number; total?: number };
    moved?: { sessions?: number; games?: number; jobs?: number };
  }>('/api/auth/claim-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestAccessToken, action }),
  });
}

export type SubmitStorageItem = {
  storageKey: string;
  capturedAtHint?: string;
  fileSizeBytes?: number;
  autoGroupIndex?: number;
};

export async function submitGames(payload: {
  playerName: string;
  timezoneOffsetMinutes: string;
  sessionMode: SessionMode;
  existingSessionId?: string;
  storageItems: SubmitStorageItem[];
}) {
  return apiJson<{
    jobs: Array<{ jobId: string; status: string; message: string }>;
    sessionId?: string | null;
    sessionIds?: string[];
  }>('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchStatus(jobId: string) {
  return apiJson<StatusResponse>(`/api/status?jobId=${encodeURIComponent(jobId)}`);
}

export async function fetchLiveSession() {
  return apiJson<LiveSessionResponse>('/api/live-session');
}

export async function updateLiveSession(payload: {
  selectedPlayerKeys?: string[];
  name?: string;
  description?: string;
}) {
  return apiJson<LiveSessionResponse>('/api/live-session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function queueLiveSessionCapture(payload: {
  storageKey: string;
  capturedAtHint?: string | null;
  timezoneOffsetMinutes: number;
  name?: string;
  description?: string;
}) {
  return apiJson<LiveSessionCaptureResponse>('/api/live-session/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateLiveSessionGame(payload: {
  liveGameId: string;
  players: LivePlayer[];
  capturedAt?: string | null;
}) {
  return apiJson<{ ok: boolean }>('/api/live-session/game', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteLiveSessionGame(liveGameId: string) {
  return apiJson<{ ok: boolean; deletedSession?: boolean }>('/api/live-session/game', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ liveGameId }),
  });
}

export async function endLiveSession() {
  return apiJson<LiveSessionEndResponse>('/api/live-session/end', {
    method: 'POST',
  });
}
