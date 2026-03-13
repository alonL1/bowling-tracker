import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import CenteredState from '@/components/centered-state';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import SessionGameCard from '@/components/session-game-card';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import {
  deleteSession,
  fetchGames,
  fetchSessions,
  moveGameToSession,
  queryKeys,
  updateSession,
} from '@/lib/backend';
import { buildSessionGroups } from '@/lib/bowling';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';

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
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
  });

  const grouping = useMemo(
    () => buildSessionGroups(gamesQuery.data?.games ?? []),
    [gamesQuery.data?.games],
  );
  const group = grouping.groups.find((entry) => entry.key === sessionId);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [moveGameId, setMoveGameId] = useState<string | null>(null);
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
    mutationFn: async (targetSessionId: string | null) => {
      if (!moveGameId) {
        throw new Error('Game was not selected.');
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

  const actualSessions = sessionsQuery.data?.sessions ?? [];
  const moveTargets = actualSessions.filter((session) => session.id !== group.sessionId);

  const handleDeleteSession = () => {
    if (!group.sessionId || group.isSessionless) {
      return;
    }

    Alert.alert('Delete Session', 'Choose how to handle the games in this session.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to sessionless',
        onPress: async () => {
          try {
            await deleteSession(group.sessionId as string, 'sessionless');
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.games }),
              queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            ]);
            router.back();
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Failed to delete session.');
          }
        },
      },
      {
        text: 'Delete games too',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSession(group.sessionId as string, 'delete_games');
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.games }),
              queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            ]);
            router.back();
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Failed to delete session.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={16} color={palette.muted} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

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

          {!group.isSessionless ? (
            <View style={styles.headerActions}>
              <IconAction
                accessibilityLabel="Edit session"
                onPress={() => setEditing(true)}
                icon={<Ionicons name="create-outline" size={22} color={palette.text} />}
              />
              <IconAction
                accessibilityLabel="Delete session"
                onPress={handleDeleteSession}
                icon={<Ionicons name="trash-outline" size={22} color={palette.text} />}
              />
            </View>
          ) : null}
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
        <View style={styles.modalBackdrop}>
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
                onPress={() => moveMutation.mutate(null)}
                disabled={moveMutation.isPending}
                style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                <Text style={styles.targetButtonText}>Sessionless games</Text>
              </Pressable>
              {moveTargets.map((target) => (
                <Pressable
                  key={target.id}
                  onPress={() => moveMutation.mutate(target.id)}
                  disabled={moveMutation.isPending}
                  style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}>
                  <Text style={styles.targetButtonText}>
                    {target.name?.trim() || 'Unnamed session'}
                  </Text>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flexShrink: 0,
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
  targetButtonText: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  pressed: {
    opacity: 0.9,
  },
});
