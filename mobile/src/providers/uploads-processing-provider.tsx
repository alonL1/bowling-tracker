import type * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import {
  deleteRecordingDraftGame,
  deleteRecordingDraftGroup,
  discardLiveSession as discardLiveSessionRemote,
  discardRecordingDraft as discardRecordingDraftRemote,
  endLiveSession,
  finalizeRecordingDraft,
  queryKeys,
  queueLiveSessionCapture,
  updateLiveSession,
  updateLiveSessionGame,
  updateRecordingDraft,
  updateRecordingDraftGroup,
  updateRecordingDraftGame,
  uploadToRecordingDraft,
} from '@/lib/backend';
import { apiJson } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  buildAutoGroupMap,
  deriveCapturedAtHint,
} from '@/lib/upload';
import {
  createEmptyUploadsProcessingStore,
  createLocalId,
  deleteLocalUploadsProcessingFile,
  getNextRetryAt,
  getUploadsProcessingSummary,
  isRetryDue,
  loadUploadsProcessingStore,
  mergeGamesWithUploadsProcessing,
  mergeLiveSessionWithUploadsProcessing,
  mergeRecordingDraftWithUploadsProcessing,
  mergeRecordEntryStatusWithUploadsProcessing,
  mergeSessionsWithUploadsProcessing,
  persistImageAssetLocally,
  saveUploadsProcessingStore,
  type UploadsProcessingCaptureItem,
  type UploadsProcessingCaptureState,
  type UploadsProcessingDraftEntry,
  type UploadsProcessingDraftGroup,
  type UploadsProcessingFinalizeOperation,
  type UploadsProcessingFinalizeState,
  type UploadsProcessingLiveSessionEntry,
  type UploadsProcessingOptimisticGame,
  type UploadsProcessingOptimisticSession,
  type UploadsProcessingSessionRouteAlias,
  type UploadsProcessingStore,
} from '@/lib/uploads-processing-store';
import {
  canonicalizePlayerLabel,
  getResolvedPlayersForGame,
  normalizePlayerKey,
} from '@/lib/live-session';
import type {
  GameListItem,
  LiveSession,
  LivePlayer,
  LiveSessionResponse,
  RecordingDraft,
  RecordingDraftMode,
  RecordingDraftResponse,
  RecordEntryStatusResponse,
  SessionItem,
} from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

const DEFAULT_BUCKET = 'scoreboards-temp';
const SYNC_INTERVAL_MS = 15_000;
const NEW_SESSION_TARGET = '__new-session__';

type UpdateDraftInput = {
  mode: RecordingDraftMode;
  draftId?: string | null;
  selectedPlayerKeys?: string[];
  targetSessionId?: string | null;
  targetSessionName?: string | null;
  name?: string | null;
  description?: string | null;
};

type UpdateDraftGroupInput = {
  mode: RecordingDraftMode;
  draftGroupId: string;
  name?: string | null;
  description?: string | null;
};

type FinalizeDraftInput = {
  mode: RecordingDraftMode;
  draft: RecordingDraft | null;
  name?: string | null;
  description?: string | null;
  targetSessionId?: string | null;
  targetSessionName?: string | null;
};

type UploadsProcessingContextValue = {
  store: UploadsProcessingStore;
  summary: ReturnType<typeof getUploadsProcessingSummary>;
  ready: boolean;
  enqueueLiveCaptures: (payload: {
    assets: ImagePicker.ImagePickerAsset[];
    liveSession: LiveSession | null;
    nextSessionNumber?: number | null;
    name?: string;
    description?: string;
  }) => Promise<void>;
  updateLiveSessionLocal: (payload: {
    liveSession: LiveSession | null;
    nextSessionNumber?: number | null;
    name?: string;
    description?: string;
    selectedPlayerKeys?: string[];
  }) => void;
  deleteLiveCapture: (visibleGameId: string) => Promise<{
    removed: boolean;
    remoteDeleteRequired: boolean;
  }>;
  discardLiveSessionLocal: (payload: { liveSession: LiveSession | null }) => Promise<boolean>;
  finalizeLiveSessionLocal: (payload: {
    liveSession: LiveSession;
    name?: string;
    description?: string;
  }) => Promise<{ routeSessionId: string }>;
  enqueueDraftCaptures: (payload: {
    mode: RecordingDraftMode;
    draft: RecordingDraft | null;
    assets: ImagePicker.ImagePickerAsset[];
  }) => Promise<void>;
  updateDraftLocal: (payload: UpdateDraftInput) => void;
  updateDraftGroupLocal: (payload: UpdateDraftGroupInput) => void;
  deleteDraftCapture: (payload: {
    mode: RecordingDraftMode;
    visibleGameId: string;
  }) => Promise<{
    removed: boolean;
    remoteDeleteRequired: boolean;
  }>;
  discardDraftLocal: (payload: {
    mode: RecordingDraftMode;
    draft: RecordingDraft | null;
  }) => Promise<boolean>;
  clearDraftLocalState: (payload: {
    mode: RecordingDraftMode;
    draft: RecordingDraft | null;
  }) => Promise<void>;
  finalizeDraftLocal: (payload: FinalizeDraftInput) => Promise<{ routeSessionId: string | null }>;
  retryEntry: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  repairFailedLoggedGame: (payload: {
    game: GameListItem;
    players: LivePlayer[];
  }) => Promise<void>;
  requestSyncNow: () => void;
};

const UploadsProcessingContext = createContext<UploadsProcessingContextValue | null>(null);

function nowIso() {
  return new Date().toISOString();
}

function cloneStore(store: UploadsProcessingStore): UploadsProcessingStore {
  return {
    ...store,
    captureItems: store.captureItems.map((entry) => ({ ...entry })),
    liveSessions: store.liveSessions.map((entry) => ({ ...entry, selectedPlayerKeys: [...entry.selectedPlayerKeys] })),
    drafts: store.drafts.map((entry) => ({
      ...entry,
      selectedPlayerKeys: [...entry.selectedPlayerKeys],
      groups: entry.groups.map((group) => ({ ...group })),
    })),
    finalizeOperations: store.finalizeOperations.map((entry) => ({
      ...entry,
      linkedCaptureItemIds: [...entry.linkedCaptureItemIds],
      optimisticSessions: entry.optimisticSessions.map((session) => ({
        ...session,
        linkedCaptureItemIds: [...session.linkedCaptureItemIds],
      })),
      optimisticGames: entry.optimisticGames.map((game) => ({ ...game })),
    })),
    sessionRouteAliases: store.sessionRouteAliases.map((entry) => ({ ...entry })),
  };
}

function replaceStoreEntity<T extends { id: string }>(items: T[], nextItem: T) {
  const nextItems = [...items];
  const targetIndex = nextItems.findIndex((entry) => entry.id === nextItem.id);
  if (targetIndex >= 0) {
    nextItems[targetIndex] = nextItem;
    return nextItems;
  }
  nextItems.push(nextItem);
  return nextItems;
}

function replaceSessionRouteAlias(
  items: UploadsProcessingSessionRouteAlias[],
  nextItem: UploadsProcessingSessionRouteAlias,
) {
  const nextItems = [...items];
  const targetIndex = nextItems.findIndex((entry) => entry.tempSessionId === nextItem.tempSessionId);
  if (targetIndex >= 0) {
    nextItems[targetIndex] = nextItem;
    return nextItems;
  }
  nextItems.push(nextItem);
  return nextItems;
}

function buildLiveSessionEntry(
  existing: UploadsProcessingLiveSessionEntry | undefined,
  payload: {
    liveSession: LiveSession | null;
    nextSessionNumber?: number | null;
    name?: string;
    description?: string;
    selectedPlayerKeys?: string[];
  },
): UploadsProcessingLiveSessionEntry {
  const currentTime = nowIso();
  return {
    id: existing?.id || createLocalId('live-session'),
    sourceFlow: 'live_session',
    createdAt: existing?.createdAt || currentTime,
    updatedAt: currentTime,
    name:
      payload.name !== undefined
        ? payload.name
        : existing?.name ?? payload.liveSession?.name ?? null,
    description:
      payload.description !== undefined
        ? payload.description
        : existing?.description ?? payload.liveSession?.description ?? null,
    selectedPlayerKeys:
      payload.selectedPlayerKeys !== undefined
        ? payload.selectedPlayerKeys
        : existing?.selectedPlayerKeys ?? payload.liveSession?.selectedPlayerKeys ?? [],
    nextSessionNumber:
      payload.nextSessionNumber ?? existing?.nextSessionNumber ?? payload.liveSession?.sessionNumber ?? null,
    serverSessionId: existing?.serverSessionId ?? payload.liveSession?.sessionId ?? null,
    serverLiveSessionId: existing?.serverLiveSessionId ?? payload.liveSession?.id ?? null,
    state: existing?.state === 'discarded' ? 'active' : existing?.state ?? 'active',
    lastError: null,
  };
}

