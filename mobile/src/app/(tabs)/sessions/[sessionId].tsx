import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import SessionGameCard from '@/components/session-game-card';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import {
  createSession,
  deleteSession,
  fetchGames,
  moveGameToSession,
  queryKeys,
  updateSession,
} from '@/lib/backend';
import { buildSessionGroups } from '@/lib/bowling';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

const NEW_SESSION_TARGET = '__new-session__';

function formatGameMeta(playerName: string, playedAt?: string | null, createdAt?: string | null) {
  const dateSource = playedAt || createdAt;
  if (!dateSource) {
    return playerName;
  }

  const date = new Date(dateSource);
  if (Number.isNaN(date.getTime())) {
    return playerName;
  }

  return `${playerName} | ${date.toLocaleDateString('en-US')} ${date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const queryClient = useQueryClient();

  const gamesQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
  });

  const grouping = useMemo(
    () => buildSessionGroups(gamesQuery.data?.games ?? []),
    [gamesQuery.data?.games],
  );
  const group = grouping.groups.find((entry) => entry.key === sessionId);

  const [editing, setEditing] = useState(false);
  const [deleteOptionsOpen, setDeleteOptionsOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [moveGameId, setMoveGameId] = useState<string | null>(null);
  const [moveDeletingSession, setMoveDeletingSession] = useState(false);
  const [pendingMoveTargetId, setPendingMoveTargetId] = useState<string | null>(null);
  const [pendingDeleteMoveTargetId, setPendingDeleteMoveTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!group || group.isSessionless) {
      setDraftName('');
      setDraftDescription('');
      return;
    }
    setDraftName(group.session?.name?.trim() || '');
    setDraftDescription(group.session?.description?.trim() || '');
  }, [group]);

  const leaveSessionDetail = () => {
    if (Platform.OS === 'web') {
      router.replace('/sessions' as never);
      return;
    }
    router.back();
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!group?.sessionId) {
        throw new Error('Session was not found.');
      }
      return updateSession(group.sessionId, draftName, draftDescription);
    },
    onSuccess: async () => {
      setEditing(false);
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update session.');
    },
  });

  const moveMutation = useMutation({
    onMutate: (targetSessionId: string) => {
      setPendingMoveTargetId(targetSessionId);
    },
    mutationFn: async (targetSessionId: string) => {
      if (!moveGameId) {
        throw new Error('Game was not selected.');
      }
      if (targetSessionId === NEW_SESSION_TARGET) {
        const created = await createSession('', '');
        return moveGameToSession(moveGameId, created.session.id);
      }
      return moveGameToSession(moveGameId, targetSessionId);
    },
    onSuccess: async () => {
      setMoveGameId(null);
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to move game.');
    },
    onSettled: () => {
      setPendingMoveTargetId(null);
    },
  });

  const moveSessionMutation = useMutation({
    onMutate: (targetSessionId: string) => {
      setPendingDeleteMoveTargetId(targetSessionId);
    },
    mutationFn: async (targetSessionId: string) => {
      if (!group?.sessionId || group.isSessionless) {
        throw new Error('Session was not found.');
      }

      const nextSessionId =
        targetSessionId === NEW_SESSION_TARGET
          ? (await createSession('', '')).session.id
          : targetSessionId;

      await Promise.all(group.games.map((game) => moveGameToSession(game.id, nextSessionId)));
      return deleteSession(group.sessionId, 'delete_games');
    },
    onSuccess: async () => {
      setMoveDeletingSession(false);
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);
      leaveSessionDetail();
    },
    onError: (nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Failed to move games out of session.');
    },
    onSettled: () => {
      setPendingDeleteMoveTargetId(null);
    },
  });

  if (gamesQuery.isPending) {
    return <CenteredState title="Loading session..." loading />;
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.missingWrap}>
          <InfoBanner text="This session no longer exists. Go back to Sessions and refresh the list." />
        </View>
      </SafeAreaView>
    );
  }

  const moveTargets = grouping.groups.filter(
    (target) => !target.isSessionless && target.sessionId !== group.sessionId,
  );

  const handleDeleteSession = () => {
    if (!group.sessionId || group.isSessionless) {
      return;
    }

    setDeleteOptionsOpen(true);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable
            onPress={leaveSessionDetail}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Ionicons name="chevron-back" size={16} color={palette.muted} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          {!group.isSessionless ? (
            <View style={styles.topBarActions}>
              <IconAction
                accessibilityLabel="Edit session"
                onPress={() => setEditing(true)}
                style={styles.topBarActionButton}
                icon={<MaterialIcons name="edit" size={22} color={palette.text} />}
              />
              <IconAction
                accessibilityLabel="Delete session"
                onPress={handleDeleteSession}
                style={styles.topBarActionButton}
                icon={<MaterialIcons name="delete" size={22} color={palette.text} />}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <View style={styles.titleRow}>
              <StackBadge
                lines={[group.dateMonth, group.dateDay]}
                style={styles.headerBadge}
              />
              <View style={styles.headerText}>
                <Text style={styles.title}>{group.title}</Text>
                <Text style={styles.meta}>
                  {group.gameCount} {group.gameCount === 1 ? 'game' : 'games'} | Avg{' '}
                  {group.averageLabel}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {error ? <InfoBanner tone="error" text={error} /> : null}

        {group.description ? <Text style={styles.description}>{group.description}</Text> : null}

        <Text style={styles.guidance}>
          Tap on a game to see more info. Hold down on a game to move it into a different session.
        </Text>

        <View style={styles.gameList}>
          {group.games.map((game) => (
            <SessionGameCard
              key={game.id}
              game={game}
              title={grouping.gameTitleMap.get(game.id) || game.game_name?.trim() || 'Game'}
              meta={formatGameMeta(game.player_name, game.played_at, game.created_at)}
              onRequestMove={setMoveGameId}
            />
          ))}
        </View>
      </ScrollView>

      <Modal transparent animationType="fade" visible={editing} onRequestClose={() => setEditing(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          enabled={Platform.OS === 'ios'}
          style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Edit session</Text>
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
              style={[styles.input, styles.inputMultiline]}
              multiline
              value={draftDescription}
              onChangeText={setDraftDescription}
            />
            <ActionButton
              label={updateMutation.isPending ? 'Saving...' : 'Save session'}
              onPress={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setEditing(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={deleteOptionsOpen}
        onRequestClose={() => setDeleteOptionsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Delete Session</Text>
            <Text style={styles.modalBody}>Choose how to handle the games in this session.</Text>
            <ActionButton
              label="Move to different session"
              onPress={() => {
                setDeleteOptionsOpen(false);
                setMoveDeletingSession(true);
              }}
            />
            <ActionButton
              label="Delete games too"
              variant="danger"
              onPress={async () => {
                try {
                  setDeleteOptionsOpen(false);
                  await deleteSession(group.sessionId as string, 'delete_games');
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: queryKeys.games }),
                    queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                  ]);
                  leaveSessionDetail();
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : 'Failed to delete session.');
                }
              }}
            />
            <ActionButton
              label="Cancel"
              onPress={() => setDeleteOptionsOpen(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={moveDeletingSession}
        onRequestClose={() => setMoveDeletingSession(false)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Move games before deleting</Text>
            <ScrollView style={styles.targetList} contentContainerStyle={styles.targetListContent}>
              <Pressable
                onPress={() => moveSessionMutation.mutate(NEW_SESSION_TARGET)}
                disabled={moveSessionMutation.isPending}
                style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                <View style={styles.targetButtonInner}>
                  <Text style={[styles.targetButtonText, styles.targetButtonTextAccent]}>
                    New Session
                  </Text>
                  {moveSessionMutation.isPending && pendingDeleteMoveTargetId === NEW_SESSION_TARGET ? (
                    <BowlingBallSpinner size={16} holeColor={palette.field} />
                  ) : null}
                </View>
              </Pressable>
              {moveTargets.map((target) => (
                <Pressable
                  key={target.sessionId}
                  onPress={() => moveSessionMutation.mutate(target.sessionId as string)}
                  disabled={moveSessionMutation.isPending}
                  style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                  <View style={styles.targetButtonInner}>
                    <Text style={styles.targetButtonText}>{target.title}</Text>
                    {moveSessionMutation.isPending &&
                    pendingDeleteMoveTargetId === target.sessionId ? (
                      <BowlingBallSpinner size={16} holeColor={palette.field} />
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <ActionButton
              label="Cancel"
              onPress={() => setMoveDeletingSession(false)}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={Boolean(moveGameId)}
        onRequestClose={() => setMoveGameId(null)}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <Text style={styles.modalTitle}>Move game</Text>
            <ScrollView style={styles.targetList} contentContainerStyle={styles.targetListContent}>
              <Pressable
                onPress={() => moveMutation.mutate(NEW_SESSION_TARGET)}
                disabled={moveMutation.isPending}
                style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                <View style={styles.targetButtonInner}>
                  <Text style={[styles.targetButtonText, styles.targetButtonTextAccent]}>
                    New Session
                  </Text>
                  {moveMutation.isPending && pendingMoveTargetId === NEW_SESSION_TARGET ? (
                    <BowlingBallSpinner size={16} holeColor={palette.field} />
                  ) : null}
                </View>
              </Pressable>
              {moveTargets.map((target) => (
                <Pressable
                  key={target.sessionId}
                  onPress={() => moveMutation.mutate(target.sessionId as string)}
                  disabled={moveMutation.isPending}
                  style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                  <View style={styles.targetButtonInner}>
                    <Text style={styles.targetButtonText}>{target.title}</Text>
                    {moveMutation.isPending && pendingMoveTargetId === target.sessionId ? (
                      <BowlingBallSpinner size={16} holeColor={palette.field} />
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            <ActionButton
              label="Cancel"
              onPress={() => setMoveGameId(null)}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
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
    paddingBottom: 138,
    gap: 14,
  },
  missingWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  headerTop: {
    gap: spacing.md,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 2,
  },
  title: {
    color: palette.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '500',
    fontFamily: fontFamilySans,
  },
  meta: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flexShrink: 0,
  },
  topBarActionButton: {
    marginTop: -6,
  },
  description: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  guidance: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  gameList: {
    gap: 8,
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
    maxHeight: '80%',
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
  inputMultiline: {
    minHeight: 96,
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
  targetButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
