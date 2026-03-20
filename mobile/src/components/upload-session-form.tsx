import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import InfoBanner from '@/components/info-banner';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import RecordingDraftGameCard from '@/components/recording-draft-game-card';
import RecordingDraftGameEditSheet from '@/components/recording-draft-game-edit-sheet';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
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
  uploadToRecordingDraft,
  reorderRecordingDraftGame,
} from '@/lib/backend';
import {
  canonicalizePlayerLabel,
  getFirstSelectionValidationError,
} from '@/lib/live-session';
import { supabase } from '@/lib/supabase';
import type {
  RecordingDraftGame,
  RecordingDraftGroup,
  RecordingDraftMode,
  SessionItem,
  SessionMode,
} from '@/lib/types';
import { buildAutoGroupMap, deriveCapturedAtHint, sanitizeFilename } from '@/lib/upload';
import { useAuth } from '@/providers/auth-provider';

const DEFAULT_BUCKET = 'scoreboards-temp';
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
    return hasTargetSession ? 'Add to Session' : 'Choose Existing Session';
  }
  return 'Add to Log';
}

function getFinalizeButtonLabel(mode: RecordingDraftMode) {
  return mode === 'add_existing_session' ? 'Add to Session' : 'Add to Log';
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

async function getUploadBody(asset: ImagePicker.ImagePickerAsset) {
  if (asset.file) {
    return asset.file;
  }

  const file = new ExpoFile(asset.uri);
  return file.arrayBuffer();
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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const mode = useMemo(() => getDraftMode(sessionMode), [sessionMode]);

  const [error, setError] = useState('');
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<RecordingDraftGame | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
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
  const hasProcessing = allGames.some(
    (game) => game.status === 'queued' || game.status === 'processing',
  );
  const hasFailedGames = allGames.some((game) => game.status === 'error');
  const canFinalize =
    readyGames.length > 0 &&
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

    setFinalizeName(draft.name?.trim() || '');
    setFinalizeDescription(draft.description?.trim() || '');
    if (mode === 'add_existing_session') {
      setTargetSessionId(draft.targetSessionId ?? null);
    }
  }, [draft?.id, draft?.name, draft?.description, draft?.targetSessionId, mode]);

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

  const uploadMutation = useMutation({
    mutationFn: async (assets: ImagePicker.ImagePickerAsset[]) => {
      if (!user) {
        throw new Error('You must be signed in before uploading scoreboards.');
      }

      const autoGroupMap =
        mode === 'add_multiple_sessions' ? buildAutoGroupMap(assets) : new Map();
      const storageItems: Array<{
        storageKey: string;
        capturedAtHint?: string;
        fileSizeBytes?: number;
        autoGroupIndex?: number;
      }> = [];

      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        const filename = sanitizeFilename(asset.fileName ?? undefined, index);
        const storageKey = `${user.id}/${Date.now()}-${index}-${filename}`;

        let uploadBody: ArrayBuffer | File;
        try {
          uploadBody = await getUploadBody(asset);
        } catch {
          continue;
        }

        const upload = await supabase.storage.from(DEFAULT_BUCKET).upload(storageKey, uploadBody, {
          contentType: asset.mimeType ?? 'image/jpeg',
          upsert: false,
        });
        if (upload.error) {
          continue;
        }

        const autoMeta = autoGroupMap.get(asset.uri);
        storageItems.push({
          storageKey,
          capturedAtHint: deriveCapturedAtHint(asset),
          fileSizeBytes: asset.fileSize,
          autoGroupIndex:
            mode === 'add_multiple_sessions' ? autoMeta?.autoGroupIndex : undefined,
        });
      }

      if (storageItems.length === 0) {
        throw new Error('All uploads failed before they could be submitted.');
      }

      return uploadToRecordingDraft({
        mode,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        storageItems,
      });
    },
    onSuccess: async (response) => {
      setError('');
      setDraftCache(response as { draft: typeof draft });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to upload scoreboards.');
    },
  });

  const selectionMutation = useMutation({
    mutationFn: async (nextSelectedPlayerKeys: string[]) =>
      updateRecordingDraft({
        mode,
        selectedPlayerKeys: nextSelectedPlayerKeys,
      }),
    onSuccess: (response) => {
      setError('');
      setDraftCache(response as { draft: typeof draft });
    },
    onError: (nextError) => {
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
      setDeletingGameId(draftGameId);
      return deleteRecordingDraftGame(mode, draftGameId);
    },
    onSuccess: async (response) => {
      setError('');
      setDraftCache(response as { draft: typeof draft });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete draft game.');
    },
    onSettled: () => {
      setDeletingGameId(null);
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => discardRecordingDraft(mode),
    onSuccess: async () => {
      setError('');
      setFinalizeOpen(false);
      setEditingGame(null);
      setEditingGroup(null);
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
      setFinalizeOpen(true);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to choose session.');
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () =>
      finalizeRecordingDraft({
        mode,
        targetSessionId: mode === 'add_existing_session' ? targetSessionId : undefined,
        name: mode === 'upload_session' ? finalizeName : undefined,
        description: mode === 'upload_session' ? finalizeDescription : undefined,
      }),
    onSuccess: async (response) => {
      setError('');
      setFinalizeOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordingDraft(mode) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordEntryStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);

      if (response.primarySessionId) {
        router.replace(`/sessions/${response.primarySessionId}` as never);
        return;
      }

      router.back();
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

    selectionMutation.mutate(nextSelectedPlayerKeys);
  };

  const handleOpenPrimaryAction = () => {
    if (mode === 'add_existing_session' && !targetSessionId) {
      setSessionPickerOpen(true);
      return;
    }

    setFinalizeOpen(true);
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
      <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
        <Ionicons name="chevron-back" size={16} color={palette.muted} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      {error ? <InfoBanner tone="error" text={error} /> : null}
      {draftQuery.error ? (
        <InfoBanner
          tone="error"
          text={draftQuery.error instanceof Error ? draftQuery.error.message : 'Failed to load draft.'}
        />
      ) : null}

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
        <Pressable
          onPress={handleDiscardDraft}
          disabled={discardMutation.isPending}
          style={({ pressed }) => [styles.discardButton, pressed && styles.pressed]}>
          <Text style={styles.discardText}>
            {discardMutation.isPending ? 'Discarding draft...' : 'Discard Draft'}
          </Text>
        </Pressable>
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
              deleting={deletingGameId === item.game.id}
              onEdit={setEditingGame}
              onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
              onStartDrag={drag}
              dragActive={isActive}
            />
          ) : (
            <PendingDraftGameCard
              gameNumber={item.gameNumber}
              game={item.game}
              deleting={deletingGameId === item.game.id}
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
          data={flatRows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          activationDistance={8}
          dragItemOverflow
          ListHeaderComponent={topContent}
          ListEmptyComponent={
            <SurfaceCard style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No scoreboards yet</Text>
              <Text style={styles.emptyBody}>
                Choose scoreboard images and they will appear here one by one as they finish processing.
              </Text>
            </SurfaceCard>
          }
          renderItem={renderFlatRow}
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
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}>
          {topContent}

          {groups.length > 0 ? (
            <View style={styles.groupList}>
              {(() => {
                let gameNumber = 0;
                return groups.map((group) => (
                  <View key={group.id} style={styles.groupWrap}>
                    <View style={styles.gameList}>
                      {group.games.map((game) => {
                        gameNumber += 1;
                        return game.status === 'ready' ? (
                          <RecordingDraftGameCard
                            key={game.id}
                            game={game}
                            gameNumber={gameNumber}
                            selectedPlayerKeys={selectedPlayerKeys}
                            deleting={deletingGameId === game.id}
                            onEdit={setEditingGame}
                            onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
                          />
                        ) : (
                          <PendingDraftGameCard
                            key={game.id}
                            gameNumber={gameNumber}
                            game={game}
                            deleting={deletingGameId === game.id}
                            onDelete={(draftGameId) => deleteGameMutation.mutate(draftGameId)}
                          />
                        );
                      })}
                    </View>
                  </View>
                ));
              })()}
            </View>
          ) : (
            <SurfaceCard style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No scoreboards yet</Text>
              <Text style={styles.emptyBody}>
                Choose scoreboard images and they will appear here one by one as they finish processing.
              </Text>
            </SurfaceCard>
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
            <Text style={styles.dockNote}>Choose an existing session before continuing.</Text>
          ) : (
            <Text style={styles.dockNote}>
              Adding to: {formatTargetSessionLabel(targetSessionId, sessions)}
            </Text>
          )}

          {selectionError ? <Text style={styles.dockNote}>{selectionError}</Text> : null}
          {!selectionError && hasProcessing ? (
            <Text style={styles.dockNote}>Wait for all scoreboards to finish processing.</Text>
          ) : null}
          {!selectionError && !hasProcessing && hasFailedGames ? (
            <Text style={styles.dockNote}>Remove or fix failed scoreboards before continuing.</Text>
          ) : null}
          {addToLogHelperText ? <Text style={styles.dockSubnote}>{addToLogHelperText}</Text> : null}
          <ActionButton
            label={getPrimaryButtonLabel(mode, Boolean(targetSessionId))}
            onPress={handleOpenPrimaryAction}
            disabled={
              mode === 'add_existing_session'
                ? false
                : !canFinalize
            }
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
        <KeyboardAvoidingView
          behavior="padding"
          enabled={Platform.OS === 'ios'}
          style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>{getFinalizeButtonLabel(mode)}</Text>
            <Text style={styles.modalBody}>
              {mode === 'add_existing_session'
                ? `Add these scoreboards to ${formatTargetSessionLabel(targetSessionId, sessions)}.`
                : 'This will log the processed scoreboards below.'}
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
                  onChangeText={setFinalizeName}
                />
                <TextInput
                  placeholder="Description (optional)"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, styles.descriptionInput]}
                  multiline
                  value={finalizeDescription}
                  onChangeText={setFinalizeDescription}
                />
              </>
            ) : null}
            <ActionButton
              label={finalizeMutation.isPending ? getFinalizeButtonLabel(mode) : getFinalizeButtonLabel(mode)}
              onPress={() => finalizeMutation.mutate()}
              disabled={finalizeMutation.isPending || !canFinalize}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setFinalizeOpen(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent animationType="fade" visible={Boolean(editingGroup)} onRequestClose={() => setEditingGroup(null)}>
        <KeyboardAvoidingView
          behavior="padding"
          enabled={Platform.OS === 'ios'}
          style={styles.modalBackdrop}>
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
        </KeyboardAvoidingView>
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
  backButton: {
    alignSelf: 'flex-start',
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
    alignSelf: 'flex-start',
  },
  discardText: {
    color: palette.error,
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