function buildDraftEntry(
  existing: UploadsProcessingDraftEntry | undefined,
  payload: {
    mode: RecordingDraftMode;
    draft: RecordingDraft | null;
  },
): UploadsProcessingDraftEntry {
  const currentTime = nowIso();
  const groups =
    payload.draft?.groups?.map((group) => ({
      id: group.id,
      displayOrder: group.display_order,
      name: group.name ?? null,
      description: group.description ?? null,
    })) ?? existing?.groups ?? [];

  return {
    id: existing?.id || payload.draft?.id || createLocalId(`draft-${payload.mode}`),
    sourceFlow: payload.mode,
    createdAt: existing?.createdAt || currentTime,
    updatedAt: currentTime,
    mode: payload.mode,
    name: existing?.name ?? payload.draft?.name ?? null,
    description: existing?.description ?? payload.draft?.description ?? null,
    selectedPlayerKeys: existing?.selectedPlayerKeys ?? payload.draft?.selectedPlayerKeys ?? [],
    targetSessionId: existing?.targetSessionId ?? payload.draft?.targetSessionId ?? null,
    targetSessionName: existing?.targetSessionName ?? null,
    groups,
    serverDraftId: existing?.serverDraftId ?? payload.draft?.id ?? null,
    state: existing?.state === 'discarded' ? 'active' : existing?.state ?? 'active',
    lastError: null,
  };
}

function getLiveSessionVisibleId(item: UploadsProcessingCaptureItem) {
  return item.serverLiveGameId || item.liveGameId || `local-live-game-${item.id}`;
}

function getDraftVisibleId(item: UploadsProcessingCaptureItem) {
  return item.serverDraftGameId || item.recordingDraftGameId || `local-draft-game-${item.id}`;
}

function buildOptimisticGameSelection(
  extraction: UploadsProcessingCaptureItem['extraction'],
  selectedPlayerKeys: string[],
) {
  if (!extraction || selectedPlayerKeys.length === 0) {
    return {
      selectedPlayerKey: null,
      selectedPlayerName: null,
    };
  }

  const players = getResolvedPlayersForGame({ extraction });
  const selectedPlayer =
    players.find((player) => selectedPlayerKeys.includes(player.playerKey)) ?? null;

  return {
    selectedPlayerKey: selectedPlayer?.playerKey ?? null,
    selectedPlayerName: selectedPlayer?.playerName
      ? canonicalizePlayerLabel(selectedPlayer.playerName)
      : null,
  };
}

function buildLocalExtraction(players: LivePlayer[]): NonNullable<UploadsProcessingCaptureItem['extraction']> {
  return {
    players,
  };
}

function buildResolvedSessionRouteAliases(
  operation: UploadsProcessingFinalizeOperation,
  payload: {
    primarySessionId?: string | null;
    createdSessionIds?: string[] | null;
    liveSessionId?: string | null;
  },
): UploadsProcessingSessionRouteAlias[] {
  const createdSessionIds = payload.createdSessionIds ?? [];

  if (operation.sourceFlow === 'live_session') {
    const tempSessionId = operation.optimisticSessions[0]?.sessionId;
    if (!tempSessionId || !payload.liveSessionId || tempSessionId === payload.liveSessionId) {
      return [];
    }

    return [
      {
        tempSessionId,
        resolvedSessionId: payload.liveSessionId,
        sourceFlow: operation.sourceFlow,
        finalizeOperationId: operation.id,
        createdAt: nowIso(),
      },
    ];
  }

  if (operation.sourceFlow === 'add_existing_session' && operation.targetSessionId) {
    if (operation.targetSessionId !== NEW_SESSION_TARGET) {
      return [];
    }
  }

  return operation.optimisticSessions.flatMap((session, index) => {
    const tempSessionId = session.sessionId;
    const resolvedSessionId =
      createdSessionIds[index] ??
      (operation.optimisticSessions.length === 1 ? payload.primarySessionId ?? null : null);

    if (!tempSessionId || !resolvedSessionId || tempSessionId === resolvedSessionId) {
      return [];
    }

    return {
      tempSessionId,
      resolvedSessionId,
      sourceFlow: operation.sourceFlow,
      finalizeOperationId: operation.id,
      createdAt: nowIso(),
    };
  });
}


