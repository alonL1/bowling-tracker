import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';

import {
  canonicalizePlayerLabel,
  getResolvedPlayersForGame,
  normalizePlayerKey,
} from '@/lib/live-session';
import { sanitizeFilename } from '@/lib/upload';
import type {
  GameListItem,
  LiveSession,
  LiveSessionGame,
  LiveSessionResponse,
  LocalSyncMetadata,
  LocalSyncSourceFlow,
  RecordingDraft,
  RecordingDraftGame,
  RecordingDraftGroup,
  RecordingDraftMode,
  RecordingDraftResponse,
  RecordEntryStatus,
  SessionItem,
} from '@/lib/types';

export const UPLOADS_PROCESSING_STORAGE_KEY = 'pinpoint-uploads-processing-v1';
const UPLOADS_PROCESSING_DIRECTORY_NAME = 'uploads-processing';
const STORE_VERSION = 1;
const BASE_RETRY_DELAY_MS = 4_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export type UploadsProcessingCaptureState =
  | 'captured_local'
  | 'upload_pending'
  | 'uploaded'
  | 'server_row_pending'
  | 'processing_pending'
  | 'ready_pending_finalize'
  | 'finalize_pending'
  | 'synced'
  | 'failed'
  | 'discarded';

export type UploadsProcessingFinalizeState =
  | 'pending'
  | 'waiting_on_captures'
  | 'ready_to_finalize'
  | 'finalize_pending'
  | 'synced'
  | 'failed'
  | 'discarded';

export type UploadsProcessingFlow = LocalSyncSourceFlow;

export type UploadsProcessingLiveSessionState =
  | 'active'
  | 'finalize_pending'
  | 'synced'
  | 'failed'
  | 'discarded';

export type UploadsProcessingDraftState =
  | 'active'
  | 'finalize_pending'
  | 'synced'
  | 'failed'
  | 'discarded';

export type UploadsProcessingDraftGroup = {
  id: string;
  displayOrder: number;
  name?: string | null;
  description?: string | null;
};

export type UploadsProcessingLiveSessionEntry = {
  id: string;
  sourceFlow: 'live_session';
  createdAt: string;
  updatedAt: string;
  name?: string | null;
  description?: string | null;
  selectedPlayerKeys: string[];
  nextSessionNumber?: number | null;
  serverSessionId?: string | null;
  serverLiveSessionId?: string | null;
  state: UploadsProcessingLiveSessionState;
  lastError?: string | null;
};

export type UploadsProcessingDraftEntry = {
  id: string;
  sourceFlow: RecordingDraftMode;
  createdAt: string;
  updatedAt: string;
  mode: RecordingDraftMode;
  name?: string | null;
  description?: string | null;
  selectedPlayerKeys: string[];
  targetSessionId?: string | null;
  targetSessionName?: string | null;
  groups: UploadsProcessingDraftGroup[];
  serverDraftId?: string | null;
  state: UploadsProcessingDraftState;
  lastError?: string | null;
};

export type UploadsProcessingCaptureItem = {
  id: string;
  sourceFlow: UploadsProcessingFlow;
  createdAt: string;
  updatedAt: string;
  localFileUri: string;
  localFileName: string;
  mimeType: string;
  fileSizeBytes?: number | null;
  capturedAtHint?: string | null;
  status: UploadsProcessingCaptureState;
  retryCount: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  storageKey?: string | null;
  jobId?: string | null;
  extraction?: LiveSessionGame['extraction'] | RecordingDraftGame['extraction'] | null;
  liveSessionId?: string | null;
  liveGameId?: string | null;
  serverSessionId?: string | null;
  serverLiveSessionId?: string | null;
  serverLiveGameId?: string | null;
  recordingDraftId?: string | null;
  recordingDraftGameId?: string | null;
  serverDraftId?: string | null;
  serverDraftGameId?: string | null;
  serverDraftGroupId?: string | null;
  localDraftGroupId?: string | null;
  captureOrder: number;
  autoGroupIndex?: number | null;
  finalizeOperationId?: string | null;
};

export type UploadsProcessingOptimisticSession = {
  id: string;
  sessionId: string | null;
  sourceFlow: UploadsProcessingFlow;
  createdAt: string;
  startedAt?: string | null;
  name?: string | null;
  description?: string | null;
  linkedCaptureItemIds: string[];
  isReadOnlyUntilSynced: boolean;
};

