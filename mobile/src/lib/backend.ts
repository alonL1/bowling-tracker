import { Platform } from 'react-native';

import { apiFetch, apiJson, parseJsonResponse } from '@/lib/api';
import { cacheOfflineChatGames, loadOfflineChatGames } from '@/lib/offline-chat';
import { buildLegacyUsernameFallback, getProfileInitials } from '@/lib/profile';
import {
  loadUploadsProcessingStore,
  mergeGamesWithUploadsProcessing,
  mergeLiveSessionWithUploadsProcessing,
  mergeRecordingDraftWithUploadsProcessing,
  mergeRecordEntryStatusWithUploadsProcessing,
  mergeSessionsWithUploadsProcessing,
} from '@/lib/uploads-processing-store';
import type {
  AvatarPresetId,
  GameDetail,
  GameListItem,
  InviteLinkResponse,
  InviteLookupResponse,
  LeaderboardRow,
  LivePlayer,
  LiveSessionCaptureResponse,
  LiveSessionEndResponse,
  LiveSessionResponse,
  MobileLogsSyncResponse,
  RecordingDraftMode,
  RecordingDraftResponse,
  RecordEntryStatusResponse,
  SessionItem,
  UserProfile,
} from '@/lib/types';

function normalizeLeaderboardParticipant(
  row: Partial<LeaderboardRow> & {
    userId: string;
    displayName?: string;
    metrics: LeaderboardRow['metrics'];
  },
): LeaderboardRow {
  const username = buildLegacyUsernameFallback({
    username: row.username,
    displayName: row.displayName,
    userId: row.userId,
  });

  return {
    userId: row.userId,
    username,
    displayName: row.displayName || username,
    avatarKind: row.avatarKind || 'initials',
    avatarPresetId: row.avatarPresetId ?? null,
    avatarUrl: row.avatarUrl ?? null,
    initials:
      row.initials ||
      getProfileInitials({
        username,
        initials: row.displayName || null,
      }),
    metrics: row.metrics,
  };
}

function normalizeInviteLookupPayload(payload: InviteLookupResponse): InviteLookupResponse {
  if (!payload.inviter) {
    return payload;
  }

  const username = buildLegacyUsernameFallback({
    username: payload.inviter.username,
    displayName: payload.inviter.displayName,
    userId: payload.inviter.userId,
  });

  return {
    ...payload,
    inviter: {
      ...payload.inviter,
      username,
      displayName: payload.inviter.displayName || username,
      avatarKind: payload.inviter.avatarKind || 'initials',
      avatarPresetId: payload.inviter.avatarPresetId ?? null,
      avatarUrl: payload.inviter.avatarUrl ?? null,
      initials:
        payload.inviter.initials ||
        getProfileInitials({
          username,
          initials: payload.inviter.displayName || null,
        }),
    },
  };
}

export const queryKeys = {
  games: ['games'] as const,
  game: (gameId: string) => ['game', gameId] as const,
  sessions: ['sessions'] as const,
  liveSession: ['live-session'] as const,
  recordEntryStatus: ['record-entry-status'] as const,
  recordingDraft: (mode: RecordingDraftMode) => ['recording-draft', mode] as const,
  leaderboard: ['leaderboard'] as const,
  inviteLookup: (token: string) => ['invite-lookup', token] as const,
  profile: ['profile'] as const,
};

function isNetworkFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /network request failed/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /fetch failed/i.test(message) ||
    /networkerror/i.test(message) ||
    /unable to resolve host/i.test(message) ||
    /internet connection/i.test(message)
  );
}

export async function fetchGames() {
  try {
    const payload = await apiJson<{ games: GameListItem[]; count: number | null }>('/api/games');
    const store = await loadUploadsProcessingStore();
    const games = mergeGamesWithUploadsProcessing(payload.games, store);
    void cacheOfflineChatGames(games);
    return {
      ...payload,
      games,
    };
  } catch (error) {
    if (!isNetworkFetchError(error)) {
      throw error;
    }

    const cachedGames = await loadOfflineChatGames();
    if (cachedGames.length === 0) {
      throw error;
    }

    return {
      games: cachedGames,
      count: cachedGames.length,
    };
  }
}

export async function fetchGameById(gameId: string) {
  return apiJson<{ game: GameDetail }>(`/api/game?gameId=${encodeURIComponent(gameId)}`);
}

