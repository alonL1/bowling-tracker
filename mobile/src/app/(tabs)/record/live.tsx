import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import CenteredState from '@/components/centered-state';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import LiveGameEditSheet from '@/components/live-game-edit-sheet';
import LiveSessionGameCard from '@/components/live-session-game-card';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import {
  deleteLiveSessionGame,
  endLiveSession,
  fetchLiveSession,
  queryKeys,
  queueLiveSessionCapture,
  updateLiveSession,
  updateLiveSessionGame,
} from '@/lib/backend';
import {
  buildLiveSessionStats,
  buildProjectedLoggedGameCount,
  canonicalizePlayerLabel,
  getLiveGameScoreLabel,
  getLiveSessionDescription,
  getLiveSessionTitle,
} from '@/lib/live-session';
import { deriveCapturedAtHint, sanitizeFilename } from '@/lib/upload';
import { supabase } from '@/lib/supabase';
import type { LiveSessionGame, LiveSessionResponse } from '@/lib/types';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useAuth } from '@/providers/auth-provider';

const DEFAULT_BUCKET = 'scoreboards-temp';

async function getUploadBody(asset: ImagePicker.ImagePickerAsset) {
  if (asset.file) {
    return asset.file;
  }

  const file = new ExpoFile(asset.uri);
  return file.arrayBuffer();
}

function formatStatusLabel(status: LiveSessionGame['status']) {
  if (status === 'queued') {
    return 'Queued for extraction';
  }
  if (status === 'processing') {
    return 'Processing scoreboard';
  }
  if (status === 'error') {
    return 'Extraction failed';
  }
  return 'Ready';
}

