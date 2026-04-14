import { Ionicons } from '@expo/vector-icons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import BowlingBallSpinner from '@/components/bowling-ball-spinner';
import CenteredState from '@/components/centered-state';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import KeyboardAwareScrollView from '@/components/keyboard-aware-scroll-view';
import SessionGameCard from '@/components/session-game-card';
import StackBadge from '@/components/stack-badge';
import SurfaceCard from '@/components/surface-card';
import UploadsProcessingBanner from '@/components/uploads-processing-banner';
import {
  buildLivePlayerComparisons,
  buildLoggedSessionStats,
  type LivePlayerComparisonMetric,
  type LivePlayerComparisonRow,
  canonicalizePlayerLabel,
  getResolvedPlayersForGame,
  normalizePlayerKey,
} from '@/lib/live-session';
import { formatTenths } from '@/lib/number-format';
import {
  createSession,
  deleteSession,
  fetchGames,
  moveGameToSession,
  queryKeys,
  updateSession,
} from '@/lib/backend';
import { buildSessionGroups } from '@/lib/bowling';
import { navigateBackOrFallback } from '@/lib/navigation';
import { getResolvedSessionRouteId } from '@/lib/uploads-processing-store';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { useUploadsProcessing } from '@/providers/uploads-processing-provider';

const NEW_SESSION_TARGET = '__new-session__';
const comparisonCategories: Array<{ key: LivePlayerComparisonMetric; label: string }> = [
  { key: 'average', label: 'Average' },
  { key: 'bestScore', label: 'Best Score' },
  { key: 'bestSeries', label: 'Best Series' },
  { key: 'games', label: '# of Games' },
  { key: 'strikeRate', label: 'Strike Rate' },
  { key: 'strikes', label: '# of Strikes' },
  { key: 'spareConversionRate', label: 'Spare Conversion' },
  { key: 'nines', label: '# of 9s' },
  { key: 'bestFrame', label: 'Best Frame' },
  { key: 'worstFrame', label: 'Worst Frame' },
];

function getComparisonMetricValue(
  row: LivePlayerComparisonRow,
  metric: LivePlayerComparisonMetric,
) {
  switch (metric) {
    case 'average':
      return row.average;
    case 'bestScore':
      return row.bestScore;
    case 'bestSeries':
      return row.bestSeries;
    case 'games':
      return row.games;
    case 'strikeRate':
      return row.strikeRate;
    case 'strikes':
      return row.strikes;
    case 'spareConversionRate':
      return row.spareConversionRate;
    case 'nines':
      return row.nines;
    case 'bestFrame':
      return row.bestFrame;
    case 'worstFrame':
      return row.worstFrame;
  }
}

function getStatsTileValue(
  stats: ReturnType<typeof buildLoggedSessionStats>,
  metric: LivePlayerComparisonMetric,
) {
  switch (metric) {
    case 'average':
      return stats.averageLabel;
    case 'bestScore':
      return stats.bestScoreLabel;
    case 'bestSeries':
      return stats.bestSeriesLabel;
    case 'games':
      return stats.gameCountLabel;
    case 'strikeRate':
      return stats.strikeRateLabel;
    case 'strikes':
      return stats.strikesLabel;
    case 'spareConversionRate':
      return stats.spareConversionRateLabel;
    case 'nines':
      return stats.ninesLabel;
    case 'bestFrame':
      return stats.bestFrameLabel;
    case 'worstFrame':
      return stats.worstFrameLabel;
  }
}

function formatComparisonMetricValue(
  metric: LivePlayerComparisonMetric,
  value: number | null,
) {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }

  if (
    metric === 'average' ||
    metric === 'bestFrame' ||
    metric === 'worstFrame' ||
    metric === 'strikeRate' ||
    metric === 'spareConversionRate'
  ) {
    const formatted = formatTenths(value);
    return metric === 'strikeRate' || metric === 'spareConversionRate'
      ? `${formatted}%`
      : formatted;
  }

  return String(Math.round(value));
}

