import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StackActions, useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import EmptyStateCard from '@/components/empty-state-card';
import InfoBanner from '@/components/info-banner';
import InlineLoadingCard from '@/components/inline-loading-card';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import RecordingDraftGameCard from '@/components/recording-draft-game-card';
import RecordingDraftGameEditSheet from '@/components/recording-draft-game-edit-sheet';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import UploadsProcessingBanner from '@/components/uploads-processing-banner';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { confirmAction } from '@/lib/confirm';
import {
  discardRecordingDraft,
  deleteRecordingDraftGame,
  deleteRecordingDraftGroup,
  fetchRecordingDraft,
  fetchSessions,
  finalizeRecordingDraft,
  queryKeys,
  updateRecordingDraft,
  updateRecordingDraftGame,
  updateRecordingDraftGroup,
  reorderRecordingDraftGame,
} from '@/lib/backend';
import {
  canonicalizePlayerLabel,
  getFirstSelectionValidationError,
} from '@/lib/live-session';
import { localLogQueryKeys } from '@/hooks/use-logged-data';
import { syncLocalLogsForUser } from '@/lib/local-logs-sync';
import { navigateBackOrFallback } from '@/lib/navigation';
import { supabase } from '@/lib/supabase';
import type {
  RecordingDraftGame,
  RecordingDraftGroup,
  RecordingDraftMode,
  SessionItem,
  SessionMode,
} from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';
const MAX_IMAGE_COUNT = 100;
const NEW_SESSION_TARGET = '__new-session__';
const BASE_CONTENT_BOTTOM_PADDING = 156;

type UploadSessionFormProps = {
  title: string;
  playerLabel: string;
  imageLabel: string;
  helperText: string;
  sessionMode: SessionMode;
  addToLogHelperText?: string;
  requireExistingSession?: boolean;
};

type DraftFlatRow =
  | {
      key: string;
      kind: 'header';
      group: RecordingDraftGroup;
    }
  | {
      key: string;
      kind: 'game';
      groupId: string;
      gameNumber: number;
      game: RecordingDraftGame;
    };

function getDraftMode(sessionMode: SessionMode): RecordingDraftMode {
  switch (sessionMode) {
    case 'auto':
      return 'add_multiple_sessions';
    case 'existing':
      return 'add_existing_session';
    default:
      return 'upload_session';
  }
}

function getPrimaryButtonLabel(mode: RecordingDraftMode, hasTargetSession: boolean) {
  if (mode === 'add_existing_session') {
    return hasTargetSession ? 'Add to Session' : 'Add to Session';
  }
  return 'Add to Log';
}

function getFinalizeButtonLabel(mode: RecordingDraftMode) {
  return mode === 'add_existing_session' ? 'Add to Session' : 'Add to Log';
}

function getDraftEmptyState(mode: RecordingDraftMode) {
  switch (mode) {
    case 'upload_session':
      return {
        title: 'No scoreboards yet',
        body: 'Add scoreboard images to start building this session.',
      };
    case 'add_multiple_sessions':
      return {
        title: 'No scoreboards yet',
        body: 'Add scoreboard images and PinPoint will sort them into sessions.',
      };
    case 'add_existing_session':
      return {
        title: 'No scoreboards yet',
        body: 'Add scoreboard images, then choose which existing session they belong to.',
      };
  }
}

function getTargetSessionButtonLabel(targetSessionId: string | null) {
  return targetSessionId ? 'Change Existing Session' : 'Choose Existing Session';
}

function buildDraftFlatRows(groups: RecordingDraftGroup[]) {
  let gameNumber = 0;

  return groups.flatMap<DraftFlatRow>((group) => [
    {
      key: `header-${group.id}`,
      kind: 'header',
      group,
    },
    ...group.games.map((game) => ({
      key: `game-${game.id}`,
      kind: 'game' as const,
      groupId: group.id,
      gameNumber: (gameNumber += 1),
      game,
    })),
  ]);
}

function normalizeDraggedFlatRows(rows: DraftFlatRow[], draggedGameId: string) {
  const draggedIndex = rows.findIndex(
    (row) => row.kind === 'game' && row.game.id === draggedGameId,
  );
  if (draggedIndex < 0) {
    return rows;
  }

  let targetHeaderIndex = -1;
  for (let index = draggedIndex; index >= 0; index -= 1) {
    if (rows[index]?.kind === 'header') {
      targetHeaderIndex = index;
      break;
    }
  }

  if (targetHeaderIndex === -1) {
    targetHeaderIndex = rows.findIndex((row) => row.kind === 'header');
  }

  if (targetHeaderIndex === -1 || draggedIndex > targetHeaderIndex) {
    return rows;
  }

  const nextRows = [...rows];
  const [draggedRow] = nextRows.splice(draggedIndex, 1);
  nextRows.splice(targetHeaderIndex, 0, draggedRow);
  return nextRows;
}