function formatGameMeta(game: LiveSessionGame) {
  const source = game.captured_at || game.captured_at_hint || game.created_at;
  if (!source) {
    return 'Scoreboard captured';
  }

  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return 'Scoreboard captured';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function updateLiveSessionCache(
  current: LiveSessionResponse | undefined,
  updater: (payload: NonNullable<LiveSessionResponse['liveSession']>) => NonNullable<LiveSessionResponse['liveSession']>,
) {
  if (!current?.liveSession) {
    return current;
  }

  return {
    ...current,
    liveSession: updater(current.liveSession),
  };
}

type StatsTileProps = {
  label: string;
  value: string;
};

function StatsTile({ label, value }: StatsTileProps) {
  return (
    <View style={styles.statsTile}>
      <Text style={styles.statsLabel}>{label}</Text>
      <Text style={styles.statsValue}>{value}</Text>
    </View>
  );
}

export default function LiveSessionScreen() {
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();

  const [sourceOpen, setSourceOpen] = useState(false);
  const [sessionEditOpen, setSessionEditOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [error, setError] = useState('');
  const [editingGame, setEditingGame] = useState<LiveSessionGame | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);

  const liveSessionQuery = useQuery({
    queryKey: queryKeys.liveSession,
    queryFn: fetchLiveSession,
    refetchInterval: (query) => {
      const data = query.state.data as LiveSessionResponse | undefined;
      const hasActiveProcessing = data?.liveSession?.games?.some(
        (game) => game.status === 'queued' || game.status === 'processing',
      );
      return hasActiveProcessing ? 2500 : false;
    },
  });

  const liveSession = liveSessionQuery.data?.liveSession ?? null;
  const nextSessionNumber = liveSessionQuery.data?.nextSessionNumber ?? 1;

  useEffect(() => {
    if (!liveSession) {
      return;
    }
    setDraftName(liveSession.name?.trim() || '');
    setDraftDescription(liveSession.description?.trim() || '');
  }, [liveSession?.id, liveSession?.name, liveSession?.description]);

  const readyGames = useMemo(
    () => (liveSession?.games ?? []).filter((game) => game.status === 'ready'),
    [liveSession?.games],
  );
  const nonReadyGames = useMemo(
    () => (liveSession?.games ?? []).filter((game) => game.status !== 'ready'),
    [liveSession?.games],
  );

  const selectedPlayerKeys = liveSession?.selectedPlayerKeys ?? [];
  const playerOptions = liveSession?.playerOptions ?? [];
  const stats = useMemo(
    () => buildLiveSessionStats(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );
  const projectedLoggedGameCount = useMemo(
    () => buildProjectedLoggedGameCount(readyGames, selectedPlayerKeys),
    [readyGames, selectedPlayerKeys],
  );

  const hasSelectedPlayers = selectedPlayerKeys.length > 0;
  const hasUnfinishedGames = nonReadyGames.some(
    (game) => game.status === 'queued' || game.status === 'processing',
  );
  const hasFailedGames = nonReadyGames.some((game) => game.status === 'error');

  const selectionMutation = useMutation({
    mutationFn: async (nextSelectedPlayerKeys: string[]) =>
      updateLiveSession({ selectedPlayerKeys: nextSelectedPlayerKeys }),
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update selected players.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveSession });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.liveSession, data);
    },
  });

  const sessionMutation = useMutation({
    mutationFn: async () => {
      if (!liveSession) {
        return null;
      }
      return updateLiveSession({
        name: draftName,
        description: draftDescription,
      });
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData(queryKeys.liveSession, data);
      }
      setSessionEditOpen(false);
      setError('');
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save session details.');
    },
  });

  const captureMutation = useMutation({
    mutationFn: async (source: 'camera' | 'library') => {
      if (!user) {
        throw new Error('You must be signed in before starting a live session.');
      }

      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(
          source === 'camera'
            ? 'Camera permission is required to capture a scoreboard.'
            : 'Photo library permission is required to pick a scoreboard.',
        );
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              exif: true,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsMultipleSelection: false,
              exif: true,
              quality: 1,
            });

      if (result.canceled || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      const filename = sanitizeFilename(asset.fileName ?? undefined, 0);
      const storageKey = `${user.id}/${Date.now()}-${filename}`;
      const uploadBody = await getUploadBody(asset);

      const upload = await supabase.storage.from(DEFAULT_BUCKET).upload(storageKey, uploadBody, {
        contentType: asset.mimeType ?? 'image/jpeg',
        upsert: false,
      });

      if (upload.error) {
        throw new Error(upload.error.message || 'Failed to upload scoreboard image.');
      }

      try {
        await queueLiveSessionCapture({
          storageKey,
          capturedAtHint: deriveCapturedAtHint(asset),
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          name: liveSession ? undefined : draftName,
          description: liveSession ? undefined : draftDescription,
        });
      } catch (nextError) {
        await supabase.storage.from(DEFAULT_BUCKET).remove([storageKey]);
        throw nextError;
      }

      return storageKey;
    },
    onSuccess: async () => {
      setSourceOpen(false);
      setError('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.liveSession });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to add scoreboard.');
    },
  });

  const editGameMutation = useMutation({
    mutationFn: updateLiveSessionGame,
    onSuccess: async () => {
      setEditingGame(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.liveSession });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save live game.');
    },
  });

  const deleteGameMutation = useMutation({
    mutationFn: async (liveGameId: string) => {
      setDeletingGameId(liveGameId);
      return deleteLiveSessionGame(liveGameId);
    },
    onSuccess: async (payload) => {
      if (payload.deletedSession) {
        setDraftName('');
        setDraftDescription('');
      }
      setError('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.liveSession });
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete live game.');
    },
    onSettled: () => {
      setDeletingGameId(null);
    },
  });

  const endSessionMutation = useMutation({
    mutationFn: endLiveSession,
    onSuccess: async (payload) => {
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.liveSession }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);
      router.replace(`/sessions/${payload.sessionId}` as never);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to end live session.');
    },
  });

  const handleTogglePlayer = (playerKey: string) => {
    if (!liveSession || selectionMutation.isPending) {
      return;
    }

    const nextSelectedPlayerKeys = selectedPlayerKeys.includes(playerKey)
      ? selectedPlayerKeys.filter((entry) => entry !== playerKey)
      : [...selectedPlayerKeys, playerKey];

    queryClient.setQueryData<LiveSessionResponse | undefined>(queryKeys.liveSession, (current) =>
      updateLiveSessionCache(current, (session) => ({
        ...session,
        selectedPlayerKeys: nextSelectedPlayerKeys,
      })),
    );

    selectionMutation.mutate(nextSelectedPlayerKeys);
  };

  const handleSaveSessionDetails = () => {
    if (!liveSession) {
      setSessionEditOpen(false);
      setError('');
      return;
    }
    sessionMutation.mutate();
  };

  const handleEndSession = () => {
    if (!liveSession) {
      return;
    }

    const selectedLabels = playerOptions
      .filter((option) => selectedPlayerKeys.includes(option.key))
      .map((option) => canonicalizePlayerLabel(option.label));

    const warningLines = [
      'Ending this session is final.',
      '',
      `Selected names: ${selectedLabels.join(', ') || 'None'}`,
      `Visible scoreboards: ${readyGames.length}`,
      `Logged games that will be created: ${projectedLoggedGameCount}`,
    ];

    if (selectedPlayerKeys.length > 1) {
      warningLines.push(
        '',
        'Multiple selected names can create more logged games than visible scoreboards because each selected row is logged separately.',
      );
    }

    Alert.alert('End Session', warningLines.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Session',
        style: 'destructive',
        onPress: () => endSessionMutation.mutate(),
      },
    ]);
  };

  if (authLoading || (liveSessionQuery.isPending && !liveSessionQuery.data)) {
    return <CenteredState title="Loading live session..." loading />;
  }

  if (liveSessionQuery.error && !liveSessionQuery.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.centeredWrap}>
          <InfoBanner
            tone="error"
            text={
              liveSessionQuery.error instanceof Error
                ? liveSessionQuery.error.message
                : 'Failed to load live session.'
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  const sessionTitle = getLiveSessionTitle(liveSession?.name ?? draftName, liveSession?.sessionNumber ?? nextSessionNumber);
  const sessionDescription = getLiveSessionDescription(liveSession?.description ?? draftDescription);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.page}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 138 }]}
          showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={16} color={palette.muted} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.pageTitle}>Live Session</Text>
            <View style={styles.sessionTitleRow}>
              <Text style={styles.sessionTitle}>{sessionTitle}</Text>
              <IconAction
                accessibilityLabel="Edit live session details"
                onPress={() => setSessionEditOpen(true)}
                icon={<MaterialIcons name="edit" size={22} color={palette.text} />}
              />
            </View>
            <Text style={styles.sessionDescription}>{sessionDescription}</Text>
          </View>

          {error ? <InfoBanner tone="error" text={error} /> : null}
          {liveSessionQuery.error ? (
            <InfoBanner
              tone="error"
              text={
                liveSessionQuery.error instanceof Error
                  ? liveSessionQuery.error.message
                  : 'Failed to refresh live session.'
              }
            />
          ) : null}

          <SurfaceCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Add Game</Text>
            <Text style={styles.sectionBody}>
              Capture one scoreboard after each game. The scoreboard stays as a draft until you end the session.
            </Text>
            <ActionButton
              label={captureMutation.isPending ? 'Adding game...' : 'Add Game'}
              onPress={() => setSourceOpen(true)}
              disabled={captureMutation.isPending}
            />
          </SurfaceCard>

          <SurfaceCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              Which of these are you? Or which of these do you want to see stats for? (may select multiple)
            </Text>
            {playerOptions.length === 0 ? (
              <Text style={styles.sectionBody}>
                Add a scoreboard to start extracting player names.
              </Text>
            ) : (
              <View style={styles.checkboxList}>
                {playerOptions.map((option) => {
                  const checked = selectedPlayerKeys.includes(option.key);
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleTogglePlayer(option.key)}
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

          <SurfaceCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Session Stats</Text>
            <View style={styles.statsGrid}>
              <StatsTile label="Average" value={stats.averageLabel} />
              <StatsTile label="Strike Rate" value={stats.strikeRateLabel} />
              <StatsTile label="Spare Rate" value={stats.spareRateLabel} />
              <StatsTile label="Spare Conversion" value={stats.spareConversionRateLabel} />
              <StatsTile label="Best Frame" value={stats.bestFrameLabel} />
              <StatsTile label="Worst Frame" value={stats.worstFrameLabel} />
            </View>
          </SurfaceCard>

          {liveSession?.games?.length ? (
            <View style={styles.gameList}>
              {liveSession.games.map((game) =>
                game.status === 'ready' ? (
                  <LiveSessionGameCard
                    key={game.id}
                    game={game}
                    selectedPlayerKeys={selectedPlayerKeys}
                    deleting={deletingGameId === game.id}
                    onEdit={setEditingGame}
                    onDelete={(liveGameId) => deleteGameMutation.mutate(liveGameId)}
                  />
                ) : (
                  <SurfaceCard key={game.id} style={styles.pendingCard}>
                    <View style={styles.pendingCardRow}>
                      <View style={styles.pendingSummary}>
                        <StackBadge lines={['Game', String(game.capture_order)]} />
                        <View style={styles.pendingTextBlock}>
                          <Text style={styles.pendingTitle}>
                            {game.status === 'error'
                              ? 'Scoreboard needs attention'
                              : getLiveGameScoreLabel(game, selectedPlayerKeys)}
                          </Text>
                          <Text style={styles.pendingMeta}>{formatGameMeta(game)}</Text>
                          <Text style={styles.pendingStatus}>{formatStatusLabel(game.status)}</Text>
                          {game.last_error ? (
                            <Text style={styles.pendingError}>{game.last_error}</Text>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.pendingActions}>
                        {game.status === 'queued' || game.status === 'processing' ? (
                          <BowlingBallSpinner size={22} holeColor={palette.field} />
                        ) : null}
                        <IconAction
                          accessibilityLabel="Delete pending live game"
                          onPress={() => deleteGameMutation.mutate(game.id)}
                          icon={<MaterialIcons name="delete" size={22} color={palette.text} />}
                        />
                      </View>
                    </View>
                  </SurfaceCard>
                ),
              )}
            </View>
          ) : (
            <SurfaceCard style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No live games yet</Text>
              <Text style={styles.emptyBody}>
                After you finish a game, add a scoreboard photo here. Once it is processed, the draft game card will appear below.
              </Text>
            </SurfaceCard>
          )}
        </ScrollView>

        <View style={[styles.endDock, { bottom: tabBarHeight }]}>
          <ActionButton
            label={endSessionMutation.isPending ? 'Ending session...' : 'End Session'}
            onPress={handleEndSession}
            disabled={
              endSessionMutation.isPending ||
              !liveSession ||
              !hasSelectedPlayers ||
              readyGames.length === 0 ||
              hasUnfinishedGames ||
              hasFailedGames ||
              projectedLoggedGameCount === 0
            }
          />
          {!hasSelectedPlayers ? (
            <Text style={styles.dockNote}>Choose at least one player before ending the session.</Text>
          ) : hasUnfinishedGames ? (
            <Text style={styles.dockNote}>Wait for all scoreboards to finish processing.</Text>
          ) : hasFailedGames ? (
            <Text style={styles.dockNote}>Remove or fix failed scoreboards before ending the session.</Text>
          ) : selectedPlayerKeys.length > 1 ? (
            <Text style={styles.dockNote}>
              Multiple selected names will log {projectedLoggedGameCount} games from {readyGames.length} scoreboards.
            </Text>
          ) : null}
        </View>
      </View>

      <Modal transparent animationType="fade" visible={sourceOpen} onRequestClose={() => setSourceOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Choose Source</Text>
            <ActionButton
              label="Camera"
              onPress={() => captureMutation.mutate('camera')}
              disabled={captureMutation.isPending}
            />
            <ActionButton
              label="Photo Library"
              onPress={() => captureMutation.mutate('library')}
              variant="secondary"
              disabled={captureMutation.isPending}
            />
            <ActionButton label="Cancel" onPress={() => setSourceOpen(false)} variant="secondary" />
          </SurfaceCard>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={sessionEditOpen}
        onRequestClose={() => setSessionEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Edit Session</Text>
            <TextInput
              placeholder="Session name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
            />
            <TextInput
              placeholder="Description"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.descriptionInput]}
              multiline
              value={draftDescription}
              onChangeText={setDraftDescription}
            />
            <ActionButton
              label={sessionMutation.isPending ? 'Saving...' : 'Save'}
              onPress={handleSaveSessionDetails}
              disabled={sessionMutation.isPending}
            />
            <ActionButton label="Cancel" onPress={() => setSessionEditOpen(false)} variant="secondary" />
          </SurfaceCard>
        </View>
      </Modal>

      <LiveGameEditSheet
        visible={Boolean(editingGame)}
        game={editingGame}
        selectedPlayerKeys={selectedPlayerKeys}
        saving={editGameMutation.isPending}
        errorText={editGameMutation.isError ? error : ''}
        onClose={() => setEditingGame(null)}
        onSave={(payload) => editGameMutation.mutate(payload)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  page: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 18,
    gap: spacing.md,
  },
  centeredWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
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
  header: {
    gap: spacing.xs,
  },
  pageTitle: {
    color: palette.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sessionTitle: {
    flex: 1,
    color: palette.text,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  sessionDescription: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  sectionCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sectionBody: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
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
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsTile: {
    width: '48%',
    backgroundColor: palette.field,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  statsLabel: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  statsValue: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  gameList: {
    gap: 8,
  },
  pendingCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pendingCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pendingSummary: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pendingTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pendingTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
    fontFamily: fontFamilySans,
  },
  pendingMeta: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  pendingStatus: {
    color: palette.accent,
    fontSize: 14,
    lineHeight: 18,
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
    gap: spacing.xs,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 20,
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
  endDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    backgroundColor: palette.nav,
  },
  dockNote: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.overlay,
  },
  modalCard: {
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
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
    minHeight: 96,
    textAlignVertical: 'top',
  },
  pressed: {
    opacity: 0.9,
  },
});