export type UploadsProcessingOptimisticGame = {
  id: string;
  gameId: string;
  sessionId: string | null;
  sourceFlow: UploadsProcessingFlow;
  createdAt: string;
  playedAt?: string | null;
  linkedCaptureItemId: string;
  linkedSessionId?: string | null;
  isReadOnlyUntilSynced: boolean;
  selectedPlayerKey?: string | null;
  selectedPlayerName?: string | null;
};

export type UploadsProcessingFinalizeOperation = {
  id: string;
  sourceFlow: UploadsProcessingFlow;
  createdAt: string;
  updatedAt: string;
  status: UploadsProcessingFinalizeState;
  retryCount: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  liveSessionId?: string | null;
  recordingDraftId?: string | null;
  linkedCaptureItemIds: string[];
  optimisticSessions: UploadsProcessingOptimisticSession[];
  optimisticGames: UploadsProcessingOptimisticGame[];
  serverSessionId?: string | null;
  serverLiveSessionId?: string | null;
  targetSessionId?: string | null;
  targetSessionName?: string | null;
  draftName?: string | null;
  draftDescription?: string | null;
};

export type UploadsProcessingStore = {
  version: number;
  captureItems: UploadsProcessingCaptureItem[];
  liveSessions: UploadsProcessingLiveSessionEntry[];
  drafts: UploadsProcessingDraftEntry[];
  finalizeOperations: UploadsProcessingFinalizeOperation[];
};

export type UploadsProcessingSummary = {
  pendingCount: number;
  failedCount: number;
  captureCount: number;
  finalizeCount: number;
};

export function createEmptyUploadsProcessingStore(): UploadsProcessingStore {
  return {
    version: STORE_VERSION,
    captureItems: [],
    liveSessions: [],
    drafts: [],
    finalizeOperations: [],
  };
}

function sanitizeStorePayload(value: unknown): UploadsProcessingStore {
  if (!value || typeof value !== 'object') {
    return createEmptyUploadsProcessingStore();
  }

  const payload = value as Partial<UploadsProcessingStore>;
  return {
    version: STORE_VERSION,
    captureItems: Array.isArray(payload.captureItems) ? payload.captureItems : [],
    liveSessions: Array.isArray(payload.liveSessions) ? payload.liveSessions : [],
    drafts: Array.isArray(payload.drafts) ? payload.drafts : [],
    finalizeOperations: Array.isArray(payload.finalizeOperations) ? payload.finalizeOperations : [],
  };
}