function getComparisonMetricDisplayLabel(
  row: LivePlayerComparisonRow,
  metric: LivePlayerComparisonMetric,
) {
  if (metric === 'bestFrame') {
    return row.bestFrameLabel;
  }
  if (metric === 'worstFrame') {
    return row.worstFrameLabel;
  }

  return formatComparisonMetricValue(metric, getComparisonMetricValue(row, metric));
}

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

function getSelectedSelfPlayerKey(game: {
  player_name: string;
  selected_self_player_key?: string | null;
}) {
  return typeof game.selected_self_player_key === 'string' && game.selected_self_player_key.trim()
    ? game.selected_self_player_key.trim()
    : normalizePlayerKey(game.player_name);
}

function StatsTile({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={styles.statsLabel}>{label}</Text>
      <Text style={styles.statsValue}>{value}</Text>
    </>
  );

  if (!onPress) {
    return <View style={styles.statsTile}>{content}</View>;
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statsTile, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const queryClient = useQueryClient();
  const { store } = useUploadsProcessing();

  const gamesQuery = useQuery({
    queryKey: queryKeys.games,
    queryFn: fetchGames,
  });

  const grouping = useMemo(
    () => buildSessionGroups(gamesQuery.data?.games ?? []),
    [gamesQuery.data?.games],
  );
  const pendingOptimisticGroup = grouping.groups.find((entry) => entry.key === sessionId);
  const resolvedSessionId = getResolvedSessionRouteId(store, sessionId);
  const group =
    pendingOptimisticGroup ??
    (resolvedSessionId
      ? grouping.groups.find((entry) => entry.key === resolvedSessionId)
      : undefined);
  const pendingOptimisticRoute = store.finalizeOperations.some((operation) =>
    operation.optimisticSessions.some((entry) => entry.sessionId === sessionId),
  );

  const [editing, setEditing] = useState(false);
  const [deleteOptionsOpen, setDeleteOptionsOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [moveGameId, setMoveGameId] = useState<string | null>(null);
  const [moveDeletingSession, setMoveDeletingSession] = useState(false);
  const [pendingMoveTargetId, setPendingMoveTargetId] = useState<string | null>(null);
  const [pendingDeleteMoveTargetId, setPendingDeleteMoveTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'games' | 'stats'>('games');
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  const [selectedComparisonMetric, setSelectedComparisonMetric] =
    useState<LivePlayerComparisonMetric>('average');
  const [draftSelectedPlayerKeys, setDraftSelectedPlayerKeys] = useState<Record<string, string>>(
    {},
  );
  const scrollRef = useRef<ScrollView | null>(null);
  const pagerRef = useRef<ScrollView | null>(null);
  const comparisonCategoryScrollRef = useRef<ScrollView | null>(null);
  const pagerViewportYRef = useRef(0);
  const compareSectionYRef = useRef(0);
  const comparisonCategoryLayoutsRef = useRef<
    Partial<Record<LivePlayerComparisonMetric, { x: number; width: number }>>
  >({});
  const comparisonCategoryViewportWidthRef = useRef(0);
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));

  useEffect(() => {
    if (!group || group.isSessionless) {
      setDraftName('');
      setDraftDescription('');
      setDraftSelectedPlayerKeys({});
      return;
    }
    setDraftName(group.session?.name?.trim() || '');
    setDraftDescription(group.session?.description?.trim() || '');
    setDraftSelectedPlayerKeys(
      Object.fromEntries(
        group.games.map((game) => [game.id, getSelectedSelfPlayerKey(game)]),
      ),
    );
  }, [group]);

  useEffect(() => {
    if (!resolvedSessionId || !group?.sessionId || group.sessionId !== resolvedSessionId) {
      return;
    }

    if (sessionId === resolvedSessionId) {
      return;
    }

    router.replace(`/sessions/${resolvedSessionId}` as never);
  }, [group?.sessionId, resolvedSessionId, router, sessionId]);

  useEffect(() => {
    if (!resolvedSessionId || group) {
      return;
    }

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.games }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
    ]);
  }, [group, queryClient, resolvedSessionId]);

  const leaveSessionDetail = () => {
    if (Platform.OS === 'web') {
      router.replace('/sessions' as never);
      return;
    }
    navigateBackOrFallback(router, '/(tabs)/sessions', navigation);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!group?.sessionId) {
        throw new Error('Session was not found.');
      }
      return updateSession(
        group.sessionId,
        draftName,
        draftDescription,
        group.games
          .map((game) => ({
            gameId: game.id,
            selectedSelfPlayerKey:
              draftSelectedPlayerKeys[game.id] || getSelectedSelfPlayerKey(game),
          }))
          .filter((entry) => entry.selectedSelfPlayerKey),
      );
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

  if (!group && (resolvedSessionId || pendingOptimisticRoute || gamesQuery.isFetching)) {
    return <CenteredState title="Finishing session..." loading />;
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
  const stats = useMemo(() => buildLoggedSessionStats(group.games), [group.games]);
  const playerComparisons = useMemo(
    () =>
      buildLivePlayerComparisons(
        group.games.map((game) => ({ extraction: game.scoreboard_extraction })),
      ),
    [group.games],
  );
  const comparisonRows = useMemo(() => {
    return [...playerComparisons].sort((left, right) => {
      const leftValue = getComparisonMetricValue(left, selectedComparisonMetric);
      const rightValue = getComparisonMetricValue(right, selectedComparisonMetric);
      const normalizedLeft = leftValue ?? -1;
      const normalizedRight = rightValue ?? -1;
      if (normalizedRight !== normalizedLeft) {
        return normalizedRight - normalizedLeft;
      }
      return left.label.localeCompare(right.label);
    });
  }, [playerComparisons, selectedComparisonMetric]);
  const comparisonMaxValue = useMemo(() => {
    return comparisonRows.reduce((max, row) => {
      const value = getComparisonMetricValue(row, selectedComparisonMetric);
      return value !== null && value > max ? value : max;
    }, 0);
  }, [comparisonRows, selectedComparisonMetric]);
  const editableGameSelections = useMemo(
    () =>
      group.games.map((game) => ({
        game,
        title: grouping.gameTitleMap.get(game.id) || game.game_name?.trim() || 'Game',
        selectedKey: draftSelectedPlayerKeys[game.id] || getSelectedSelfPlayerKey(game),
        players: getResolvedPlayersForGame({ extraction: game.scoreboard_extraction }),
      })),
    [draftSelectedPlayerKeys, group.games, grouping.gameTitleMap],
  );
  const readOnlyUntilSynced = Boolean(
    group.session?.local_sync?.isReadOnlyUntilSynced ||
      group.games.some((game) => game.local_sync?.isReadOnlyUntilSynced),
  );
  const hasFailedLocalSync = Boolean(
    group.session?.local_sync?.syncState === 'failed' ||
      group.games.some((game) => game.local_sync?.syncState === 'failed'),
  );
  const hasPendingLocalSync = Boolean(
    group.session?.local_sync?.syncState === 'syncing' ||
      group.games.some((game) => game.local_sync?.syncState === 'syncing'),
  );
  const sessionActionsLocked = readOnlyUntilSynced;
  const firstLocalSyncError =
    group.session?.local_sync?.lastSyncError ||
    group.games.find((game) => game.local_sync?.syncState === 'failed')?.local_sync?.lastSyncError ||
    '';

  const handleDeleteSession = () => {
    if (!group.sessionId || group.isSessionless) {
      return;
    }

    setDeleteOptionsOpen(true);
  };

  const scrollToCompareSection = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, pagerViewportYRef.current + compareSectionYRef.current - spacing.md),
        animated: true,
      });
    });
  };

  const scrollComparisonCategoryIntoView = (metric: LivePlayerComparisonMetric) => {
    const layout = comparisonCategoryLayoutsRef.current[metric];
    if (!layout || !comparisonCategoryViewportWidthRef.current) {
      return;
    }

    const targetX = Math.max(
      0,
      layout.x - (comparisonCategoryViewportWidthRef.current - layout.width) / 2,
    );
    comparisonCategoryScrollRef.current?.scrollTo({ x: targetX, y: 0, animated: true });
  };

  const handleSelectComparisonMetric = (metric: LivePlayerComparisonMetric) => {
    scrollComparisonCategoryIntoView(metric);
    setSelectedComparisonMetric(metric);
  };

  const handlePressStatsTile = (metric: LivePlayerComparisonMetric) => {
    handleSelectComparisonMetric(metric);
    requestAnimationFrame(() => {
      scrollComparisonCategoryIntoView(metric);
      scrollToCompareSection();
    });
  };

  const scrollToTab = (tab: 'games' | 'stats', animated: boolean) => {
    if (!pagerWidth) {
      return;
    }

    pagerRef.current?.scrollTo({
      x: tab === 'stats' ? pagerWidth : 0,
      y: 0,
      animated,
    });
  };

  useEffect(() => {
    if (!pagerWidth) {
      return;
    }

    requestAnimationFrame(() => {
      scrollToTab(activeTab, false);
    });
  }, [pagerWidth]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        ref={scrollRef}
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

          {!group.isSessionless && !sessionActionsLocked ? (
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
              </View>
            </View>
          </View>
        </View>

        {error ? <InfoBanner tone="error" text={error} /> : null}
        {hasFailedLocalSync ? (
          <InfoBanner
            tone="error"
            text={
              firstLocalSyncError
                ? `${firstLocalSyncError} Open the affected game to fix its scoreboard, then sync will retry automatically.`
                : 'One or more games in this session need attention. Open the affected game to fix its scoreboard, then sync will retry automatically.'
            }
          />
        ) : hasPendingLocalSync ? (
          <InfoBanner text="This session is still syncing in the background. Session-level editing and deletion are disabled until it finishes." />
        ) : null}
        <UploadsProcessingBanner />

        {group.description ? <Text style={styles.description}>{group.description}</Text> : null}

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => {
              setActiveTab('games');
              scrollToTab('games', true);
            }}
            style={({ pressed }) => [
              styles.tabButton,
              activeTab === 'games' && styles.tabButtonActive,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.tabLabel, activeTab === 'games' && styles.tabLabelActive]}>Games</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setActiveTab('stats');
              scrollToTab('stats', true);
            }}
            style={({ pressed }) => [
              styles.tabButton,
              activeTab === 'stats' && styles.tabButtonActive,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.tabLabel, activeTab === 'stats' && styles.tabLabelActive]}>Stats</Text>
          </Pressable>
        </View>
        <View style={styles.tabDots}>
          <View style={[styles.tabDot, activeTab === 'games' && styles.tabDotActive]} />
          <View style={[styles.tabDot, activeTab === 'stats' && styles.tabDotActive]} />
        </View>

        <View
          style={[styles.pagerViewport, pagerWidth ? { width: pagerWidth } : null]}
          onLayout={(event) => {
            const nextLayout = event.nativeEvent.layout;
            pagerViewportYRef.current = nextLayout.y;
          }}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            scrollEnabled={pagerScrollEnabled}
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              if (!pagerWidth) {
                return;
              }

              const nextTab =
                Math.round(event.nativeEvent.contentOffset.x / pagerWidth) === 1 ? 'stats' : 'games';
              setActiveTab(nextTab);
            }}>
            <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
              <Text style={styles.guidance}>
                {hasFailedLocalSync
                  ? 'One or more games need attention. Open the affected game to fix names or marks, then the session will retry syncing automatically.'
                  : hasPendingLocalSync
                    ? 'This session is read-only while Uploads & Processing finishes syncing it.'
                  : 'Tap on a game to see more info. Hold down on a game to move it into a different session.'}
              </Text>

              <View style={styles.gameList}>
                {group.games.map((game) => (
                  <SessionGameCard
                    key={game.id}
                    game={game}
                    title={grouping.gameTitleMap.get(game.id) || game.game_name?.trim() || 'Game'}
                    meta={formatGameMeta(game.player_name, game.played_at, game.created_at)}
                    onRequestMove={setMoveGameId}
                    onScoreboardGestureStart={() => setPagerScrollEnabled(false)}
                    onScoreboardGestureEnd={() => setPagerScrollEnabled(true)}
                  />
                ))}
              </View>
            </View>
            <View style={[styles.pagerPage, pagerWidth ? { width: pagerWidth } : null]}>
              <View style={styles.statsGrid}>
                {comparisonCategories.map((category) => (
                  <StatsTile
                    key={category.key}
                    label={category.label}
                    value={getStatsTileValue(stats, category.key)}
                    onPress={() => handlePressStatsTile(category.key)}
                  />
                ))}
              </View>

              <View
                onLayout={(event) => {
                  compareSectionYRef.current = event.nativeEvent.layout.y;
                }}>
                <SurfaceCard style={styles.statsCompareCard}>
                  <Text style={styles.guidance}>Select category to compare players.</Text>
                  <ScrollView
                    ref={comparisonCategoryScrollRef}
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    onTouchStart={() => setPagerScrollEnabled(false)}
                    onTouchEnd={() => setPagerScrollEnabled(true)}
                    onTouchCancel={() => setPagerScrollEnabled(true)}
                    onScrollBeginDrag={() => setPagerScrollEnabled(false)}
                    onScrollEndDrag={() => setPagerScrollEnabled(true)}
                    onMomentumScrollEnd={() => setPagerScrollEnabled(true)}
                    onLayout={(event) => {
                      comparisonCategoryViewportWidthRef.current = event.nativeEvent.layout.width;
                    }}
                    contentContainerStyle={styles.comparisonCategoryRow}>
                    {comparisonCategories.map((category) => (
                      <Pressable
                        key={category.key}
                        onPress={() => handleSelectComparisonMetric(category.key)}
                        onLayout={(event) => {
                          comparisonCategoryLayoutsRef.current[category.key] = {
                            x: event.nativeEvent.layout.x,
                            width: event.nativeEvent.layout.width,
                          };
                        }}
                        style={({ pressed }) => [
                          styles.comparisonCategoryChip,
                          selectedComparisonMetric === category.key && styles.comparisonCategoryChipActive,
                          pressed && styles.pressed,
                        ]}>
                        <Text
                          style={[
                            styles.comparisonCategoryLabel,
                            selectedComparisonMetric === category.key && styles.comparisonCategoryLabelActive,
                          ]}>
                          {category.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>

                  <View style={styles.comparisonList}>
                    {comparisonRows.map((row) => {
                      const value = getComparisonMetricValue(row, selectedComparisonMetric);
                      const fillPercent =
                        value !== null && comparisonMaxValue > 0
                          ? Math.max(8, (value / comparisonMaxValue) * 100)
                          : 0;

                      return (
                        <View key={row.playerKey} style={styles.comparisonRow}>
                          <View style={styles.comparisonHeader}>
                            <Text style={styles.comparisonPlayerLabel}>
                              {canonicalizePlayerLabel(row.label)}
                            </Text>
                            <Text style={styles.comparisonValueLabel}>
                              {getComparisonMetricDisplayLabel(row, selectedComparisonMetric)}
                            </Text>
                          </View>
                          <View style={styles.comparisonBarTrack}>
                            <View
                              style={[
                                styles.comparisonBarFill,
                                { width: fillPercent > 0 ? `${fillPercent}%` : '0%' },
                              ]}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </SurfaceCard>
              </View>
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      {editing ? (
        <Modal transparent animationType="fade" visible={editing} onRequestClose={() => setEditing(false)}>
          <KeyboardAvoidingView
            behavior="padding"
            enabled={Platform.OS === 'ios'}
            style={styles.modalBackdrop}>
            <SurfaceCard style={styles.modalCard} tone="raised">
              <Text style={styles.modalTitle}>Edit session</Text>
              <KeyboardAwareScrollView
                style={styles.editScroll}
                contentContainerStyle={styles.editScrollContent}
                showsVerticalScrollIndicator={false}>
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
                <View style={styles.selectionSection}>
                  <Text style={styles.selectionSectionTitle}>Who are you in each game?</Text>
                  <Text style={styles.selectionSectionBody}>
                    Choose exactly one player for every logged scoreboard in this session.
                  </Text>
                  <View style={styles.selectionGameList}>
                    {editableGameSelections.map(({ game, title, selectedKey, players }, index) => (
                      <SurfaceCard key={game.id} style={styles.selectionGameCard}>
                        <Text style={styles.selectionGameTitle}>
                          {title || `Game ${index + 1}`}
                        </Text>
                        <View style={styles.selectionOptionList}>
                          {players.map((player) => {
                            const checked = player.playerKey === selectedKey;
                            return (
                              <Pressable
                                key={`${game.id}-${player.playerKey}`}
                                onPress={() =>
                                  setDraftSelectedPlayerKeys((current) => ({
                                    ...current,
                                    [game.id]: player.playerKey,
                                  }))
                                }
                                style={({ pressed }) => [
                                  styles.selectionOptionRow,
                                  pressed && styles.pressed,
                                ]}>
                                <MaterialIcons
                                  name={checked ? 'radio-button-checked' : 'radio-button-unchecked'}
                                  size={22}
                                  color={checked ? palette.accent : palette.muted}
                                />
                                <Text style={styles.selectionOptionLabel}>
                                  {canonicalizePlayerLabel(player.playerName)}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </SurfaceCard>
                    ))}
                  </View>
                </View>
              </KeyboardAwareScrollView>
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
      ) : null}

      {deleteOptionsOpen ? (
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
      ) : null}

      {moveDeletingSession ? (
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
      ) : null}

      {moveGameId ? (
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
      ) : null}
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
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  guidance: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tabButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  tabButtonActive: {
    backgroundColor: palette.accent,
  },
  tabLabel: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  tabLabelActive: {
    color: palette.text,
  },
  tabDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  pagerViewport: {
    alignSelf: 'center',
    overflow: 'hidden',
  },
  pagerPage: {
    gap: spacing.md,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
  },
  tabDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
  },
  tabDotActive: {
    backgroundColor: palette.dotActive,
  },
  gameList: {
    gap: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsTile: {
    width: '48%',
    backgroundColor: palette.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  statsLabel: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fontFamilySans,
  },
  statsValue: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  statsCompareCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  comparisonCategoryRow: {
    gap: spacing.sm,
  },
  comparisonCategoryChip: {
    minHeight: 38,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comparisonCategoryChipActive: {
    backgroundColor: palette.accent,
  },
  comparisonCategoryLabel: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  comparisonCategoryLabelActive: {
    color: palette.text,
  },
  comparisonList: {
    gap: spacing.md,
  },
  comparisonRow: {
    gap: spacing.xs,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  comparisonPlayerLabel: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    flex: 1,
    minWidth: 0,
  },
  comparisonValueLabel: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: fontFamilySans,
  },
  comparisonBarTrack: {
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    overflow: 'hidden',
  },
  comparisonBarFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: palette.accent,
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
  editScroll: {
    maxHeight: 420,
  },
  editScrollContent: {
    gap: spacing.md,
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
  selectionSection: {
    gap: spacing.sm,
  },
  selectionSectionTitle: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  selectionSectionBody: {
    color: palette.muted,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: fontFamilySans,
  },
  selectionGameList: {
    gap: spacing.sm,
  },
  selectionGameCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  selectionGameTitle: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  selectionOptionList: {
    gap: spacing.sm,
  },
  selectionOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectionOptionLabel: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
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