export function UploadsProcessingProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [store, setStore] = useState<UploadsProcessingStore>(createEmptyUploadsProcessingStore());
  const [ready, setReady] = useState(false);
  const storeRef = useRef(store);
  const readyRef = useRef(false);
  const syncRunningRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const scheduledSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSyncPassRef = useRef<(() => Promise<void>) | null>(null);

  const invalidateSyncQueries = useCallback(() => {
    const currentStore = storeRef.current;

    queryClient.setQueryData<{ games: GameListItem[]; count: number | null } | undefined>(
      queryKeys.games,
      (current) =>
        current
          ? {
              ...current,
              games: mergeGamesWithUploadsProcessing(current.games, currentStore),
            }
          : current,
    );
    queryClient.setQueryData<LiveSessionResponse | undefined>(queryKeys.liveSession, (current) =>
      current ? mergeLiveSessionWithUploadsProcessing(current, currentStore) : current,
    );
    queryClient.setQueryData<RecordEntryStatusResponse | undefined>(
      queryKeys.recordEntryStatus,
      (current) =>
        current
          ? {
              ...current,
              status: mergeRecordEntryStatusWithUploadsProcessing(current.status, currentStore),
            }
          : current,
    );
    queryClient.setQueryData<RecordingDraftResponse | undefined>(
      queryKeys.recordingDraft('upload_session'),
      (current) =>
        current
          ? mergeRecordingDraftWithUploadsProcessing(current, currentStore, 'upload_session')
          : current,
    );
    queryClient.setQueryData<RecordingDraftResponse | undefined>(
      queryKeys.recordingDraft('add_multiple_sessions'),
      (current) =>
        current
          ? mergeRecordingDraftWithUploadsProcessing(current, currentStore, 'add_multiple_sessions')
          : current,
    );
    queryClient.setQueryData<RecordingDraftResponse | undefined>(
      queryKeys.recordingDraft('add_existing_session'),
      (current) =>
        current
          ? mergeRecordingDraftWithUploadsProcessing(current, currentStore, 'add_existing_session')
          : current,
    );
    queryClient.setQueryData<{ sessions: SessionItem[] } | undefined>(
      queryKeys.sessions,
      (current) =>
        current
          ? {
              ...current,
              sessions: mergeSessionsWithUploadsProcessing(current.sessions, currentStore),
            }
          : current,
    );

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.games }),
      queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft('upload_session') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft('add_multiple_sessions') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft('add_existing_session') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ]);
  }, [queryClient]);

  const persistAndSetStore = useCallback(
    (nextStore: UploadsProcessingStore) => {
      storeRef.current = nextStore;
      setStore(nextStore);
      void saveUploadsProcessingStore(nextStore);
      invalidateSyncQueries();
    },
    [invalidateSyncQueries],
  );

  const updateStore = useCallback(
    (updater: (current: UploadsProcessingStore) => UploadsProcessingStore) => {
      const nextStore = updater(cloneStore(storeRef.current));
      persistAndSetStore(nextStore);
      return nextStore;
    },
    [persistAndSetStore],
  );

  useEffect(() => {
    let mounted = true;
    loadUploadsProcessingStore()
      .then((loadedStore) => {
        if (!mounted) {
          return;
        }
        storeRef.current = loadedStore;
        setStore(loadedStore);
        readyRef.current = true;
        setReady(true);
        invalidateSyncQueries();
      })
      .catch((error) => {
        console.error('Failed to hydrate uploads processing store.', error);
        if (!mounted) {
          return;
        }
        readyRef.current = true;
        setReady(true);
      });

    return () => {
      mounted = false;
    };
  }, [invalidateSyncQueries]);

  const scheduleSyncNow = useCallback(() => {
    if (!readyRef.current || !user?.id) {
      return;
    }
    if (scheduledSyncTimeoutRef.current) {
      clearTimeout(scheduledSyncTimeoutRef.current);
    }
    scheduledSyncTimeoutRef.current = setTimeout(() => {
      scheduledSyncTimeoutRef.current = null;
      void runSyncPassRef.current?.();
    }, 0);
  }, [user?.id]);

  const markCaptureFailure = useCallback(
    (captureId: string, errorMessage: string) => {
      updateStore((current) => {
        const captureItem = current.captureItems.find((entry) => entry.id === captureId);
        if (!captureItem) {
          return current;
        }

        captureItem.status = 'failed';
        captureItem.retryCount += 1;
        captureItem.lastError = errorMessage;
        captureItem.nextRetryAt = getNextRetryAt(captureItem.retryCount);
        captureItem.updatedAt = nowIso();

        if (captureItem.liveSessionId) {
          const liveSession = current.liveSessions.find((entry) => entry.id === captureItem.liveSessionId);
          if (liveSession) {
            liveSession.lastError = errorMessage;
            if (liveSession.state === 'finalize_pending') {
              liveSession.state = 'failed';
            }
            liveSession.updatedAt = captureItem.updatedAt;
          }
        }

        if (captureItem.recordingDraftId) {
          const draft = current.drafts.find((entry) => entry.id === captureItem.recordingDraftId);
          if (draft) {
            draft.lastError = errorMessage;
            if (draft.state === 'finalize_pending') {
              draft.state = 'failed';
            }
            draft.updatedAt = captureItem.updatedAt;
          }
        }

        current.finalizeOperations.forEach((operation) => {
          if (!operation.linkedCaptureItemIds.includes(captureId)) {
            return;
          }
          operation.status = 'failed';
          operation.lastError = errorMessage;
          operation.retryCount += 1;
          operation.nextRetryAt = getNextRetryAt(operation.retryCount);
          operation.updatedAt = captureItem.updatedAt;
        });

        return current;
      });
    },
    [updateStore],
  );

  const refreshLiveSessionServerState = useCallback(
    async (liveSessionId: string) => {
      const payload = await apiJson<LiveSessionResponse>('/api/live-session');
      updateStore((current) => {
        const targetSession = current.liveSessions.find((entry) => entry.id === liveSessionId);
        if (!targetSession) {
          return current;
        }

        if (!payload.liveSession) {
          return current;
        }

        targetSession.serverSessionId = payload.liveSession.sessionId;
        targetSession.serverLiveSessionId = payload.liveSession.id;
        targetSession.updatedAt = nowIso();

        current.captureItems.forEach((item) => {
          if (item.liveSessionId !== liveSessionId || !item.serverLiveGameId) {
            return;
          }

          const serverGame = payload.liveSession?.games.find(
            (entry) => entry.id === item.serverLiveGameId,
          );
          if (!serverGame) {
            return;
          }

          item.extraction = serverGame.extraction ?? item.extraction ?? null;
          item.lastError = serverGame.last_error ?? item.lastError ?? null;
          item.updatedAt = nowIso();
          if (serverGame.status === 'ready') {
            item.status = current.finalizeOperations.some((operation) => operation.linkedCaptureItemIds.includes(item.id))
              ? 'finalize_pending'
              : 'ready_pending_finalize';
          } else if (serverGame.status === 'error') {
            item.status = 'failed';
          } else {
            item.status = 'processing_pending';
          }
        });

        return current;
      });
    },
    [updateStore],
  );

  const refreshRecordingDraftServerState = useCallback(
    async (draftId: string, mode: RecordingDraftMode) => {
      const payload = await apiJson<RecordingDraftResponse>(
        `/api/recording-draft?mode=${encodeURIComponent(mode)}`,
      );
      updateStore((current) => {
        const targetDraft = current.drafts.find((entry) => entry.id === draftId);
        if (!targetDraft) {
          return current;
        }

        if (!payload.draft) {
          return current;
        }

        targetDraft.serverDraftId = payload.draft.id;
        targetDraft.updatedAt = nowIso();

        current.captureItems.forEach((item) => {
          if (item.recordingDraftId !== draftId || !item.serverDraftGameId) {
            return;
          }

          const serverGame = payload.draft?.groups
            .flatMap((group) => group.games)
            .find((entry) => entry.id === item.serverDraftGameId);
          if (!serverGame) {
            return;
          }

          item.extraction = serverGame.extraction ?? item.extraction ?? null;
          item.lastError = serverGame.last_error ?? item.lastError ?? null;
          item.updatedAt = nowIso();
          if (serverGame.status === 'ready') {
            item.status = current.finalizeOperations.some((operation) => operation.linkedCaptureItemIds.includes(item.id))
              ? 'finalize_pending'
              : 'ready_pending_finalize';
          } else if (serverGame.status === 'error') {
            item.status = 'failed';
          } else {
            item.status = 'processing_pending';
          }
        });

        return current;
      });
    },
    [updateStore],
  );

  const processCaptureItem = useCallback(
    async (captureItem: UploadsProcessingCaptureItem) => {
      if (!user?.id || captureItem.status === 'discarded' || captureItem.status === 'synced') {
        return;
      }

      if (
        captureItem.status === 'failed' &&
        !isRetryDue(captureItem.nextRetryAt)
      ) {
        return;
      }

      try {
        let workingItem = captureItem;

        if (!workingItem.storageKey) {
          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (currentItem) {
              currentItem.status = 'upload_pending';
              currentItem.lastError = null;
              currentItem.updatedAt = nowIso();
            }
            return current;
          });

          const storageKey = `${user.id}/${captureItem.id}-${captureItem.localFileName}`;
          const uploadBody = await new File(captureItem.localFileUri).arrayBuffer();
          const upload = await supabase.storage.from(DEFAULT_BUCKET).upload(storageKey, uploadBody, {
            contentType: captureItem.mimeType || 'image/jpeg',
            upsert: false,
          });

          if (upload.error) {
            throw new Error(upload.error.message || 'Failed to upload scoreboard image.');
          }

          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (currentItem) {
              currentItem.storageKey = storageKey;
              currentItem.status = 'uploaded';
              currentItem.updatedAt = nowIso();
              currentItem.lastError = null;
              workingItem = { ...currentItem };
            }
            return current;
          });
        }

        if (
          workingItem.liveSessionId &&
          !workingItem.serverLiveGameId &&
          workingItem.storageKey
        ) {
          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (currentItem) {
              currentItem.status = 'server_row_pending';
              currentItem.updatedAt = nowIso();
            }
            return current;
          });

          const localLiveSession = storeRef.current.liveSessions.find(
            (entry) => entry.id === workingItem.liveSessionId,
          );
          const response = await queueLiveSessionCapture({
            storageKey: workingItem.storageKey,
            capturedAtHint: workingItem.capturedAtHint,
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            name: localLiveSession?.serverLiveSessionId ? undefined : localLiveSession?.name ?? undefined,
            description: localLiveSession?.serverLiveSessionId ? undefined : localLiveSession?.description ?? undefined,
            clientCaptureId: workingItem.id,
          });

          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (!currentItem) {
              return current;
            }

            currentItem.jobId = response.jobId;
            currentItem.serverSessionId = response.sessionId;
            currentItem.serverLiveSessionId = response.liveSessionId;
            currentItem.serverLiveGameId = response.liveGameId;
            currentItem.status = 'processing_pending';
            currentItem.lastError = null;
            currentItem.nextRetryAt = null;
            currentItem.updatedAt = nowIso();

            const targetSession = current.liveSessions.find(
              (entry) => entry.id === workingItem.liveSessionId,
            );
            if (targetSession) {
              targetSession.serverSessionId = response.sessionId;
              targetSession.serverLiveSessionId = response.liveSessionId;
              targetSession.updatedAt = currentItem.updatedAt;
            }
            return current;
          });
          await refreshLiveSessionServerState(workingItem.liveSessionId);
          return;
        }

        if (
          workingItem.recordingDraftId &&
          !workingItem.serverDraftGameId &&
          workingItem.storageKey
        ) {
          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (currentItem) {
              currentItem.status = 'server_row_pending';
              currentItem.updatedAt = nowIso();
            }
            return current;
          });

          const response = await uploadToRecordingDraft({
            mode: workingItem.sourceFlow as RecordingDraftMode,
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            storageItems: [
              {
                storageKey: workingItem.storageKey,
                capturedAtHint: workingItem.capturedAtHint ?? undefined,
                fileSizeBytes: workingItem.fileSizeBytes ?? undefined,
                autoGroupIndex: workingItem.autoGroupIndex ?? undefined,
                clientCaptureId: workingItem.id,
                localDraftId: workingItem.recordingDraftId,
                localGroupId: workingItem.localDraftGroupId,
              },
            ],
          });

          const createdGame = response.createdGames?.find(
            (entry) => entry.clientCaptureId === workingItem.id,
          );

          updateStore((current) => {
            const currentItem = current.captureItems.find((entry) => entry.id === captureItem.id);
            if (!currentItem) {
              return current;
            }

            currentItem.serverDraftId = createdGame?.draftId ?? response.draft?.id ?? null;
            currentItem.serverDraftGameId = createdGame?.draftGameId ?? null;
            currentItem.serverDraftGroupId = createdGame?.groupId ?? null;
            currentItem.status = 'processing_pending';
            currentItem.lastError = null;
            currentItem.nextRetryAt = null;
            currentItem.updatedAt = nowIso();

            const targetDraft = current.drafts.find(
              (entry) => entry.id === workingItem.recordingDraftId,
            );
            if (targetDraft) {
              targetDraft.serverDraftId = response.draft?.id ?? targetDraft.serverDraftId ?? null;
              const nextServerGroupId = createdGame?.groupId ?? null;
              const previousLocalGroupId = currentItem.localDraftGroupId;
              if (nextServerGroupId && previousLocalGroupId) {
                targetDraft.groups = targetDraft.groups.map((group) =>
                  group.id === previousLocalGroupId
                    ? { ...group, id: nextServerGroupId }
                    : group,
                );
                current.captureItems.forEach((entry) => {
                  if (
                    entry.recordingDraftId === workingItem.recordingDraftId &&
                    entry.localDraftGroupId === previousLocalGroupId
                  ) {
                    entry.serverDraftGroupId = nextServerGroupId;
                  }
                });
              }
              targetDraft.updatedAt = currentItem.updatedAt;
            }

            return current;
          });
          await refreshRecordingDraftServerState(
            workingItem.recordingDraftId,
            workingItem.sourceFlow as RecordingDraftMode,
          );
          return;
        }

        if (workingItem.liveSessionId && workingItem.serverLiveGameId) {
          await refreshLiveSessionServerState(workingItem.liveSessionId);
          return;
        }

        if (workingItem.recordingDraftId && workingItem.serverDraftGameId) {
          await refreshRecordingDraftServerState(
            workingItem.recordingDraftId,
            workingItem.sourceFlow as RecordingDraftMode,
          );
        }
      } catch (error) {
        markCaptureFailure(
          captureItem.id,
          error instanceof Error ? error.message : 'Failed to process scoreboard item.',
        );
      }
    },
    [
      markCaptureFailure,
      refreshLiveSessionServerState,
      refreshRecordingDraftServerState,
      updateStore,
      user?.id,
    ],
  );

  const finalizeOperationSucceeded = useCallback(
    (
      operationId: string,
      resolvedSessionRouteAliases: UploadsProcessingSessionRouteAlias[] = [],
    ) => {
      updateStore((current) => {
        const operation = current.finalizeOperations.find((entry) => entry.id === operationId);
        if (!operation) {
          return current;
        }

        const linkedCaptureIds = new Set(operation.linkedCaptureItemIds);
        current.captureItems = current.captureItems.filter((item) => {
          if (!linkedCaptureIds.has(item.id)) {
            return true;
          }
          deleteLocalUploadsProcessingFile(item.localFileUri);
          return false;
        });

        if (operation.liveSessionId) {
          current.liveSessions = current.liveSessions.filter(
            (entry) => entry.id !== operation.liveSessionId,
          );
        }
        if (operation.recordingDraftId) {
          current.drafts = current.drafts.filter(
            (entry) => entry.id !== operation.recordingDraftId,
          );
        }

        current.finalizeOperations = current.finalizeOperations.filter(
          (entry) => entry.id !== operationId,
        );
        resolvedSessionRouteAliases.forEach((entry) => {
          current.sessionRouteAliases = replaceSessionRouteAlias(
            current.sessionRouteAliases,
            entry,
          );
        });

        return current;
      });
    },
    [updateStore],
  );

  const processFinalizeOperation = useCallback(
    async (operation: UploadsProcessingFinalizeOperation) => {
      if (operation.status === 'discarded' || operation.status === 'synced') {
        return;
      }

      if (operation.status === 'failed' && !isRetryDue(operation.nextRetryAt)) {
        return;
      }

      const captureItems = storeRef.current.captureItems.filter((item) =>
        operation.linkedCaptureItemIds.includes(item.id),
      );
      if (captureItems.length === 0) {
        finalizeOperationSucceeded(operation.id);
        return;
      }

      const failedCapture = captureItems.find((item) => item.status === 'failed');
      if (failedCapture) {
        updateStore((current) => {
          const targetOperation = current.finalizeOperations.find((entry) => entry.id === operation.id);
          if (targetOperation) {
            targetOperation.status = 'failed';
            targetOperation.lastError = failedCapture.lastError ?? 'A scoreboard failed to sync.';
            targetOperation.retryCount += 1;
            targetOperation.nextRetryAt = getNextRetryAt(targetOperation.retryCount);
            targetOperation.updatedAt = nowIso();
          }
          return current;
        });
        return;
      }

      const allReady = captureItems.every(
        (item) => item.status === 'ready_pending_finalize' || item.status === 'finalize_pending',
      );
      if (!allReady) {
        updateStore((current) => {
          const targetOperation = current.finalizeOperations.find((entry) => entry.id === operation.id);
          if (targetOperation) {
            targetOperation.status = 'waiting_on_captures';
            targetOperation.updatedAt = nowIso();
          }
          return current;
        });
        return;
      }

      try {
        updateStore((current) => {
          const targetOperation = current.finalizeOperations.find((entry) => entry.id === operation.id);
          if (targetOperation) {
            targetOperation.status = 'finalize_pending';
            targetOperation.lastError = null;
            targetOperation.updatedAt = nowIso();
          }
          current.captureItems.forEach((item) => {
            if (operation.linkedCaptureItemIds.includes(item.id)) {
              item.status = 'finalize_pending';
              item.updatedAt = nowIso();
            }
          });
          return current;
        });

        if (operation.sourceFlow === 'live_session' && operation.liveSessionId) {
          const liveSession = storeRef.current.liveSessions.find(
            (entry) => entry.id === operation.liveSessionId,
          );
          if (!liveSession?.serverLiveSessionId) {
            throw new Error('Live session is still waiting on uploads.');
          }

          await updateLiveSession({
            selectedPlayerKeys: liveSession.selectedPlayerKeys,
            name: liveSession.name ?? undefined,
            description: liveSession.description ?? undefined,
          });
          const response = await endLiveSession(operation.id);
          finalizeOperationSucceeded(
            operation.id,
            buildResolvedSessionRouteAliases(operation, {
              liveSessionId: response.sessionId,
            }),
          );
          return;
        }

        if (operation.recordingDraftId) {
          const draft = storeRef.current.drafts.find((entry) => entry.id === operation.recordingDraftId);
          if (!draft?.serverDraftId) {
            throw new Error('Draft is still waiting on uploads.');
          }

          await updateRecordingDraft({
            mode: draft.mode,
            selectedPlayerKeys: draft.selectedPlayerKeys,
            targetSessionId: draft.targetSessionId ?? null,
            name: draft.name ?? null,
            description: draft.description ?? null,
          });

          await Promise.all(
            draft.groups.map((group) =>
              updateRecordingDraftGroup({
                mode: draft.mode,
                groupId: group.id,
                name: group.name ?? null,
                description: group.description ?? null,
              }).catch(() => undefined),
            ),
          );

          const response = await finalizeRecordingDraft({
            mode: draft.mode,
            targetSessionId: draft.targetSessionId ?? null,
            name: draft.name ?? null,
            description: draft.description ?? null,
            clientOperationId: operation.id,
          });
          finalizeOperationSucceeded(
            operation.id,
            buildResolvedSessionRouteAliases(operation, {
              primarySessionId: response.primarySessionId,
              createdSessionIds: response.createdSessionIds,
            }),
          );
        }
      } catch (error) {
        updateStore((current) => {
          const targetOperation = current.finalizeOperations.find((entry) => entry.id === operation.id);
          if (targetOperation) {
            targetOperation.status = 'failed';
            targetOperation.retryCount += 1;
            targetOperation.lastError =
              error instanceof Error ? error.message : 'Failed to finalize uploads.';
            targetOperation.nextRetryAt = getNextRetryAt(targetOperation.retryCount);
            targetOperation.updatedAt = nowIso();
          }
          current.captureItems.forEach((item) => {
            if (!operation.linkedCaptureItemIds.includes(item.id)) {
              return;
            }
            item.status = 'ready_pending_finalize';
            item.lastError =
              error instanceof Error ? error.message : 'Failed to finalize uploads.';
            item.updatedAt = nowIso();
          });
          return current;
        });
      }
    },
    [finalizeOperationSucceeded, updateStore],
  );

  const runSyncPass = useCallback(async () => {
    if (syncRunningRef.current || !readyRef.current || !user?.id) {
      syncQueuedRef.current = true;
      return;
    }

    syncRunningRef.current = true;
    try {
      const currentStore = storeRef.current;
      const captureItems = currentStore.captureItems.filter(
        (item) =>
          item.status !== 'synced' &&
          item.status !== 'discarded' &&
          (item.status !== 'failed' || isRetryDue(item.nextRetryAt)),
      );

      for (const item of captureItems) {
        await processCaptureItem(item);
      }

      const finalizeOperations = storeRef.current.finalizeOperations.filter(
        (item) =>
          item.status !== 'synced' &&
          item.status !== 'discarded' &&
          (item.status !== 'failed' || isRetryDue(item.nextRetryAt)),
      );

      for (const operation of finalizeOperations) {
        await processFinalizeOperation(operation);
      }
    } finally {
      syncRunningRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        void runSyncPass();
      }
    }
  }, [processCaptureItem, processFinalizeOperation, user?.id]);

  useEffect(() => {
    runSyncPassRef.current = runSyncPass;
  }, [runSyncPass]);

  useEffect(() => {
    if (!ready || !user?.id) {
      return;
    }

    scheduleSyncNow();

    const interval = setInterval(() => {
      void runSyncPass();
    }, SYNC_INTERVAL_MS);

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        scheduleSyncNow();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    const handleOnline = () => {
      scheduleSyncNow();
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      clearInterval(interval);
      subscription.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [ready, runSyncPass, scheduleSyncNow, user?.id]);

  const enqueueLiveCaptures = useCallback(
    async (payload: {
      assets: ImagePicker.ImagePickerAsset[];
      liveSession: LiveSession | null;
      nextSessionNumber?: number | null;
      name?: string;
      description?: string;
    }) => {
      const currentTime = nowIso();
      const persistedAssets = await Promise.all(
        payload.assets.map(async (asset, index) => ({
          asset,
          index,
          persistedFile: await persistImageAssetLocally(asset, {
            fileNamePrefix: createLocalId('capture'),
            fallbackIndex: index,
          }),
        })),
      );

      updateStore((current) => {
        const existingLiveSession = current.liveSessions.find(
          (entry) =>
            entry.id === payload.liveSession?.local_sync?.localId ||
            (payload.liveSession?.id && entry.serverLiveSessionId === payload.liveSession.id),
        );
        const liveSessionEntry = buildLiveSessionEntry(existingLiveSession, {
          liveSession: payload.liveSession,
          nextSessionNumber: payload.nextSessionNumber,
          name: payload.name,
          description: payload.description,
        });

        current.liveSessions = replaceStoreEntity(current.liveSessions, liveSessionEntry);
        const existingCaptureOrder = current.captureItems
          .filter((entry) => entry.liveSessionId === liveSessionEntry.id)
          .reduce((max, entry) => Math.max(max, entry.captureOrder), 0);

        persistedAssets.forEach((entry, index) => {
          const captureItem: UploadsProcessingCaptureItem = {
            id: createLocalId('live-capture'),
            sourceFlow: 'live_session',
            createdAt: currentTime,
            updatedAt: currentTime,
            localFileUri: entry.persistedFile.localFileUri,
            localFileName: entry.persistedFile.localFileName,
            mimeType: entry.asset.mimeType ?? 'image/jpeg',
            fileSizeBytes: entry.asset.fileSize ?? null,
            capturedAtHint: deriveCapturedAtHint(entry.asset),
            status: 'captured_local',
            retryCount: 0,
            lastError: null,
            liveSessionId: liveSessionEntry.id,
            liveGameId: createLocalId('live-game'),
            serverSessionId: liveSessionEntry.serverSessionId ?? null,
            serverLiveSessionId: liveSessionEntry.serverLiveSessionId ?? null,
            captureOrder: existingCaptureOrder + index + 1,
          };

          current.captureItems = replaceStoreEntity(current.captureItems, captureItem);
        });
        return current;
      });

      scheduleSyncNow();
    },
    [scheduleSyncNow, updateStore],
  );

  const updateLiveSessionLocal = useCallback(
    (payload: {
      liveSession: LiveSession | null;
      nextSessionNumber?: number | null;
      name?: string;
      description?: string;
      selectedPlayerKeys?: string[];
    }) => {
      updateStore((current) => {
        const existingLiveSession = current.liveSessions.find(
          (entry) =>
            entry.id === payload.liveSession?.local_sync?.localId ||
            (payload.liveSession?.id && entry.serverLiveSessionId === payload.liveSession.id),
        );
        const nextEntry = buildLiveSessionEntry(existingLiveSession, payload);
        current.liveSessions = replaceStoreEntity(current.liveSessions, nextEntry);
        return current;
      });
    },
    [updateStore],
  );

  const deleteLiveCapture = useCallback(
    async (visibleGameId: string) => {
      const captureItem = storeRef.current.captureItems.find(
        (entry) =>
          entry.liveSessionId &&
          (getLiveSessionVisibleId(entry) === visibleGameId || entry.id === visibleGameId),
      );
      if (!captureItem) {
        return {
          removed: false,
          remoteDeleteRequired: true,
        };
      }

      updateStore((current) => {
        current.captureItems = current.captureItems.filter((entry) => entry.id !== captureItem.id);
        deleteLocalUploadsProcessingFile(captureItem.localFileUri);

        if (
          captureItem.liveSessionId &&
          !current.captureItems.some((entry) => entry.liveSessionId === captureItem.liveSessionId)
        ) {
          current.liveSessions = current.liveSessions.filter(
            (entry) => entry.id !== captureItem.liveSessionId,
          );
        }
        return current;
      });

      return {
        removed: true,
        remoteDeleteRequired: Boolean(captureItem.serverLiveGameId),
      };
    },
    [updateStore],
  );

  const discardLiveSessionLocal = useCallback(
    async (payload: { liveSession: LiveSession | null }) => {
      const localId = payload.liveSession?.local_sync?.localId;
      const targetSession = storeRef.current.liveSessions.find(
        (entry) =>
          entry.id === localId ||
          (payload.liveSession?.id && entry.serverLiveSessionId === payload.liveSession.id),
      );
      if (!targetSession) {
        return false;
      }

      updateStore((current) => {
        const captureItems = current.captureItems.filter(
          (entry) => entry.liveSessionId === targetSession.id,
        );
        const captureItemIds = new Set(captureItems.map((entry) => entry.id));
        captureItems.forEach((item) => deleteLocalUploadsProcessingFile(item.localFileUri));
        current.captureItems = current.captureItems.filter(
          (entry) => entry.liveSessionId !== targetSession.id,
        );
        current.finalizeOperations = current.finalizeOperations.filter(
          (entry) =>
            entry.liveSessionId !== targetSession.id &&
            !entry.linkedCaptureItemIds.some((captureId) => captureItemIds.has(captureId)),
        );

        const storedSession = current.liveSessions.find((entry) => entry.id === targetSession.id);
        if (
          storedSession &&
          (storedSession.serverLiveSessionId || storedSession.serverSessionId)
        ) {
          storedSession.state = 'discarded';
          storedSession.lastError = null;
          storedSession.updatedAt = nowIso();
        } else {
          current.liveSessions = current.liveSessions.filter(
            (entry) => entry.id !== targetSession.id,
          );
        }
        return current;
      });

      return true;
    },
    [updateStore],
  );

  const finalizeLiveSessionLocal = useCallback(
    async (payload: {
      liveSession: LiveSession;
      name?: string;
      description?: string;
    }) => {
      const localSessionId =
        payload.liveSession.local_sync?.localId ||
        storeRef.current.liveSessions.find(
          (entry) => entry.serverLiveSessionId === payload.liveSession.id,
        )?.id;
      if (!localSessionId) {
        throw new Error('Live session local state was not found.');
      }

      const currentTime = nowIso();
      const routeSessionId = createLocalId('session');
      const nextName = payload.name?.trim() || payload.liveSession.name || null;
      const nextDescription =
        payload.description?.trim() || payload.liveSession.description || null;
      const captureItems = storeRef.current.captureItems
        .filter((entry) => entry.liveSessionId === localSessionId && entry.status !== 'discarded')
        .sort((left, right) => left.captureOrder - right.captureOrder);

      const optimisticSession: UploadsProcessingOptimisticSession = {
        id: createLocalId('optimistic-session'),
        sessionId: routeSessionId,
        sourceFlow: 'live_session',
        createdAt: currentTime,
        startedAt:
          captureItems.map((item) => item.capturedAtHint || item.createdAt).find(Boolean) ?? currentTime,
        name: payload.name?.trim() || payload.liveSession.name || null,
        description: payload.description?.trim() || payload.liveSession.description || null,
        linkedCaptureItemIds: captureItems.map((item) => item.id),
        isReadOnlyUntilSynced: true,
      };

      const optimisticGames: UploadsProcessingOptimisticGame[] = captureItems.map((item) => {
        const selectedPlayer = buildOptimisticGameSelection(
          item.extraction ?? null,
          payload.liveSession.selectedPlayerKeys,
        );
        return {
          id: createLocalId('optimistic-game'),
          gameId: createLocalId('game'),
          sessionId: routeSessionId,
          sourceFlow: 'live_session',
          createdAt: item.createdAt,
          playedAt: item.capturedAtHint ?? item.createdAt,
          linkedCaptureItemId: item.id,
          linkedSessionId: optimisticSession.id,
          isReadOnlyUntilSynced: true,
          selectedPlayerKey: selectedPlayer.selectedPlayerKey,
          selectedPlayerName: selectedPlayer.selectedPlayerName,
        };
      });

      const finalizeOperation: UploadsProcessingFinalizeOperation = {
        id: createLocalId('finalize'),
        sourceFlow: 'live_session',
        createdAt: currentTime,
        updatedAt: currentTime,
        status: 'pending',
        retryCount: 0,
        liveSessionId: localSessionId,
        linkedCaptureItemIds: captureItems.map((item) => item.id),
        optimisticSessions: [optimisticSession],
        optimisticGames,
        serverSessionId:
          payload.liveSession.sessionId === localSessionId ? null : payload.liveSession.sessionId,
        serverLiveSessionId:
          payload.liveSession.id === localSessionId ? null : payload.liveSession.id,
        draftName: nextName,
        draftDescription: nextDescription,
      };

      updateStore((current) => {
        current.finalizeOperations = replaceStoreEntity(current.finalizeOperations, finalizeOperation);
        current.captureItems.forEach((item) => {
          if (!finalizeOperation.linkedCaptureItemIds.includes(item.id)) {
            return;
          }
          item.finalizeOperationId = finalizeOperation.id;
          if (item.status === 'ready_pending_finalize') {
            item.status = 'finalize_pending';
          }
          item.updatedAt = currentTime;
        });
        const targetLiveSession = current.liveSessions.find((entry) => entry.id === localSessionId);
        if (targetLiveSession) {
          targetLiveSession.state = 'finalize_pending';
          targetLiveSession.name = nextName ?? targetLiveSession.name ?? null;
          targetLiveSession.description = nextDescription ?? targetLiveSession.description ?? null;
          targetLiveSession.selectedPlayerKeys = [...payload.liveSession.selectedPlayerKeys];
          targetLiveSession.lastError = null;
          targetLiveSession.updatedAt = currentTime;
        }
        return current;
      });

      scheduleSyncNow();
      return { routeSessionId };
    },
    [scheduleSyncNow, updateStore],
  );

  const enqueueDraftCaptures = useCallback(
    async (payload: {
      mode: RecordingDraftMode;
      draft: RecordingDraft | null;
      assets: ImagePicker.ImagePickerAsset[];
    }) => {
      const autoGroupMap =
        payload.mode === 'add_multiple_sessions' ? buildAutoGroupMap(payload.assets) : new Map();

      const persistedAssets = await Promise.all(
        payload.assets.map(async (asset, index) => ({
          asset,
          index,
          persisted: await persistImageAssetLocally(asset, {
            fileNamePrefix: createLocalId('capture'),
            fallbackIndex: index,
          }),
          capturedAtHint: deriveCapturedAtHint(asset),
          autoGroupMeta: autoGroupMap.get(asset.uri),
        })),
      );

      updateStore((current) => {
        const existingDraft = current.drafts.find(
          (entry) =>
            entry.id === payload.draft?.local_sync?.localId ||
            (payload.draft?.id && entry.serverDraftId === payload.draft.id) ||
            entry.mode === payload.mode,
        );
        const draftEntry = buildDraftEntry(existingDraft, {
          mode: payload.mode,
          draft: payload.draft,
        });

        if (draftEntry.groups.length === 0) {
          if (payload.mode === 'add_multiple_sessions') {
            const distinctGroupIndexes = Array.from(
              new Set(
                persistedAssets.map((entry) => entry.autoGroupMeta?.autoGroupIndex ?? 0),
              ),
            ).sort((left, right) => left - right);
            draftEntry.groups = distinctGroupIndexes.map((groupIndex, index) => ({
              id: createLocalId(`draft-group-${groupIndex}`),
              displayOrder: index,
              name: null,
              description: null,
            }));
          } else {
            draftEntry.groups = [
              {
                id: createLocalId('draft-group'),
                displayOrder: 0,
                name: null,
                description: null,
              },
            ];
          }
        }

        const existingCaptureOrder = current.captureItems
          .filter((entry) => entry.recordingDraftId === draftEntry.id)
          .reduce((max, entry) => Math.max(max, entry.captureOrder), 0);

        persistedAssets.forEach((entry, index) => {
          const groupId =
            payload.mode === 'add_multiple_sessions'
              ? draftEntry.groups[entry.autoGroupMeta?.autoGroupIndex ?? 0]?.id
              : draftEntry.groups[0]?.id;

          const captureItem: UploadsProcessingCaptureItem = {
            id: createLocalId('draft-capture'),
            sourceFlow: payload.mode,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            localFileUri: entry.persisted.localFileUri,
            localFileName: entry.persisted.localFileName,
            mimeType: entry.asset.mimeType ?? 'image/jpeg',
            fileSizeBytes: entry.asset.fileSize ?? null,
            capturedAtHint: entry.capturedAtHint,
            status: 'captured_local',
            retryCount: 0,
            lastError: null,
            recordingDraftId: draftEntry.id,
            recordingDraftGameId: createLocalId('draft-game'),
            localDraftGroupId: groupId ?? null,
            captureOrder: existingCaptureOrder + index + 1,
            autoGroupIndex: entry.autoGroupMeta?.autoGroupIndex ?? null,
          };

          current.captureItems = replaceStoreEntity(current.captureItems, captureItem);
        });

        current.drafts = replaceStoreEntity(current.drafts, draftEntry);
        return current;
      });

      scheduleSyncNow();
    },
    [scheduleSyncNow, updateStore],
  );

  const updateDraftLocal = useCallback(
    (payload: UpdateDraftInput) => {
      updateStore((current) => {
        const existingDraft = current.drafts.find(
          (entry) =>
            entry.id === payload.draftId ||
            entry.mode === payload.mode,
        );
        const draftEntry = buildDraftEntry(existingDraft, {
          mode: payload.mode,
          draft: null,
        });

        if (payload.selectedPlayerKeys !== undefined) {
          draftEntry.selectedPlayerKeys = [...payload.selectedPlayerKeys];
        }
        if (payload.targetSessionId !== undefined) {
          draftEntry.targetSessionId = payload.targetSessionId;
        }
        if (payload.targetSessionName !== undefined) {
          draftEntry.targetSessionName = payload.targetSessionName;
        }
        if (payload.name !== undefined) {
          draftEntry.name = payload.name;
        }
        if (payload.description !== undefined) {
          draftEntry.description = payload.description;
        }
        draftEntry.updatedAt = nowIso();
        current.drafts = replaceStoreEntity(current.drafts, draftEntry);
        return current;
      });
    },
    [updateStore],
  );

  const updateDraftGroupLocal = useCallback(
    (payload: UpdateDraftGroupInput) => {
      updateStore((current) => {
        const targetDraft = current.drafts.find((entry) => entry.mode === payload.mode);
        if (!targetDraft) {
          return current;
        }
        targetDraft.groups = targetDraft.groups.map((group) =>
          group.id === payload.draftGroupId
            ? {
                ...group,
                name: payload.name ?? null,
                description: payload.description ?? null,
              }
            : group,
        );
        targetDraft.updatedAt = nowIso();
        return current;
      });
    },
    [updateStore],
  );

  const deleteDraftCapture = useCallback(
    async (payload: { mode: RecordingDraftMode; visibleGameId: string }) => {
      const captureItem = storeRef.current.captureItems.find(
        (entry) =>
          entry.sourceFlow === payload.mode &&
          entry.recordingDraftId &&
          (getDraftVisibleId(entry) === payload.visibleGameId || entry.id === payload.visibleGameId),
      );
      if (!captureItem) {
        return {
          removed: false,
          remoteDeleteRequired: true,
        };
      }

      updateStore((current) => {
        current.captureItems = current.captureItems.filter((entry) => entry.id !== captureItem.id);
        deleteLocalUploadsProcessingFile(captureItem.localFileUri);
        const targetDraft = current.drafts.find((entry) => entry.id === captureItem.recordingDraftId);
        if (
          targetDraft &&
          !current.captureItems.some((entry) => entry.recordingDraftId === targetDraft.id)
        ) {
          current.drafts = current.drafts.filter((entry) => entry.id !== targetDraft.id);
        }
        return current;
      });

      return {
        removed: true,
        remoteDeleteRequired: Boolean(captureItem.serverDraftGameId),
      };
    },
    [updateStore],
  );

  const discardDraftLocal = useCallback(
    async (payload: { mode: RecordingDraftMode; draft: RecordingDraft | null }) => {
      const localDraftId =
        payload.draft?.local_sync?.localId ||
        storeRef.current.drafts.find(
          (entry) => payload.draft?.id && entry.serverDraftId === payload.draft.id,
        )?.id;
      if (!localDraftId) {
        return false;
      }

      const draft = storeRef.current.drafts.find((entry) => entry.id === localDraftId);
      if (!draft || draft.serverDraftId) {
        return false;
      }

      updateStore((current) => {
        const captureItems = current.captureItems.filter((entry) => entry.recordingDraftId === draft.id);
        captureItems.forEach((item) => deleteLocalUploadsProcessingFile(item.localFileUri));
        current.captureItems = current.captureItems.filter((entry) => entry.recordingDraftId !== draft.id);
        current.finalizeOperations = current.finalizeOperations.filter(
          (entry) => entry.recordingDraftId !== draft.id,
        );
        current.drafts = current.drafts.filter((entry) => entry.id !== draft.id);
        return current;
      });

      return true;
    },
    [updateStore],
  );

  const clearDraftLocalState = useCallback(
    async (payload: { mode: RecordingDraftMode; draft: RecordingDraft | null }) => {
      const localDraftId =
        payload.draft?.local_sync?.localId ||
        storeRef.current.drafts.find(
          (entry) =>
            (payload.draft?.id && entry.serverDraftId === payload.draft.id) ||
            entry.mode === payload.mode,
        )?.id;

      if (!localDraftId) {
        return;
      }

      updateStore((current) => {
        const targetDraft = current.drafts.find((entry) => entry.id === localDraftId);
        if (!targetDraft) {
          return current;
        }

        const linkedCaptureItems = current.captureItems.filter(
          (entry) => entry.recordingDraftId === targetDraft.id,
        );
        const linkedCaptureIds = new Set(linkedCaptureItems.map((entry) => entry.id));

        linkedCaptureItems.forEach((item) => deleteLocalUploadsProcessingFile(item.localFileUri));

        current.captureItems = current.captureItems.filter(
          (entry) => entry.recordingDraftId !== targetDraft.id,
        );
        current.finalizeOperations = current.finalizeOperations.filter(
          (entry) =>
            entry.recordingDraftId !== targetDraft.id &&
            !entry.linkedCaptureItemIds.some((captureId) => linkedCaptureIds.has(captureId)),
        );
        current.drafts = current.drafts.filter((entry) => entry.id !== targetDraft.id);
        return current;
      });
    },
    [updateStore],
  );

  const finalizeDraftLocal = useCallback(
    async (payload: FinalizeDraftInput) => {
      const localDraftId =
        payload.draft?.local_sync?.localId ||
        storeRef.current.drafts.find(
          (entry) => payload.draft?.id && entry.serverDraftId === payload.draft.id,
        )?.id;
      if (!localDraftId) {
        throw new Error('Draft local state was not found.');
      }

      const draft = storeRef.current.drafts.find((entry) => entry.id === localDraftId);
      if (!draft) {
        throw new Error('Draft local state was not found.');
      }

      const currentTime = nowIso();
      const captureItems = storeRef.current.captureItems
        .filter((entry) => entry.recordingDraftId === draft.id && entry.status !== 'discarded')
        .sort((left, right) => left.captureOrder - right.captureOrder);

      const optimisticSessions: UploadsProcessingOptimisticSession[] = [];
      const optimisticGames: UploadsProcessingOptimisticGame[] = [];

      const buildSessionDescriptor = (sessionId: string, name: string | null, description: string | null, linkedCaptureItemIds: string[]) => ({
        id: createLocalId('optimistic-session'),
        sessionId,
        sourceFlow: payload.mode,
        createdAt: currentTime,
        startedAt:
          captureItems
            .filter((item) => linkedCaptureItemIds.includes(item.id))
            .map((item) => item.capturedAtHint || item.createdAt)
            .find(Boolean) ?? currentTime,
        name,
        description,
        linkedCaptureItemIds,
        isReadOnlyUntilSynced: true,
      });

      if (payload.mode === 'add_existing_session' && payload.targetSessionId && payload.targetSessionId !== '__new-session__') {
        const linkedCaptureItemIds = captureItems.map((item) => item.id);
        optimisticSessions.push(
          buildSessionDescriptor(
            payload.targetSessionId,
            payload.targetSessionName ?? draft.targetSessionName ?? null,
            null,
            linkedCaptureItemIds,
          ),
        );
      } else if (payload.mode === 'add_multiple_sessions') {
        draft.groups
          .sort((left, right) => left.displayOrder - right.displayOrder)
          .forEach((group) => {
            const groupCaptureItems = captureItems.filter(
              (item) => item.localDraftGroupId === group.id,
            );
            if (groupCaptureItems.length === 0) {
              return;
            }
            optimisticSessions.push(
              buildSessionDescriptor(
                createLocalId('session'),
                group.name ?? null,
                group.description ?? null,
                groupCaptureItems.map((item) => item.id),
              ),
            );
          });
      } else {
        optimisticSessions.push(
          buildSessionDescriptor(
            createLocalId('session'),
            payload.name ?? draft.name ?? null,
            payload.description ?? draft.description ?? null,
            captureItems.map((item) => item.id),
          ),
        );
      }

      const sessionByCaptureId = new Map<string, UploadsProcessingOptimisticSession>();
      optimisticSessions.forEach((session) => {
        session.linkedCaptureItemIds.forEach((captureId) => {
          sessionByCaptureId.set(captureId, session);
        });
      });

      captureItems.forEach((item) => {
        const session = sessionByCaptureId.get(item.id) ?? optimisticSessions[0];
        if (!session) {
          return;
        }
        const selectedPlayer = buildOptimisticGameSelection(
          item.extraction ?? null,
          draft.selectedPlayerKeys,
        );
        optimisticGames.push({
          id: createLocalId('optimistic-game'),
          gameId: createLocalId('game'),
          sessionId: session.sessionId,
          sourceFlow: payload.mode,
          createdAt: item.createdAt,
          playedAt: item.capturedAtHint ?? item.createdAt,
          linkedCaptureItemId: item.id,
          linkedSessionId: session.id,
          isReadOnlyUntilSynced: true,
          selectedPlayerKey: selectedPlayer.selectedPlayerKey,
          selectedPlayerName: selectedPlayer.selectedPlayerName,
        });
      });

      const finalizeOperation: UploadsProcessingFinalizeOperation = {
        id: createLocalId('finalize'),
        sourceFlow: payload.mode,
        createdAt: currentTime,
        updatedAt: currentTime,
        status: 'pending',
        retryCount: 0,
        recordingDraftId: draft.id,
        linkedCaptureItemIds: captureItems.map((item) => item.id),
        optimisticSessions,
        optimisticGames,
        targetSessionId: payload.targetSessionId ?? draft.targetSessionId ?? null,
        targetSessionName: payload.targetSessionName ?? draft.targetSessionName ?? null,
        draftName: payload.name ?? draft.name ?? null,
        draftDescription: payload.description ?? draft.description ?? null,
      };

      updateStore((current) => {
        current.finalizeOperations = replaceStoreEntity(current.finalizeOperations, finalizeOperation);
        const targetDraft = current.drafts.find((entry) => entry.id === draft.id);
        if (targetDraft) {
          targetDraft.state = 'finalize_pending';
          targetDraft.targetSessionId = payload.targetSessionId ?? targetDraft.targetSessionId ?? null;
          targetDraft.targetSessionName =
            payload.targetSessionName ?? targetDraft.targetSessionName ?? null;
          targetDraft.name = payload.name ?? targetDraft.name ?? null;
          targetDraft.description = payload.description ?? targetDraft.description ?? null;
          targetDraft.lastError = null;
          targetDraft.updatedAt = currentTime;
        }
        current.captureItems.forEach((item) => {
          if (!finalizeOperation.linkedCaptureItemIds.includes(item.id)) {
            return;
          }
          item.finalizeOperationId = finalizeOperation.id;
          if (item.status === 'ready_pending_finalize') {
            item.status = 'finalize_pending';
          }
          item.updatedAt = currentTime;
        });
        return current;
      });

      scheduleSyncNow();
      return {
        routeSessionId: optimisticSessions[0]?.sessionId ?? payload.targetSessionId ?? null,
      };
    },
    [scheduleSyncNow, updateStore],
  );

  const repairFailedLoggedGame = useCallback(
    async (payload: { game: GameListItem; players: LivePlayer[] }) => {
      const linkedCaptureItemId = payload.game.local_sync?.linkedQueueItemIds?.[0] ?? null;
      if (!linkedCaptureItemId) {
        throw new Error('This game is no longer linked to a background upload.');
      }

      const captureItem = storeRef.current.captureItems.find((entry) => entry.id === linkedCaptureItemId);
      if (!captureItem) {
        throw new Error('This game is no longer linked to a background upload.');
      }

      if (payload.game.local_sync?.syncState !== 'failed') {
        throw new Error('Only failed background-sync games can be repaired here.');
      }

      const currentTime = nowIso();
      const nextExtraction = buildLocalExtraction(payload.players);

      if (captureItem.sourceFlow === 'live_session') {
        if (!captureItem.serverLiveGameId) {
          throw new Error('This live session game is not ready to be repaired yet.');
        }

        await updateLiveSessionGame({
          liveGameId: captureItem.serverLiveGameId,
          players: payload.players,
        });

        updateStore((current) => {
          const currentItem = current.captureItems.find((entry) => entry.id === linkedCaptureItemId);
          if (!currentItem) {
            return current;
          }

          currentItem.extraction = nextExtraction;
          currentItem.status = 'ready_pending_finalize';
          currentItem.lastError = null;
          currentItem.nextRetryAt = null;
          currentItem.updatedAt = currentTime;

          const targetLiveSession = current.liveSessions.find(
            (entry) => entry.id === currentItem.liveSessionId,
          );
          if (targetLiveSession) {
            targetLiveSession.lastError = null;
            targetLiveSession.state = 'finalize_pending';
            targetLiveSession.updatedAt = currentTime;
          }

          const targetOperation = current.finalizeOperations.find(
            (entry) => entry.id === currentItem.finalizeOperationId,
          );
          if (targetOperation) {
            targetOperation.status = 'pending';
            targetOperation.lastError = null;
            targetOperation.nextRetryAt = null;
            targetOperation.updatedAt = currentTime;

            const selectedPlayer = buildOptimisticGameSelection(
              currentItem.extraction,
              targetLiveSession?.selectedPlayerKeys ?? [],
            );
            targetOperation.optimisticGames = targetOperation.optimisticGames.map((game) =>
              game.linkedCaptureItemId === currentItem.id
                ? {
                    ...game,
                    selectedPlayerKey: selectedPlayer.selectedPlayerKey,
                    selectedPlayerName: selectedPlayer.selectedPlayerName,
                  }
                : game,
            );
          }

          return current;
        });

        scheduleSyncNow();
        return;
      }

      if (!captureItem.serverDraftGameId) {
        throw new Error('This game is not ready to be repaired yet.');
      }

      const response = await updateRecordingDraftGame({
        mode: captureItem.sourceFlow as RecordingDraftMode,
        draftGameId: captureItem.serverDraftGameId,
        players: payload.players,
      });
      const responseDraft = response.draft;
      const responseGame = responseDraft?.groups
        .flatMap((group) => group.games)
        .find((entry) => entry.id === captureItem.serverDraftGameId);

      updateStore((current) => {
        const currentItem = current.captureItems.find((entry) => entry.id === linkedCaptureItemId);
        if (!currentItem) {
          return current;
        }

        currentItem.extraction = responseGame?.extraction ?? nextExtraction;
        currentItem.status = 'ready_pending_finalize';
        currentItem.lastError = null;
        currentItem.nextRetryAt = null;
        currentItem.updatedAt = currentTime;

        const targetDraft = current.drafts.find(
          (entry) => entry.id === currentItem.recordingDraftId,
        );
        if (targetDraft) {
          targetDraft.serverDraftId = responseDraft?.id ?? targetDraft.serverDraftId ?? null;
          targetDraft.selectedPlayerKeys =
            responseDraft?.selectedPlayerKeys ?? targetDraft.selectedPlayerKeys;
          targetDraft.lastError = null;
          targetDraft.state = 'finalize_pending';
          targetDraft.updatedAt = currentTime;
        }

        const targetOperation = current.finalizeOperations.find(
          (entry) => entry.id === currentItem.finalizeOperationId,
        );
        if (targetOperation) {
          targetOperation.status = 'pending';
          targetOperation.lastError = null;
          targetOperation.nextRetryAt = null;
          targetOperation.updatedAt = currentTime;

          const selectedPlayer = buildOptimisticGameSelection(
            currentItem.extraction,
            responseDraft?.selectedPlayerKeys ?? targetDraft?.selectedPlayerKeys ?? [],
          );
          targetOperation.optimisticGames = targetOperation.optimisticGames.map((game) =>
            game.linkedCaptureItemId === currentItem.id
              ? {
                  ...game,
                  selectedPlayerKey: selectedPlayer.selectedPlayerKey,
                  selectedPlayerName: selectedPlayer.selectedPlayerName,
                }
              : game,
          );
        }

        return current;
      });

      scheduleSyncNow();
    },
    [scheduleSyncNow, updateStore],
  );

  const retryEntry = useCallback(
    async (entryId: string) => {
      updateStore((current) => {
        const captureItem = current.captureItems.find((entry) => entry.id === entryId);
        if (captureItem) {
          captureItem.status =
            captureItem.serverLiveGameId || captureItem.serverDraftGameId
              ? 'processing_pending'
              : captureItem.storageKey
                ? 'uploaded'
                : 'captured_local';
          captureItem.lastError = null;
          captureItem.nextRetryAt = null;
          captureItem.updatedAt = nowIso();
        }

        const finalizeOperation = current.finalizeOperations.find((entry) => entry.id === entryId);
        if (finalizeOperation) {
          finalizeOperation.status = 'pending';
          finalizeOperation.lastError = null;
          finalizeOperation.nextRetryAt = null;
          finalizeOperation.updatedAt = nowIso();
        }

        return current;
      });
      scheduleSyncNow();
    },
    [scheduleSyncNow, updateStore],
  );

  const deleteEntry = useCallback(
    async (entryId: string) => {
      updateStore((current) => {
        const captureItem = current.captureItems.find((entry) => entry.id === entryId);
        if (captureItem) {
          deleteLocalUploadsProcessingFile(captureItem.localFileUri);
          current.captureItems = current.captureItems.filter((entry) => entry.id !== entryId);
          current.finalizeOperations = current.finalizeOperations.map((operation) => ({
            ...operation,
            linkedCaptureItemIds: operation.linkedCaptureItemIds.filter((captureId) => captureId !== entryId),
            optimisticSessions: operation.optimisticSessions.map((session) => ({
              ...session,
              linkedCaptureItemIds: session.linkedCaptureItemIds.filter((captureId) => captureId !== entryId),
            })),
            optimisticGames: operation.optimisticGames.filter(
              (game) => game.linkedCaptureItemId !== entryId,
            ),
          })).filter((operation) => operation.linkedCaptureItemIds.length > 0);
          return current;
        }

        const finalizeOperation = current.finalizeOperations.find((entry) => entry.id === entryId);
        if (finalizeOperation) {
          finalizeOperation.linkedCaptureItemIds.forEach((captureId) => {
            const linkedCapture = current.captureItems.find((entry) => entry.id === captureId);
            if (linkedCapture) {
              deleteLocalUploadsProcessingFile(linkedCapture.localFileUri);
            }
          });
          current.captureItems = current.captureItems.filter(
            (entry) => !finalizeOperation.linkedCaptureItemIds.includes(entry.id),
          );
          if (finalizeOperation.liveSessionId) {
            current.liveSessions = current.liveSessions.filter(
              (entry) => entry.id !== finalizeOperation.liveSessionId,
            );
          }
          if (finalizeOperation.recordingDraftId) {
            current.drafts = current.drafts.filter(
              (entry) => entry.id !== finalizeOperation.recordingDraftId,
            );
          }
          current.finalizeOperations = current.finalizeOperations.filter(
            (entry) => entry.id !== finalizeOperation.id,
          );
        }

        return current;
      });
    },
    [updateStore],
  );

  const contextValue = useMemo<UploadsProcessingContextValue>(
    () => ({
      store,
      summary: getUploadsProcessingSummary(store),
      ready,
      enqueueLiveCaptures,
      updateLiveSessionLocal,
      deleteLiveCapture,
      discardLiveSessionLocal,
      finalizeLiveSessionLocal,
      enqueueDraftCaptures,
      updateDraftLocal,
      updateDraftGroupLocal,
      deleteDraftCapture,
      discardDraftLocal,
      clearDraftLocalState,
      finalizeDraftLocal,
      retryEntry,
      deleteEntry,
      repairFailedLoggedGame,
      requestSyncNow: scheduleSyncNow,
    }),
    [
      deleteDraftCapture,
      deleteEntry,
      deleteLiveCapture,
      clearDraftLocalState,
      discardDraftLocal,
      discardLiveSessionLocal,
      enqueueDraftCaptures,
      enqueueLiveCaptures,
      finalizeDraftLocal,
      finalizeLiveSessionLocal,
      ready,
      repairFailedLoggedGame,
      retryEntry,
      scheduleSyncNow,
      store,
      updateDraftGroupLocal,
      updateDraftLocal,
      updateLiveSessionLocal,
    ],
  );

  return (
    <UploadsProcessingContext.Provider value={contextValue}>
      {children}
    </UploadsProcessingContext.Provider>
  );
}

export function useUploadsProcessing() {
  const context = useContext(UploadsProcessingContext);
  if (!context) {
    throw new Error('useUploadsProcessing must be used inside UploadsProcessingProvider.');
  }
  return context;
}