export async function loadUploadsProcessingStore() {
  try {
    const raw = await AsyncStorage.getItem(UPLOADS_PROCESSING_STORAGE_KEY);
    if (!raw) {
      return createEmptyUploadsProcessingStore();
    }
    return sanitizeStorePayload(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load uploads processing store.', error);
    return createEmptyUploadsProcessingStore();
  }
}

export async function saveUploadsProcessingStore(store: UploadsProcessingStore) {
  try {
    await AsyncStorage.setItem(
      UPLOADS_PROCESSING_STORAGE_KEY,
      JSON.stringify({
        ...store,
        version: STORE_VERSION,
      }),
    );
  } catch (error) {
    console.error('Failed to save uploads processing store.', error);
  }
}

export function createLocalId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function getUploadsProcessingDirectory() {
  return new Directory(Paths.document, UPLOADS_PROCESSING_DIRECTORY_NAME);
}

export function ensureUploadsProcessingDirectory() {
  const directory = getUploadsProcessingDirectory();
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export function deleteLocalUploadsProcessingFile(uri?: string | null) {
  if (!uri) {
    return;
  }

  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn('Failed to delete local uploads-processing file.', error);
  }
}

export function normalizeDateOrNow(value?: string | null) {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

export function getNextRetryAt(retryCount: number) {
  const nextDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * Math.max(1, 2 ** Math.max(0, retryCount)),
  );
  return new Date(Date.now() + nextDelay).toISOString();
}

export function isRetryDue(value?: string | null) {
  if (!value) {
    return true;
  }
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed <= Date.now();
}

export async function persistImageAssetLocally(
  asset: ImagePicker.ImagePickerAsset,
  options: {
    fileNamePrefix: string;
    fallbackIndex: number;
  },
) {
  const directory = ensureUploadsProcessingDirectory();
  const sanitizedFileName = sanitizeFilename(asset.fileName ?? undefined, options.fallbackIndex);
  const destinationFile = new File(
    directory,
    `${options.fileNamePrefix}-${sanitizedFileName}`,
  );
  const sourceFile = new File(asset.uri);
  sourceFile.copy(destinationFile);
  return {
    localFileUri: destinationFile.uri,
    localFileName: destinationFile.name,
  };
}

export function getUploadsProcessingSummary(
  store: UploadsProcessingStore,
): UploadsProcessingSummary {
  const pendingCaptures = store.captureItems.filter(
    (item) =>
      item.status !== 'synced' &&
      item.status !== 'discarded' &&
      item.status !== 'failed',
  ).length;
  const failedCaptures = store.captureItems.filter((item) => item.status === 'failed').length;
  const pendingFinalizations = store.finalizeOperations.filter(
    (item) =>
      item.status !== 'synced' &&
      item.status !== 'discarded' &&
      item.status !== 'failed',
  ).length;
  const failedFinalizations = store.finalizeOperations.filter(
    (item) => item.status === 'failed',
  ).length;

  return {
    pendingCount: pendingCaptures + pendingFinalizations,
    failedCount: failedCaptures + failedFinalizations,
    captureCount: store.captureItems.filter((item) => item.status !== 'discarded').length,
    finalizeCount: store.finalizeOperations.filter((item) => item.status !== 'discarded').length,
  };
}

export function buildUploadsProcessingLocalSync(
  sourceFlow: UploadsProcessingFlow,
  linkedQueueItemIds: string[],
  syncState: 'syncing' | 'failed',
  lastSyncError?: string | null,
  localId?: string | null,
): LocalSyncMetadata {
  return {
    localId: localId ?? null,
    syncState,
    sourceFlow,
    linkedQueueItemIds,
    isReadOnlyUntilSynced: true,
    lastSyncError: lastSyncError ?? null,
  };
}

function getOptimisticSessionError(
  captureItems: UploadsProcessingCaptureItem[],
  operation: UploadsProcessingFinalizeOperation,
) {
  if (operation.lastError) {
    return operation.lastError;
  }

  const failedCapture = captureItems.find(
    (item) =>
      operation.linkedCaptureItemIds.includes(item.id) &&
      item.status === 'failed' &&
      item.lastError,
  );
  return failedCapture?.lastError ?? null;
}

function buildOptimisticSessionItems(
  store: UploadsProcessingStore,
): Map<string, SessionItem> {
  const sessions = new Map<string, SessionItem>();

  store.finalizeOperations.forEach((operation) => {
    if (operation.status === 'discarded' || operation.status === 'synced') {
      return;
    }

    const lastSyncError = getOptimisticSessionError(store.captureItems, operation);
    const syncState = lastSyncError ? 'failed' : 'syncing';

    operation.optimisticSessions.forEach((entry) => {
      if (!entry.sessionId) {
        return;
      }

      sessions.set(entry.sessionId, {
        id: entry.sessionId,
        name: entry.name,
        description: entry.description,
        started_at: entry.startedAt ?? null,
        created_at: entry.createdAt,
        local_sync: buildUploadsProcessingLocalSync(
          entry.sourceFlow,
          entry.linkedCaptureItemIds,
          syncState,
          lastSyncError,
          entry.id,
        ),
      });
    });
  });

  return sessions;
}

function buildOptimisticGameItem(
  optimisticGame: UploadsProcessingOptimisticGame,
  captureItem: UploadsProcessingCaptureItem | undefined,
  optimisticSession: SessionItem | null,
  lastSyncError: string | null,
): GameListItem {
  const resolvedPlayers = captureItem?.extraction
    ? getResolvedPlayersForGame({ extraction: captureItem.extraction })
    : [];
  const preferredPlayer =
    resolvedPlayers.find(
      (player) =>
        optimisticGame.selectedPlayerKey &&
        player.playerKey === optimisticGame.selectedPlayerKey,
    ) ?? resolvedPlayers[0] ?? null;

  const playerName =
    optimisticGame.selectedPlayerName ||
    (preferredPlayer?.playerName
      ? canonicalizePlayerLabel(preferredPlayer.playerName)
      : 'Processing scoreboard');
  const playerKey = optimisticGame.selectedPlayerKey ?? preferredPlayer?.playerKey ?? normalizePlayerKey(playerName);
  const syncState = lastSyncError ? 'failed' : 'syncing';

  return {
    id: optimisticGame.gameId,
    game_name: null,
    player_name: playerName,
    total_score: preferredPlayer?.totalScore ?? null,
    status: syncState,
    played_at: optimisticGame.playedAt ?? captureItem?.capturedAtHint ?? captureItem?.createdAt ?? null,
    created_at: optimisticGame.createdAt,
    session_id: optimisticGame.sessionId,
    scoreboard_extraction: captureItem?.extraction ?? null,
    selected_self_player_key: playerKey,
    selected_self_player_name: playerName,
    session: optimisticSession,
    local_sync: buildUploadsProcessingLocalSync(
      optimisticGame.sourceFlow,
      [optimisticGame.linkedCaptureItemId],
      syncState,
      lastSyncError,
      optimisticGame.id,
    ),
  };
}

function buildOptimisticGames(
  store: UploadsProcessingStore,
): GameListItem[] {
  const optimisticSessions = buildOptimisticSessionItems(store);
  const games: GameListItem[] = [];

  store.finalizeOperations.forEach((operation) => {
    if (operation.status === 'discarded' || operation.status === 'synced') {
      return;
    }

    const lastSyncError = getOptimisticSessionError(store.captureItems, operation);

    operation.optimisticGames.forEach((entry) => {
      const captureItem = store.captureItems.find(
        (item) => item.id === entry.linkedCaptureItemId,
      );
      const optimisticSession =
        (entry.sessionId ? optimisticSessions.get(entry.sessionId) : null) ?? null;
      games.push(buildOptimisticGameItem(entry, captureItem, optimisticSession, lastSyncError));
    });
  });

  return games;
}

function buildLocalOnlyLiveGame(item: UploadsProcessingCaptureItem): LiveSessionGame {
  const status =
    item.status === 'failed'
      ? 'error'
      : item.status === 'ready_pending_finalize' || item.status === 'finalize_pending'
        ? 'ready'
        : item.status === 'processing_pending'
          ? 'processing'
          : 'queued';
  const syncState = item.status === 'failed' ? 'failed' : 'syncing';

  return {
    id: item.liveGameId || `local-live-game-${item.id}`,
    capture_order: item.captureOrder,
    status,
    captured_at_hint: item.capturedAtHint ?? null,
    captured_at: item.capturedAtHint ?? null,
    last_error: item.lastError ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    extraction: item.extraction ?? null,
    local_sync: buildUploadsProcessingLocalSync(
      item.sourceFlow,
      [item.id],
      syncState,
      item.lastError,
      item.id,
    ),
  };
}

function buildLocalOnlyDraftGame(item: UploadsProcessingCaptureItem): RecordingDraftGame {
  const status =
    item.status === 'failed'
      ? 'error'
      : item.status === 'ready_pending_finalize' || item.status === 'finalize_pending'
        ? 'ready'
        : item.status === 'processing_pending'
          ? 'processing'
          : 'queued';
  const syncState = item.status === 'failed' ? 'failed' : 'syncing';

  return {
    id: item.recordingDraftGameId || `local-draft-game-${item.id}`,
    draft_id: item.recordingDraftId || 'local-draft',
    group_id: item.localDraftGroupId ?? null,
    capture_order: item.captureOrder,
    storage_key: item.storageKey ?? item.localFileUri,
    status,
    captured_at_hint: item.capturedAtHint ?? null,
    captured_at: item.capturedAtHint ?? null,
    sort_at: item.capturedAtHint ?? null,
    last_error: item.lastError ?? null,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    extraction: item.extraction ?? null,
    local_sync: buildUploadsProcessingLocalSync(
      item.sourceFlow,
      [item.id],
      syncState,
      item.lastError,
      item.id,
    ),
  };
}

export function mergeGamesWithUploadsProcessing(
  games: GameListItem[],
  store: UploadsProcessingStore,
) {
  const optimisticGames = buildOptimisticGames(store);
  return [...games, ...optimisticGames].sort((left, right) => {
    const leftTime = Date.parse(left.played_at || left.created_at || '');
    const rightTime = Date.parse(right.played_at || right.created_at || '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

export function mergeSessionsWithUploadsProcessing(
  sessions: SessionItem[],
  store: UploadsProcessingStore,
) {
  const optimisticSessions = buildOptimisticSessionItems(store);
  const mergedSessions = sessions.map((session) => {
    const optimisticSession = optimisticSessions.get(session.id);
    if (!optimisticSession) {
      return session;
    }

    return {
      ...session,
      local_sync: optimisticSession.local_sync ?? session.local_sync ?? null,
    };
  });

  const existingSessionIds = new Set(mergedSessions.map((session) => session.id));
  optimisticSessions.forEach((session) => {
    if (!existingSessionIds.has(session.id)) {
      mergedSessions.push(session);
    }
  });

  return mergedSessions.sort((left, right) => {
    const leftTime = Date.parse(left.started_at || left.created_at || "");
    const rightTime = Date.parse(right.started_at || right.created_at || "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return (right.created_at || "").localeCompare(left.created_at || "");
  });
}

export function mergeLiveSessionWithUploadsProcessing(
  payload: LiveSessionResponse,
  store: UploadsProcessingStore,
) {
  const localLiveSession = [...store.liveSessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  if (!localLiveSession) {
    return payload;
  }

  if (localLiveSession.state !== 'active') {
    return {
      ...payload,
      liveSession: null,
    };
  }

  const relevantCaptureItems = store.captureItems
    .filter(
      (item) =>
        item.liveSessionId === localLiveSession.id &&
        item.status !== 'discarded' &&
        item.status !== 'synced',
    )
    .sort((left, right) => left.captureOrder - right.captureOrder);

  const baseLiveSession = payload.liveSession;
  if (!baseLiveSession && relevantCaptureItems.length === 0) {
    return payload;
  }

  const serverGameIdSet = new Set(
    (baseLiveSession?.games ?? []).map((game) => game.id),
  );
  const localOnlyGames = relevantCaptureItems
    .filter((item) => !item.serverLiveGameId || !serverGameIdSet.has(item.serverLiveGameId))
    .map(buildLocalOnlyLiveGame);

  const mergedLiveSession: LiveSession = {
    id: localLiveSession.serverLiveSessionId || localLiveSession.id,
    sessionId: localLiveSession.serverSessionId || baseLiveSession?.sessionId || localLiveSession.id,
    sessionNumber:
      baseLiveSession?.sessionNumber ??
      localLiveSession.nextSessionNumber ??
      1,
    name: localLiveSession.name ?? baseLiveSession?.name ?? null,
    description: localLiveSession.description ?? baseLiveSession?.description ?? null,
    startedAt: baseLiveSession?.startedAt ?? null,
    createdAt: baseLiveSession?.createdAt ?? localLiveSession.createdAt,
    selectedPlayerKeys:
      localLiveSession.selectedPlayerKeys.length > 0
        ? localLiveSession.selectedPlayerKeys
        : (baseLiveSession?.selectedPlayerKeys ?? []),
    playerOptions: baseLiveSession?.playerOptions ?? [],
    games: [...(baseLiveSession?.games ?? []), ...localOnlyGames].sort(
      (left, right) => left.capture_order - right.capture_order,
    ),
    local_sync: buildUploadsProcessingLocalSync(
      'live_session',
      relevantCaptureItems.map((item) => item.id),
      relevantCaptureItems.some((item) => item.status === 'failed') ? 'failed' : 'syncing',
      relevantCaptureItems.find((item) => item.status === 'failed')?.lastError ?? null,
      localLiveSession.id,
    ),
  };

  return {
    ...payload,
    liveSession: mergedLiveSession,
  };
}

function sortDraftGroups(groups: RecordingDraftGroup[]) {
  return [...groups].sort((left, right) => left.display_order - right.display_order);
}

export function mergeRecordingDraftWithUploadsProcessing(
  payload: RecordingDraftResponse,
  store: UploadsProcessingStore,
  mode: RecordingDraftMode,
) {
  const localDraft = [...store.drafts]
    .filter((entry) => entry.mode === mode)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (!localDraft) {
    return payload;
  }

  if (localDraft.state !== 'active') {
    return {
      ...payload,
      draft: null,
    };
  }

  const activeDraft = localDraft;

  const relevantCaptureItems = store.captureItems
    .filter(
      (item) =>
        item.recordingDraftId === activeDraft.id &&
        item.status !== 'discarded' &&
        item.status !== 'synced',
    )
    .sort((left, right) => left.captureOrder - right.captureOrder);

  const baseDraft = payload.draft;
  if (!baseDraft && relevantCaptureItems.length === 0) {
    return payload;
  }

  const groupsById = new Map<string, RecordingDraftGroup>();
  sortDraftGroups(baseDraft?.groups ?? []).forEach((group) => {
    groupsById.set(group.id, {
      ...group,
      games: [...group.games],
    });
  });

  if (!baseDraft?.groups?.length) {
    activeDraft.groups.forEach((group) => {
      groupsById.set(group.id, {
        id: group.id,
        draft_id: activeDraft.serverDraftId || activeDraft.id,
        display_order: group.displayOrder,
        name: group.name ?? null,
        description: group.description ?? null,
        anchor_captured_at: null,
        games: [],
      });
    });
  }

  const existingDraftGameIds = new Set(
    [...groupsById.values()].flatMap((group) => group.games.map((game) => game.id)),
  );

  relevantCaptureItems.forEach((item) => {
    const serverDraftGameId = item.serverDraftGameId;
    if (serverDraftGameId && existingDraftGameIds.has(serverDraftGameId)) {
      return;
    }

    const targetGroupId = item.serverDraftGroupId || item.localDraftGroupId || activeDraft.groups[0]?.id;
    if (!targetGroupId) {
      return;
    }

    const currentGroup = groupsById.get(targetGroupId);
    if (!currentGroup) {
      const fallbackGroupMeta = activeDraft.groups.find((group) => group.id === targetGroupId);
      groupsById.set(targetGroupId, {
        id: targetGroupId,
        draft_id: activeDraft.serverDraftId || activeDraft.id,
        display_order: fallbackGroupMeta?.displayOrder ?? 0,
        name: fallbackGroupMeta?.name ?? null,
        description: fallbackGroupMeta?.description ?? null,
        anchor_captured_at: null,
        games: [buildLocalOnlyDraftGame(item)],
      });
      return;
    }

    currentGroup.games.push(buildLocalOnlyDraftGame(item));
  });

  const mergedGroups = [...groupsById.values()]
    .sort((left, right) => left.display_order - right.display_order)
    .map((group) => ({
      ...group,
      games: [...group.games].sort((left, right) => left.capture_order - right.capture_order),
    }));

  const allGames = mergedGroups.flatMap((group) => group.games);

  const mergedDraft: RecordingDraft = {
    id: activeDraft.serverDraftId || activeDraft.id,
    mode,
    status: 'active',
    selectedPlayerKeys:
      activeDraft.selectedPlayerKeys.length > 0
        ? activeDraft.selectedPlayerKeys
        : (baseDraft?.selectedPlayerKeys ?? []),
    playerOptions: baseDraft?.playerOptions ?? [],
    targetSessionId: activeDraft.targetSessionId ?? baseDraft?.targetSessionId ?? null,
    name: activeDraft.name ?? baseDraft?.name ?? null,
    description: activeDraft.description ?? baseDraft?.description ?? null,
    groups: mergedGroups,
    progress: {
      total: allGames.length,
      queued: allGames.filter((game) => game.status === 'queued').length,
      processing: allGames.filter((game) => game.status === 'processing').length,
      ready: allGames.filter((game) => game.status === 'ready').length,
      error: allGames.filter((game) => game.status === 'error').length,
      completed: allGames.filter((game) => game.status === 'ready' || game.status === 'error')
        .length,
    },
    local_sync: buildUploadsProcessingLocalSync(
      mode,
      relevantCaptureItems.map((item) => item.id),
      relevantCaptureItems.some((item) => item.status === 'failed') ? 'failed' : 'syncing',
      relevantCaptureItems.find((item) => item.status === 'failed')?.lastError ?? null,
      activeDraft.id,
    ),
  };

  return {
    ...payload,
    draft: mergedDraft,
  };
}

export function mergeRecordEntryStatusWithUploadsProcessing(
  status: RecordEntryStatus,
  store: UploadsProcessingStore,
): RecordEntryStatus {
  const activeLiveSession = store.liveSessions.some((entry) => entry.state === 'active');
  const activeUploadDraft = store.drafts.some(
    (entry) => entry.mode === 'upload_session' && entry.state === 'active',
  );
  const activeMultipleDraft = store.drafts.some(
    (entry) => entry.mode === 'add_multiple_sessions' && entry.state === 'active',
  );
  const activeExistingDraft = store.drafts.some(
    (entry) => entry.mode === 'add_existing_session' && entry.state === 'active',
  );

  return {
    liveSession: status.liveSession || activeLiveSession,
    uploadSessionDraft: status.uploadSessionDraft || activeUploadDraft,
    addMultipleSessionsDraft: status.addMultipleSessionsDraft || activeMultipleDraft,
    addExistingSessionDraft: status.addExistingSessionDraft || activeExistingDraft,
  };
}