function deriveDraftReorderPayload(
  rows: DraftFlatRow[],
  draggedGameId: string,
) {
  const draggedIndex = rows.findIndex(
    (row) => row.kind === 'game' && row.game.id === draggedGameId,
  );
  if (draggedIndex < 0) {
    return null;
  }

  let headerIndex = -1;
  for (let index = draggedIndex; index >= 0; index -= 1) {
    if (rows[index]?.kind === 'header') {
      headerIndex = index;
      break;
    }
  }

  if (headerIndex === -1) {
    headerIndex = rows.findIndex((row) => row.kind === 'header');
  }

  const headerRow = headerIndex >= 0 ? rows[headerIndex] : null;
  if (!headerRow || headerRow.kind !== 'header') {
    return null;
  }

  let beforeGameId: string | null = null;
  for (let index = draggedIndex - 1; index > headerIndex; index -= 1) {
    const row = rows[index];
    if (row?.kind === 'game') {
      beforeGameId = row.game.id;
      break;
    }
  }

  let afterGameId: string | null = null;
  for (let index = draggedIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.kind === 'header') {
      break;
    }
    afterGameId = row.game.id;
    break;
  }

  return {
    targetGroupId: headerRow.group.id,
    beforeGameId,
    afterGameId,
  };
}

function getProgressSecondaryText(group: {
  ready: number;
  error: number;
  queued: number;
  processing: number;
}) {
  const processing = group.queued + group.processing;
  return `${group.ready} ready • ${group.error} failed • ${processing} processing`;
}

function getGroupTitle(group: RecordingDraftGroup) {
  const trimmed = group.name?.trim();
  return trimmed ? trimmed : 'Unnamed Session';
}

function getGroupDateLines(group: RecordingDraftGroup) {
  const firstTimestamp =
    group.games
      .map((game) => game.sort_at || game.captured_at || game.captured_at_hint || game.created_at)
      .find(Boolean) ?? null;

  if (!firstTimestamp) {
    return ['Date', '—'];
  }

  const date = new Date(firstTimestamp);
  if (Number.isNaN(date.getTime())) {
    return ['Date', '—'];
  }

  return [
    date.toLocaleDateString('en-US', { month: 'short' }),
    date.toLocaleDateString('en-US', { day: 'numeric' }),
  ];
}

function flattenDraftGames(groups: RecordingDraftGroup[]) {
  return groups.flatMap((group) => group.games);
}

function formatTargetSessionLabel(
  targetSessionId: string | null,
  sessions: SessionItem[],
) {
  if (!targetSessionId) {
    return 'No session selected yet.';
  }
  if (targetSessionId === NEW_SESSION_TARGET) {
    return 'New Session';
  }

  const session = sessions.find((entry) => entry.id === targetSessionId);
  return session?.name?.trim() || 'Untitled Session';
}