export async function fetchGameFromJobId(jobId: string) {
  return apiJson<{ game: GameDetail }>(`/api/game?jobId=${encodeURIComponent(jobId)}`);
}

export async function fetchSessions() {
  const payload = await apiJson<{ sessions: SessionItem[] }>('/api/sessions');
  const store = await loadUploadsProcessingStore();
  return {
    ...payload,
    sessions: mergeSessionsWithUploadsProcessing(payload.sessions, store),
  };
}

export async function createSession(name = '', description = '') {
  return apiJson<{ session: SessionItem }>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
}

export async function updateSession(
  sessionId: string,
  name: string,
  description: string,
  gameSelections?: Array<{ gameId: string; selectedSelfPlayerKey: string }>,
) {
  return apiJson<{ session: SessionItem }>('/api/session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, name, description, gameSelections }),
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
  players?: LivePlayer[];
  frames?: Array<{
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
  const payload = await apiJson<{
    selfUserId: string;
    participants: Array<
      Partial<LeaderboardRow> & {
        userId: string;
        displayName?: string;
        metrics: LeaderboardRow['metrics'];
      }
    >;
  }>('/api/friends/leaderboard');

  return {
    ...payload,
    participants: (payload.participants || []).map(normalizeLeaderboardParticipant),
  };
}

export async function fetchOwnProfile(accessToken?: string | null) {
  return apiJson<{ profile: UserProfile }>('/api/account/profile', {
    accessToken,
  });
}

export async function fetchMobileLogsSync(since?: string | null, accessToken?: string | null) {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return apiJson<MobileLogsSyncResponse>(`/api/mobile-sync/logs${query}`, {
    accessToken,
  });
}

export async function checkUsernameAvailability(username: string) {
  return apiJson<{ available: boolean; username: string }>(
    `/api/account/profile/username?username=${encodeURIComponent(username)}`,
    { authRequired: false },
  );
}

export async function updateOwnProfile(payload: {
  username: string;
  firstName: string;
  lastName?: string | null;
  completeAvatarOnboarding?: boolean;
}) {
  return apiJson<{ profile: UserProfile }>('/api/account/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function setOwnProfileAvatarPreset(presetId: AvatarPresetId) {
  return apiJson<{ profile: UserProfile }>('/api/account/profile/avatar/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presetId }),
  });
}

export async function removeOwnProfileAvatar() {
  return apiJson<{ profile: UserProfile }>('/api/account/profile/avatar', {
    method: 'DELETE',
  });
}

const MAX_PROFILE_AVATAR_BYTES = 8 * 1024 * 1024;

export async function uploadOwnProfileAvatar(payload: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  webFile?: File | null;
}) {
  if (typeof payload.fileSize === 'number' && payload.fileSize > MAX_PROFILE_AVATAR_BYTES) {
    throw new Error('Profile pictures must be 8 MB or smaller.');
  }

  const formData = new FormData();

  if (Platform.OS === 'web') {
    if (payload.webFile) {
      formData.append('avatar', payload.webFile);
    } else {
      const response = await fetch(payload.uri);
      const blob = await response.blob();
      formData.append('avatar', blob, payload.fileName ?? 'avatar.jpg');
    }
  } else {
    formData.append('avatar', {
      uri: payload.uri,
      name: payload.fileName ?? 'avatar.jpg',
      type: payload.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }

  const response = await apiFetch('/api/account/profile/avatar/upload', {
    method: 'POST',
    body: formData,
  });
  const result = await parseJsonResponse<{ profile: UserProfile; error?: string }>(response);
  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return result;
}

export async function deleteOwnAccount() {
  return apiJson<{
    ok: boolean;
    deleted: boolean;
    counts: Record<string, number>;
  }>('/api/account/delete', {
    method: 'DELETE',
  });
}

export async function deleteOwnData() {
  return apiJson<{
    ok: boolean;
    deleted: boolean;
    counts: Record<string, number>;
  }>('/api/account/data', {
    method: 'DELETE',
  });
}

export async function createInvite() {
  return apiJson<InviteLinkResponse>('/api/friends/invite', {
    method: 'POST',
  });
}

export async function lookupInvite(token: string) {
  const payload = await apiJson<InviteLookupResponse>(
    `/api/friends/invite/${encodeURIComponent(token)}`,
    { authRequired: false },
  );
  return normalizeInviteLookupPayload(payload);
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

export async function fetchLiveSession() {
  const payload = await apiJson<LiveSessionResponse>('/api/live-session');
  const store = await loadUploadsProcessingStore();
  return mergeLiveSessionWithUploadsProcessing(payload, store);
}

export async function discardLiveSession() {
  return apiJson<{ ok: boolean; discarded: boolean }>('/api/live-session', {
    method: 'DELETE',
  });
}

export async function fetchRecordEntryStatus() {
  const payload = await apiJson<RecordEntryStatusResponse>('/api/record-entry-status');
  const store = await loadUploadsProcessingStore();
  return {
    ...payload,
    status: mergeRecordEntryStatusWithUploadsProcessing(payload.status, store),
  };
}

export async function fetchRecordingDraft(mode: RecordingDraftMode) {
  const payload = await apiJson<RecordingDraftResponse>(
    `/api/recording-draft?mode=${encodeURIComponent(mode)}`,
  );
  const store = await loadUploadsProcessingStore();
  return mergeRecordingDraftWithUploadsProcessing(payload, store, mode);
}

export async function updateRecordingDraft(payload: {
  mode: RecordingDraftMode;
  selectedPlayerKeys?: string[];
  targetSessionId?: string | null;
  name?: string | null;
  description?: string | null;
}) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function discardRecordingDraft(mode: RecordingDraftMode) {
  return apiJson<RecordingDraftResponse | { ok: boolean; discarded: boolean }>(
    `/api/recording-draft?mode=${encodeURIComponent(mode)}`,
    {
    method: 'DELETE',
    },
  );
}

export async function uploadToRecordingDraft(payload: {
  mode: RecordingDraftMode;
  timezoneOffsetMinutes: number;
  storageItems: Array<
    SubmitStorageItem & {
      clientCaptureId?: string;
      localDraftId?: string;
      localGroupId?: string | null;
    }
  >;
}) {
  return apiJson<
    RecordingDraftResponse & {
      createdGames?: Array<{
        clientCaptureId?: string | null;
        draftId: string;
        groupId?: string | null;
        draftGameId: string;
        captureOrder: number;
      }>;
    }
  >('/api/recording-draft/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateRecordingDraftGroup(payload: {
  mode: RecordingDraftMode;
  groupId: string;
  name?: string | null;
  description?: string | null;
}) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft/group', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteRecordingDraftGroup(payload: {
  mode: RecordingDraftMode;
  groupId: string;
}) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft/group', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function reorderRecordingDraftGame(payload: {
  mode: RecordingDraftMode;
  gameId: string;
  targetGroupId?: string | null;
  beforeGameId?: string | null;
  afterGameId?: string | null;
}) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateRecordingDraftGame(payload: {
  mode: RecordingDraftMode;
  draftGameId: string;
  players: LivePlayer[];
  capturedAt?: string | null;
}) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft/game', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteRecordingDraftGame(mode: RecordingDraftMode, draftGameId: string) {
  return apiJson<RecordingDraftResponse>('/api/recording-draft/game', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, draftGameId }),
  });
}

export async function finalizeRecordingDraft(payload: {
  mode: RecordingDraftMode;
  targetSessionId?: string | null;
  name?: string | null;
  description?: string | null;
  clientOperationId?: string;
}) {
  return apiJson<{
    ok: boolean;
    createdGameIds: string[];
    createdSessionIds: string[];
    primarySessionId: string | null;
  }>('/api/recording-draft/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateLiveSession(payload: {
  selectedPlayerKeys?: string[];
  name?: string;
  description?: string;
}, options?: { signal?: AbortSignal }) {
  return apiJson<LiveSessionResponse>('/api/live-session', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
}

export async function queueLiveSessionCapture(payload: {
  storageKey: string;
  capturedAtHint?: string | null;
  timezoneOffsetMinutes: number;
  name?: string;
  description?: string;
  clientCaptureId?: string;
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

export async function endLiveSession(
  clientOperationId?: string,
  options?: { signal?: AbortSignal },
) {
  return apiJson<LiveSessionEndResponse>('/api/live-session/end', {
    method: 'POST',
    headers: clientOperationId ? { 'Content-Type': 'application/json' } : undefined,
    body: clientOperationId ? JSON.stringify({ clientOperationId }) : undefined,
    signal: options?.signal,
  });
}