function PendingDraftGameCard({
  gameNumber,
  game,
  onDelete,
  deleting,
  onStartDrag,
  dragActive,
}: {
  gameNumber: number;
  game: RecordingDraftGame;
  onDelete: (gameId: string) => void;
  deleting: boolean;
  onStartDrag?: () => void;
  dragActive?: boolean;
}) {
  return (
    <View style={[styles.pendingCard, dragActive && styles.pendingCardActive]}>
      <View style={styles.pendingCardRow}>
        <View style={styles.pendingSummary}>
          <StackBadge lines={['Game', String(gameNumber)]} />
          <View style={styles.pendingTextBlock}>
            <Text style={styles.pendingTitle}>
              {game.status === 'error' ? 'Scoreboard needs attention' : 'Processing scoreboard'}
            </Text>
            {game.last_error ? <Text style={styles.pendingError}>{game.last_error}</Text> : null}
          </View>
        </View>
        <View style={styles.pendingActions}>
          {onStartDrag ? (
            <Pressable
              accessibilityLabel="Reorder draft game"
              delayLongPress={140}
              onLongPress={onStartDrag}
              style={({ pressed }) => [styles.pendingDeleteButton, pressed && styles.pressed]}>
              <MaterialIcons name="drag-indicator" size={22} color={palette.muted} />
            </Pressable>
          ) : null}
          {game.status === 'queued' || game.status === 'processing' ? (
            <BowlingBallSpinner size={22} holeColor={palette.field} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              confirmAction({
                title: 'Delete game',
                message: 'Remove this scoreboard from the draft?',
                confirmLabel: 'Delete',
                destructive: true,
                onConfirm: () => onDelete(game.id),
              })
            }
            style={({ pressed }) => [styles.pendingDeleteButton, pressed && styles.pressed]}>
            {deleting ? (
              <BowlingBallSpinner size={18} holeColor={palette.field} />
            ) : (
              <MaterialIcons name="delete" size={22} color={palette.text} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function UploadSessionForm({
  helperText,
  sessionMode,
  addToLogHelperText,
}: UploadSessionFormProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { user, session } = useAuth();
  const {
    clearDraftLocalState,
    deleteDraftCapture,
    discardDraftLocal,
    enqueueDraftCaptures,
    finalizeDraftLocal,
    updateDraftGroupLocal,
    updateDraftLocal,
  } = useUploadsProcessing();
  const mode = useMemo(() => getDraftMode(sessionMode), [sessionMode]);
  const emptyState = useMemo(() => getDraftEmptyState(mode), [mode]);

  const [error, setError] = useState('');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<RecordingDraftGame | null>(null);
  const [deletingGameIds, setDeletingGameIds] = useState<string[]>([]);
  const [editingGroup, setEditingGroup] = useState<RecordingDraftGroup | null>(null);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupDraftDescription, setGroupDraftDescription] = useState('');
  const [finalizeName, setFinalizeName] = useState('');
  const [finalizeDescription, setFinalizeDescription] = useState('');
  const [targetSessionId, setTargetSessionId] = useState<string | null>(null);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [sessionPickerChoice, setSessionPickerChoice] = useState<string | null>(null);
  const [flatRows, setFlatRows] = useState<DraftFlatRow[]>([]);
  const [bottomDockHeight, setBottomDockHeight] = useState(0);
  const scrollRef = useRef<any>(null);
  const flatListRef = useRef<any>(null);
  const pendingScrollGameIdRef = useRef<string | null>(null);
  const gameLayoutYRef = useRef<Record<string, number>>({});
  const gameListYRef = useRef(0);
  const selectionRevisionRef = useRef(0);

  const draftQuery = useQuery({
    queryKey: queryKeys.recordingDraft(mode),
    queryFn: () => fetchRecordingDraft(mode),
    refetchInterval: (query) => {
      const data = query.state.data as { draft: { progress?: { queued: number; processing: number } } | null } | undefined;
      const hasProcessing =
        (data?.draft?.progress?.queued ?? 0) > 0 || (data?.draft?.progress?.processing ?? 0) > 0;
      return hasProcessing ? 2500 : false;
    },
  });

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    enabled: mode === 'add_existing_session',
  });

  const draft = draftQuery.data?.draft ?? null;
  const isInitialDraftLoading = draftQuery.isPending && !draftQuery.data;
  const isInitialSessionsLoading =
    mode === 'add_existing_session' && sessionsQuery.isPending && !sessionsQuery.data;
  const groups = draft?.groups ?? [];
  const allGames = useMemo(() => groups.flatMap((group) => group.games), [groups]);
  const readyGames = useMemo(() => allGames.filter((game) => game.status === 'ready'), [allGames]);
  const selectedPlayerKeys = draft?.selectedPlayerKeys ?? [];
  const playerOptions = draft?.playerOptions ?? [];
  const progress = draft?.progress ?? null;
  const progressVisible = Boolean(progress && progress.total > 1);
  const selectionError = useMemo(
    () => getFirstSelectionValidationError(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );
  const processingGameCount = allGames.filter(
    (game) => game.status === 'queued' || game.status === 'processing',
  ).length;
  const failedGameCount = allGames.filter((game) => game.status === 'error').length;
  const hasProcessing = processingGameCount > 0;
  const hasFailedGames = failedGameCount > 0;
  const hasVisibleGames = allGames.length > 0;
  const finalizeBlockers = [
    ...(!hasVisibleGames ? ['Add at least one scoreboard before continuing.'] : []),
    ...(processingGameCount > 0
      ? [
          `${processingGameCount} scoreboard${
            processingGameCount === 1 ? '' : 's'
          } still processing.`,
        ]
      : []),
    ...(failedGameCount > 0
      ? [
          `${failedGameCount} scoreboard${
            failedGameCount === 1 ? '' : 's'
          } ${failedGameCount === 1 ? 'needs' : 'need'} attention.`,
        ]
      : []),
    ...(selectionError ? [selectionError] : []),
    ...(mode === 'add_existing_session' && !targetSessionId
      ? ['Choose an existing session before continuing.']
      : []),
  ];
  const canFinalize =
    hasVisibleGames &&
    readyGames.length === allGames.length &&
    !hasProcessing &&
    !hasFailedGames &&
    !selectionError &&
    (mode !== 'add_existing_session' || Boolean(targetSessionId));

  useEffect(() => {
    if (!draft) {
      setFinalizeName('');
      setFinalizeDescription('');
      if (mode !== 'add_existing_session') {
        setTargetSessionId(null);
      }
      return;
    }

    if (mode === 'add_existing_session') {
      setTargetSessionId(draft.targetSessionId ?? null);
    }
  }, [draft?.id, draft?.targetSessionId, mode]);

  useEffect(() => {
    if (!editingGroup) {
      setGroupDraftName('');
      setGroupDraftDescription('');
      return;
    }

    setGroupDraftName(editingGroup.name?.trim() || '');
    setGroupDraftDescription(editingGroup.description?.trim() || '');
  }, [editingGroup]);

  useEffect(() => {
    if (!sessionPickerOpen) {
      return;
    }
    setSessionPickerChoice(targetSessionId);
  }, [sessionPickerOpen, targetSessionId]);

  const sessions = sessionsQuery.data?.sessions ?? [];
  const groupedFlatRows = useMemo(() => buildDraftFlatRows(groups), [groups]);
  const contentContainerStyle = useMemo(
    () => [
      styles.container,
      mode === 'add_multiple_sessions' ? styles.draggableContainer : styles.scrollContainer,
      draft
        ? { paddingBottom: Math.max(BASE_CONTENT_BOTTOM_PADDING, bottomDockHeight + spacing.xl) }
        : null,
    ],
    [bottomDockHeight, draft, mode],
  );

  useEffect(() => {
    if (mode !== 'add_multiple_sessions') {
      return;
    }
    setFlatRows(groupedFlatRows);
  }, [groupedFlatRows, mode]);

  const setDraftCache = (next: { draft: typeof draft }) => {
    queryClient.setQueryData(queryKeys.recordingDraft(mode), next);
  };

  const isDeletingGame = (gameId: string) => deletingGameIds.includes(gameId);

  const scrollToDraftGame = (gameId: string) => {
    const targetIndex = mode === 'add_multiple_sessions'
      ? flatRows.findIndex((row) => row.key === `game-${gameId}`)
      : -1;
    const targetY =
      mode === 'add_multiple_sessions'
        ? null
        : typeof gameLayoutYRef.current[gameId] === 'number'
          ? Math.max(0, gameListYRef.current + gameLayoutYRef.current[gameId] - spacing.sm)
          : null;

    if (mode === 'add_multiple_sessions' && targetIndex < 0) {
      return false;
    }
    if (mode !== 'add_multiple_sessions' && targetY === null) {
      return false;
    }

    requestAnimationFrame(() => {
      if (mode === 'add_multiple_sessions') {
        flatListRef.current?.scrollToIndex?.({
          index: targetIndex,
          animated: true,
          viewPosition: 0.2,
        });
      } else {
        scrollRef.current?.scrollTo?.({
          y: targetY,
          animated: true,
        });
      }
    });
    return true;
  };

  const handleDraftGameLayout = (
    gameId: string,
    y: number,
    status: RecordingDraftGame['status'],
  ) => {
    gameLayoutYRef.current[gameId] = y;
    if (
      status !== 'ready' &&
      pendingScrollGameIdRef.current === gameId &&
      scrollToDraftGame(gameId)
    ) {
      pendingScrollGameIdRef.current = null;
    }
  };

  useEffect(() => {
    const pendingScrollGameId = pendingScrollGameIdRef.current;
    if (!pendingScrollGameId) {
      return;
    }

    const targetGame = allGames.find((game) => game.id === pendingScrollGameId);
    if (!targetGame || targetGame.status === 'ready') {
      return;
    }

    if (scrollToDraftGame(pendingScrollGameId)) {
      pendingScrollGameIdRef.current = null;
    }
  }, [allGames, flatRows, mode]);

  const uploadMutation = useMutation({
    mutationFn: async (assets: ImagePicker.ImagePickerAsset[]) => {
      if (!user) {
        throw new Error('You must be signed in before uploading scoreboards.');
      }
      await enqueueDraftCaptures({
        mode,
        draft,
        assets,
      });
      return true;
    },
    onSuccess: async (didQueue) => {
      if (!didQueue) {
        return;
      }
      pendingScrollGameIdRef.current = null;
      setError('');
      await Promise.resolve();
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to upload scoreboards.');
    },
  });

  const selectionMutation = useMutation({
    mutationFn: async ({
      nextSelectedPlayerKeys,
    }: {
      nextSelectedPlayerKeys: string[];
      revision: number;
    }) =>
      updateRecordingDraft({
        mode,
        selectedPlayerKeys: nextSelectedPlayerKeys,
      }),
    onSuccess: (response, variables) => {
      if (variables.revision !== selectionRevisionRef.current) {
        return;
      }
      setError('');
      const responsePayload = response as { draft: typeof draft };
      setDraftCache({
        ...responsePayload,
        draft: responsePayload.draft
          ? {
              ...responsePayload.draft,
              selectedPlayerKeys: variables.nextSelectedPlayerKeys,
            }
          : responsePayload.draft,
      });
    },
    onError: (nextError, variables) => {
      if (variables.revision !== selectionRevisionRef.current) {
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Failed to update selected players.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft(mode) });
    },
  });

  const editGameMutation = useMutation({
    mutationFn: (payload: { draftGameId: string; players: Parameters<typeof updateRecordingDraftGame>[0]['players'] }) =>
      updateRecordingDraftGame({
        mode,
        draftGameId: payload.draftGameId,
        players: payload.players,
      }),
    onSuccess: (response) => {
      setEditingGame(null);
      setError('');
      setDraftCache(response as { draft: typeof draft });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save draft game.');
    },
  });

  const deleteGameMutation = useMutation({
    mutationFn: async (draftGameId: string) => {
      const localDeleteResult = await deleteDraftCapture({ mode, visibleGameId: draftGameId });
      if (!localDeleteResult.remoteDeleteRequired) {
        return { deletedLocally: true };
      }
      const response = await deleteRecordingDraftGame(mode, draftGameId);
      return { ...response, deletedLocally: false };
    },
    onMutate: (draftGameId) => {
      setDeletingGameIds((current) =>
        current.includes(draftGameId) ? current : [...current, draftGameId],
      );
    },
    onSuccess: async (response) => {
      setError('');
      if (!response.deletedLocally) {
        setDraftCache(response as { draft: typeof draft });
        await queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus });
      }
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete draft game.');
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft(mode) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onSettled: (_data, _error, draftGameId) => {
      setDeletingGameIds((current) => current.filter((entry) => entry !== draftGameId));
    },
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      const discardedLocally = await discardDraftLocal({ mode, draft });
      if (discardedLocally) {
        return { discardedLocally: true };
      }
      const response = await discardRecordingDraft(mode);
      return { ...response, discardedLocally: false };
    },
    onSuccess: async (response) => {
      if (!response.discardedLocally) {
        await clearDraftLocalState({ mode, draft });
      }
      setError('');
      setFinalizeOpen(false);
      setEditingGame(null);
      setEditingGroup(null);
      setDraftCache({ draft: null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft(mode) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to discard draft.');
    },
  });

  const saveGroupMutation = useMutation({
    mutationFn: () => {
      if (!editingGroup) {
        throw new Error('Group was not selected.');
      }

      updateDraftGroupLocal({
        mode,
        draftGroupId: editingGroup.id,
        name: groupDraftName,
        description: groupDraftDescription,
      });

      return updateRecordingDraftGroup({
        mode,
        groupId: editingGroup.id,
        name: groupDraftName,
        description: groupDraftDescription,
      });
    },
    onSuccess: (response) => {
      setError('');
      setEditingGroup(null);
      setDraftCache(response as { draft: typeof draft });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update draft session.');
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) =>
      deleteRecordingDraftGroup({
        mode,
        groupId,
      }),
    onSuccess: async (response) => {
      setError('');
      setDraftCache(response as { draft: typeof draft });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete draft session.');
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (payload: {
      gameId: string;
      targetGroupId?: string | null;
      beforeGameId?: string | null;
      afterGameId?: string | null;
    }) =>
      reorderRecordingDraftGame({
        mode,
        gameId: payload.gameId,
        targetGroupId: payload.targetGroupId,
        beforeGameId: payload.beforeGameId,
        afterGameId: payload.afterGameId,
      }),
    onSuccess: (response) => {
      setError('');
      setDraftCache(response as { draft: typeof draft });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to reorder draft game.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft(mode) });
    },
  });

  const chooseTargetSessionMutation = useMutation({
    mutationFn: async (nextTargetSessionId: string) =>
      updateRecordingDraft({
        mode,
        targetSessionId: nextTargetSessionId,
      }),
    onSuccess: (response) => {
      setError('');
      setTargetSessionId(
        (response as { draft: { targetSessionId?: string | null } | null }).draft?.targetSessionId ?? null,
      );
      setDraftCache(response as { draft: typeof draft });
      setSessionPickerOpen(false);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to choose session.');
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () =>
      finalizeDraftLocal({
        mode,
        draft,
        targetSessionId: mode === 'add_existing_session' ? targetSessionId : undefined,
        targetSessionName:
          mode === 'add_existing_session'
            ? formatTargetSessionLabel(targetSessionId, sessions)
            : undefined,
        name: mode === 'upload_session' ? finalizeName : undefined,
        description: mode === 'upload_session' ? finalizeDescription : undefined,
      }),
    onSuccess: async () => {
      setError('');
      if (user) {
        await syncLocalLogsForUser(user.id, session?.access_token ?? null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        user
          ? queryClient.invalidateQueries({ queryKey: localLogQueryKeys.games(user.id) })
          : Promise.resolve(),
        user
          ? queryClient.invalidateQueries({ queryKey: localLogQueryKeys.gameRoot(user.id) })
          : Promise.resolve(),
      ]);
      navigation.dispatch(StackActions.popToTop());
      router.replace('/(tabs)/sessions' as never);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to add draft to log.');
    },
  });

  const handlePickImages = async () => {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGE_COUNT,
      exif: true,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    uploadMutation.mutate(result.assets.slice(0, MAX_IMAGE_COUNT));
  };

  const handleTogglePlayer = (playerKey: string) => {
    if (!draft) {
      return;
    }

    const nextSelectedPlayerKeys = selectedPlayerKeys.includes(playerKey)
      ? selectedPlayerKeys.filter((entry) => entry !== playerKey)
      : [...selectedPlayerKeys, playerKey];

    setDraftCache({
      draft: {
        ...draft,
        selectedPlayerKeys: nextSelectedPlayerKeys,
      },
    });
    updateDraftLocal({
      mode,
      draftId: draft.local_sync?.localId ?? draft.id,
      selectedPlayerKeys: nextSelectedPlayerKeys,
    });

    selectionRevisionRef.current += 1;
    selectionMutation.mutate({
      nextSelectedPlayerKeys,
      revision: selectionRevisionRef.current,
    });
  };

  const handleOpenPrimaryAction = () => {
    if (!canFinalize) {
      return;
    }

    setFinalizeName(draft?.name ?? '');
    setFinalizeDescription(draft?.description ?? '');
    setFinalizeOpen(true);
  };

  const handleChooseTargetSession = () => {
    setSessionPickerOpen(true);
  };

  const handleDiscardDraft = () => {
    confirmAction({
      title: 'Discard draft',
      message: 'This removes the current recording draft and its uploaded scoreboards.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => discardMutation.mutate(),
    });
  };

  const renderGroupHeader = (group: RecordingDraftGroup) => (
    <View style={styles.groupHeader}>
      <View style={styles.groupHeaderMain}>
        <StackBadge lines={getGroupDateLines(group)} />
        <View style={styles.groupHeaderText}>
          <Text style={styles.groupTitle}>{getGroupTitle(group)}</Text>
          {group.description ? (
            <Text style={styles.groupDescription}>{group.description}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.groupActions}>
        <Pressable
          onPress={() => setEditingGroup(group)}
          style={({ pressed }) => [styles.groupActionButton, pressed && styles.pressed]}>
          <MaterialIcons name="edit" size={20} color={palette.text} />
        </Pressable>
        <Pressable
          onPress={() =>
            confirmAction({
              title: 'Delete draft session',
              message: 'Remove this grouped session draft and all of its games?',
              confirmLabel: 'Delete',
              destructive: true,
              onConfirm: () => deleteGroupMutation.mutate(group.id),
            })
          }
          style={({ pressed }) => [styles.groupActionButton, pressed && styles.pressed]}>
          <MaterialIcons name="delete" size={20} color={palette.text} />
        </Pressable>
      </View>
    </View>
  );

  const topContent = (
    <View style={styles.topContent}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigateBackOrFallback(router, '/(tabs)/record', navigation)}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={16} color={palette.muted} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        {draft ? (
          <Pressable
            onPress={handleDiscardDraft}
            disabled={discardMutation.isPending}
            style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}>
            {discardMutation.isPending ? (
              <BowlingBallSpinner size={16} color={palette.text} holeColor={palette.field} />
            ) : (
              <MaterialIcons name="delete-outline" size={18} color={palette.text} />
            )}
            <Text style={styles.discardText}>
              {discardMutation.isPending ? 'Discarding draft...' : 'Discard Draft'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <InfoBanner tone="error" text={error} /> : null}
      {draftQuery.error ? (
        <InfoBanner
          tone="error"
          text={draftQuery.error instanceof Error ? draftQuery.error.message : 'Failed to load draft.'}
        />
      ) : null}
      <UploadsProcessingBanner sourceFlow={mode} />
      {isInitialDraftLoading ? <InlineLoadingCard label="Loading draft..." /> : null}
      {isInitialSessionsLoading ? <InlineLoadingCard label="Loading sessions..." /> : null}

      <SurfaceCard style={styles.sectionCard}>
        <Text style={styles.sectionBody}>{helperText}</Text>
        <ActionButton
          label={uploadMutation.isPending ? 'Adding games...' : 'Scoreboard Images'}
          leftIcon={
            uploadMutation.isPending ? (
              <BowlingBallSpinner size={18} color={palette.text} holeColor={palette.accent} />
            ) : (
              <Ionicons name="images-outline" size={18} color={palette.text} />
            )
          }
          onPress={handlePickImages}
          disabled={uploadMutation.isPending}
        />
      </SurfaceCard>

      {progressVisible && progress ? (
        <SurfaceCard style={styles.progressCard}>
          <Text style={styles.progressTitle}>
            {progress.completed} of {progress.total} processed
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: progress.total ? `${(progress.completed / progress.total) * 100}%` : '0%' },
              ]}
            />
          </View>
          <Text style={styles.progressMeta}>{getProgressSecondaryText(progress)}</Text>
        </SurfaceCard>
      ) : null}

      {draft ? (
        <SurfaceCard style={styles.sectionCard}>
          <Text style={styles.sectionBody}>{'Who are you?\n(may select multiple)'}</Text>
          {playerOptions.length === 0 ? (
            <Text style={styles.sectionBody}>Add a scoreboard to start extracting player names.</Text>
          ) : (
            <View style={styles.checkboxList}>
              {playerOptions.map((option) => {
                const checked = selectedPlayerKeys.includes(option.key);
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => handleTogglePlayer(option.key)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}>
                    <MaterialIcons
                      name={checked ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={checked ? palette.accent : palette.muted}
                    />
                    <Text style={styles.checkboxLabel}>{canonicalizePlayerLabel(option.label)}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </SurfaceCard>
      ) : null}
    </View>
  );

  const renderFlatRow = ({ item, drag, isActive, getIndex }: RenderItemParams<DraftFlatRow>) => {
    const index = getIndex() ?? flatRows.findIndex((row) => row.key === item.key);
    const previousRow = index > 0 ? flatRows[index - 1] : null;

    if (item.kind === 'header') {
      return (
        <View style={[styles.flatHeaderRow, index > 0 && styles.flatHeaderRowSpaced]}>
          {renderGroupHeader(item.group)}
        </View>
      );
    }

    return (
      <ScaleDecorator>
        <View
          onLayout={(event) => {
            handleDraftGameLayout(item.game.id, event.nativeEvent.layout.y, item.game.status);
          }}
          style={[
            styles.flatGameRow,
            previousRow?.kind === 'header'
              ? styles.flatGameRowAfterHeader
              : styles.flatGameRowAfterGame,
          ]}>
          {item.game.status === 'ready' ? (
            <RecordingDraftGameCard
              game={item.game}
              gameNumber={item.gameNumber}
              selectedPlayerKeys={selectedPlayerKeys}
              deleting={isDeletingGame(item.game.id)}
              onEdit={setEditingGame}
              onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
              onStartDrag={drag}
              dragActive={isActive}
            />
          ) : (
            <PendingDraftGameCard
              gameNumber={item.gameNumber}
              game={item.game}
              deleting={isDeletingGame(item.game.id)}
              onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
              onStartDrag={drag}
              dragActive={isActive}
            />
          )}
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <>
      {mode === 'add_multiple_sessions' ? (
        <DraggableFlatList
          ref={flatListRef}
          data={flatRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          activationDistance={8}
          dragItemOverflow
          ListHeaderComponent={topContent}
          ListEmptyComponent={
            isInitialDraftLoading ? (
              <InlineLoadingCard label="Loading scoreboards..." />
            ) : (
              <EmptyStateCard title={emptyState.title} body={emptyState.body} />
            )
          }
          renderItem={renderFlatRow}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatListRef.current?.scrollToOffset?.({
              offset: Math.max(0, averageItemLength * index - spacing.lg),
              animated: true,
            });
          }}
          onDragEnd={({ data, from, to }) => {
            if (from === to) {
              setFlatRows(data);
              return;
            }

            const draggedRow = data[to];
            if (!draggedRow || draggedRow.kind !== 'game') {
              setFlatRows(groupedFlatRows);
              return;
            }

            const normalizedRows = normalizeDraggedFlatRows(data, draggedRow.game.id);
            setFlatRows(normalizedRows);

            const payload = deriveDraftReorderPayload(normalizedRows, draggedRow.game.id);
            if (!payload) {
              return;
            }

            reorderMutation.mutate({
              gameId: draggedRow.game.id,
              ...payload,
            });
          }}
        />
      ) : (
        <KeyboardAwareScrollView
          ref={scrollRef}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}>
          {topContent}

          {isInitialDraftLoading ? (
            <InlineLoadingCard label="Loading scoreboards..." />
          ) : groups.length > 0 ? (
            <View
              style={styles.groupList}
              onLayout={(event) => {
                gameListYRef.current = event.nativeEvent.layout.y;
              }}>
              {allGames.map((game, index) =>
                game.status === 'ready' ? (
                  <View
                    key={game.id}
                    onLayout={(event) => {
                      handleDraftGameLayout(game.id, event.nativeEvent.layout.y, game.status);
                    }}>
                    <RecordingDraftGameCard
                      game={game}
                      gameNumber={index + 1}
                      selectedPlayerKeys={selectedPlayerKeys}
                      deleting={isDeletingGame(game.id)}
                      onEdit={setEditingGame}
                      onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
                    />
                  </View>
                ) : (
                  <View
                    key={game.id}
                    onLayout={(event) => {
                      handleDraftGameLayout(game.id, event.nativeEvent.layout.y, game.status);
                    }}>
                    <PendingDraftGameCard
                      gameNumber={index + 1}
                      game={game}
                      deleting={isDeletingGame(game.id)}
                      onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
                    />
                  </View>
                ),
              )}
            </View>
          ) : (
            <EmptyStateCard title={emptyState.title} body={emptyState.body} />
          )}
        </KeyboardAwareScrollView>
      )}

      {draft ? (
        <View
          style={styles.bottomDock}
          onLayout={(event) => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height) + spacing.md;
            setBottomDockHeight((current) => (current === nextHeight ? current : nextHeight));
          }}>
          {mode === 'upload_session' ? (
            <Text style={styles.dockNote}>All of these games will go into one session.</Text>
          ) : mode === 'add_multiple_sessions' ? (
            <Text style={styles.dockNote}>
              These grouped scoreboards will each become a session when you add them to your log.
            </Text>
          ) : !targetSessionId ? (
            <Text style={styles.dockNote}>Pick which existing session these scoreboards should go into.</Text>
          ) : (
            <Text style={styles.dockNote}>
              Adding to: {formatTargetSessionLabel(targetSessionId, sessions)}
            </Text>
          )}

          {finalizeBlockers.map((message) => (
            <Text key={message} style={styles.dockNote}>
              {message}
            </Text>
          ))}
          {addToLogHelperText ? <Text style={styles.dockSubnote}>{addToLogHelperText}</Text> : null}
          {mode === 'add_existing_session' ? (
            <ActionButton
              label={getTargetSessionButtonLabel(targetSessionId)}
              onPress={handleChooseTargetSession}
              variant="secondary"
            />
          ) : null}
          <ActionButton
            label={getPrimaryButtonLabel(mode, Boolean(targetSessionId))}
            onPress={handleOpenPrimaryAction}
            disabled={!canFinalize}
          />
        </View>
      ) : null}

      <Modal transparent animationType="fade" visible={sessionPickerOpen} onRequestClose={() => setSessionPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Choose Existing Session</Text>
            <Text style={styles.modalBody}>Select where these scoreboards should be added.</Text>
            <KeyboardAwareScrollView
              style={styles.targetList}
              contentContainerStyle={styles.targetListContent}
              showsVerticalScrollIndicator={false}>
              <Pressable
                onPress={() => setSessionPickerChoice(NEW_SESSION_TARGET)}
                style={({ pressed }) => [
                  styles.targetButton,
                  sessionPickerChoice === NEW_SESSION_TARGET && styles.targetButtonActive,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.targetButtonText, styles.targetButtonTextAccent]}>New Session</Text>
              </Pressable>
              {sessions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => setSessionPickerChoice(session.id)}
                  style={({ pressed }) => [
                    styles.targetButton,
                    sessionPickerChoice === session.id && styles.targetButtonActive,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.targetButtonText}>{session.name?.trim() || 'Untitled Session'}</Text>
                </Pressable>
              ))}
            </KeyboardAwareScrollView>
            <ActionButton
              label={chooseTargetSessionMutation.isPending ? 'Add to Session' : 'Add to Session'}
              onPress={() => {
                if (!sessionPickerChoice) {
                  return;
                }
                setTargetSessionId(sessionPickerChoice);
                updateDraftLocal({
                  mode,
                  draftId: draft?.local_sync?.localId ?? draft?.id,
                  targetSessionId: sessionPickerChoice,
                  targetSessionName: formatTargetSessionLabel(sessionPickerChoice, sessions),
                });
                chooseTargetSessionMutation.mutate(sessionPickerChoice);
              }}
              disabled={!sessionPickerChoice || chooseTargetSessionMutation.isPending}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setSessionPickerOpen(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>

      <Modal transparent animationType="fade" visible={finalizeOpen} onRequestClose={() => setFinalizeOpen(false)}>
        <KeyboardAwareScrollView
          style={styles.modalKeyboardScroll}
          contentContainerStyle={styles.modalScrollContent}
          extraScrollHeight={112}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>{getFinalizeButtonLabel(mode)}</Text>
            <Text style={styles.modalBody}>
              {mode === 'add_existing_session'
                ? `These scoreboards will appear in your Sessions list immediately under ${formatTargetSessionLabel(targetSessionId, sessions)}. Finalizing them on the server will continue in the background.`
                : 'This will appear in your Sessions list immediately. Finalizing it on the server will continue in the background.'}
            </Text>
            <View style={styles.summaryList}>
              <Text style={styles.summaryLine}>Ready scoreboards: {readyGames.length}</Text>
              <Text style={styles.summaryLine}>
                Selected names: {selectedPlayerKeys.map(canonicalizePlayerLabel).join(', ') || 'None'}
              </Text>
            </View>
            {mode === 'upload_session' ? (
              <>
                <Text style={styles.modalHint}>
                  Optionally rename the session or add a description before logging it.
                </Text>
                <TextInput
                  placeholder="Session name (optional)"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={finalizeName}
                  onChangeText={(value) => {
                    setFinalizeName(value);
                    updateDraftLocal({
                      mode,
                      draftId: draft?.local_sync?.localId ?? draft?.id,
                      name: value,
                    });
                  }}
                />
                <TextInput
                  placeholder="Description (optional)"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, styles.descriptionInput]}
                  multiline
                  value={finalizeDescription}
                  onChangeText={(value) => {
                    setFinalizeDescription(value);
                    updateDraftLocal({
                      mode,
                      draftId: draft?.local_sync?.localId ?? draft?.id,
                      description: value,
                    });
                  }}
                />
              </>
            ) : null}
            <ActionButton
              label={finalizeMutation.isPending ? getFinalizeButtonLabel(mode) : getFinalizeButtonLabel(mode)}
              onPress={() => finalizeMutation.mutate()}
              loading={finalizeMutation.isPending}
              disabled={finalizeMutation.isPending || !canFinalize}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setFinalizeOpen(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </KeyboardAwareScrollView>
      </Modal>

      <Modal transparent animationType="fade" visible={Boolean(editingGroup)} onRequestClose={() => setEditingGroup(null)}>
        <KeyboardAwareScrollView
          style={styles.modalKeyboardScroll}
          contentContainerStyle={styles.modalScrollContent}
          extraScrollHeight={112}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Edit Draft Session</Text>
            <TextInput
              placeholder="Session name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={groupDraftName}
              onChangeText={setGroupDraftName}
            />
            <TextInput
              placeholder="Description"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.descriptionInput]}
              multiline
              value={groupDraftDescription}
              onChangeText={setGroupDraftDescription}
            />
            <ActionButton
              label={saveGroupMutation.isPending ? 'Saving...' : 'Save draft session'}
              onPress={() => saveGroupMutation.mutate()}
              disabled={saveGroupMutation.isPending}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setEditingGroup(null)}
              variant="secondary"
            />
          </SurfaceCard>
        </KeyboardAwareScrollView>
      </Modal>

      <RecordingDraftGameEditSheet
        visible={Boolean(editingGame)}
        game={editingGame}
        selectedPlayerKeys={selectedPlayerKeys}
        saving={editGameMutation.isPending}
        errorText={editGameMutation.isError ? error : ''}
        onClose={() => setEditingGame(null)}
        onSave={(payload) => editGameMutation.mutate(payload)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: BASE_CONTENT_BOTTOM_PADDING,
  },
  scrollContainer: {
    gap: spacing.md,
  },
  draggableContainer: {
    gap: 0,
  },
  topContent: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  sectionCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  sectionBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  progressCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  progressTitle: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  progressTrack: {
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
  },
  progressMeta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  discardButton: {
    minHeight: 40,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  discardText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  checkboxList: {
    gap: spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkboxLabel: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  groupList: {
    gap: spacing.lg,
  },
  groupWrap: {
    gap: spacing.sm,
  },
  flatHeaderRow: {
    gap: spacing.sm,
  },
  flatHeaderRowSpaced: {
    marginTop: spacing.lg,
  },
  flatGameRow: {
    gap: 0,
  },
  flatGameRowAfterHeader: {
    marginTop: spacing.sm,
  },
  flatGameRowAfterGame: {
    marginTop: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  groupHeaderMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    flex: 1,
  },
  groupHeaderText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  groupTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  groupDescription: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  groupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupActionButton: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceRaised,
  },
  gameList: {
    gap: 8,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  emptyBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  pendingCard: {
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  pendingCardActive: {
    opacity: 0.95,
  },
  pendingCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pendingSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    minWidth: 0,
    paddingLeft: 6,
  },
  pendingTextBlock: {
    flex: 1,
    gap: 4,
    minHeight: 52,
    justifyContent: 'center',
  },
  pendingTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  pendingError: {
    color: palette.error,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingDeleteButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    backgroundColor: palette.background,
  },
  dockNote: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  dockSubnote: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalKeyboardScroll: {
    flex: 1,
    backgroundColor: palette.overlay,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  modalCard: {
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '82%',
  },
  modalTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  modalBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  modalHint: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  summaryList: {
    gap: 4,
  },
  summaryLine: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  input: {
    backgroundColor: palette.field,
    color: palette.text,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
  },
  descriptionInput: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  targetList: {
    maxHeight: 280,
  },
  targetListContent: {
    gap: spacing.sm,
  },
  targetButton: {
    backgroundColor: palette.field,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  targetButtonActive: {
    backgroundColor: palette.accent,
  },
  targetButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  targetButtonTextAccent: {
    color: palette.userChat,
  },
  pressed: {
    opacity: 0.9,
  },
});
