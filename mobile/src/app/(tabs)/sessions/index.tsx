import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import CenteredState from '@/components/centered-state';
import EmptyStateCard from '@/components/empty-state-card';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import SessionCard, { type SessionMetaSegment } from '@/components/session-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { buildSessionGroups, type SessionGroup } from '@/lib/bowling';
import { useLoggedGames } from '@/hooks/use-logged-data';
import { buildLoggedSessionStats } from '@/lib/live-session';
import { useAuth } from '@/providers/auth-provider';

type SessionSortOption =
  | 'createdAt'
  | 'firstGameDate'
  | 'average'
  | 'bestGame'
  | 'mostGames'
  | 'strikeRate';

type SessionSortEntry = {
  session: SessionGroup;
  createdAtTs: number;
  firstGameTs: number;
  averageValue: number | null;
  bestGameValue: number | null;
  strikeRateValue: number | null;
  metaSegments: SessionMetaSegment[];
};

const SORT_MENU_WIDTH = 212;
const sortOptions: Array<{ key: SessionSortOption; label: string }> = [
  { key: 'firstGameDate', label: 'First Game Date' },
  { key: 'createdAt', label: 'Created At Date' },
  { key: 'average', label: 'Average' },
  { key: 'bestGame', label: 'Best Game' },
  { key: 'mostGames', label: 'Most Games' },
  { key: 'strikeRate', label: 'Strike Rate' },
];

function parseDateValue(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetricValue(value: string) {
  const parsed = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNullableDesc(left: number | null, right: number | null) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function getCreatedAtTimestamp(session: SessionGroup) {
  return parseDateValue(session.session?.created_at);
}

function getFirstGameTimestamp(session: SessionGroup) {
  const earliestGameTime = session.games.reduce((earliest, game) => {
    const timestamp = parseDateValue(game.played_at || game.created_at);
    if (timestamp === 0) {
      return earliest;
    }
    if (earliest === 0 || timestamp < earliest) {
      return timestamp;
    }
    return earliest;
  }, 0);

  if (earliestGameTime > 0) {
    return earliestGameTime;
  }

  return parseDateValue(session.session?.started_at);
}

function buildMetaSegments(
  session: SessionGroup,
  sortOption: SessionSortOption,
  bestGameLabel: string,
  strikeRateLabel: string,
): SessionMetaSegment[] {
  const gameLabel = `${session.gameCount} ${session.gameCount === 1 ? 'game' : 'games'}`;
  const averageLabel = `Avg ${session.averageLabel}`;

  if (sortOption === 'mostGames') {
    return [
      { label: gameLabel, emphasized: true },
      { label: averageLabel },
    ];
  }

  if (sortOption === 'average') {
    return [
      { label: gameLabel },
      { label: averageLabel, emphasized: true },
    ];
  }

  if (sortOption === 'bestGame') {
    return [
      { label: gameLabel },
      { label: averageLabel },
      { label: bestGameLabel, emphasized: true },
    ];
  }

  if (sortOption === 'strikeRate') {
    return [
      { label: gameLabel },
      { label: averageLabel },
      { label: strikeRateLabel, emphasized: true },
    ];
  }

  return [{ label: gameLabel }, { label: averageLabel }];
}

export default function SessionsScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { isGuest } = useAuth();
  const [sortOption, setSortOption] = useState<SessionSortOption>('firstGameDate');
  const [sortOpen, setSortOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortButtonAnchor, setSortButtonAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const sortButtonRef = useRef<View | null>(null);

  const gamesQuery = useLoggedGames();

  const sessionSortEntries = useMemo(() => {
    const groups = buildSessionGroups(gamesQuery.games).groups;
    const normalSessions = groups.filter((group) => !group.isSessionless);
    const sessionlessGroups = groups.filter((group) => group.isSessionless);

    const sortedNormalSessions = normalSessions
      .map<SessionSortEntry>((session) => {
        const stats = buildLoggedSessionStats(session.games);

        return {
          session,
          createdAtTs: getCreatedAtTimestamp(session),
          firstGameTs: getFirstGameTimestamp(session),
          averageValue: parseMetricValue(session.averageLabel),
          bestGameValue: parseMetricValue(stats.bestScoreLabel),
          strikeRateValue: parseMetricValue(stats.strikeRateLabel),
          metaSegments: buildMetaSegments(
            session,
            sortOption,
            stats.bestScoreLabel,
            stats.strikeRateLabel,
          ),
        };
      })
      .sort((left, right) => {
        let diff = 0;

        switch (sortOption) {
          case 'createdAt':
            diff = right.createdAtTs - left.createdAtTs;
            break;
          case 'firstGameDate':
            diff = right.firstGameTs - left.firstGameTs;
            break;
          case 'average':
            diff = compareNullableDesc(left.averageValue, right.averageValue);
            break;
          case 'bestGame':
            diff = compareNullableDesc(left.bestGameValue, right.bestGameValue);
            break;
          case 'mostGames':
            diff = right.session.gameCount - left.session.gameCount;
            break;
          case 'strikeRate':
            diff = compareNullableDesc(left.strikeRateValue, right.strikeRateValue);
            break;
        }

        if (diff !== 0) {
          return diff;
        }

        const firstGameDiff = right.firstGameTs - left.firstGameTs;
        if (firstGameDiff !== 0) {
          return firstGameDiff;
        }

        const createdAtDiff = right.createdAtTs - left.createdAtTs;
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }

        return right.session.key.localeCompare(left.session.key);
      });

    return [
      ...sortedNormalSessions,
      ...sessionlessGroups.map((session) => ({
        session,
        createdAtTs: 0,
        firstGameTs: 0,
        averageValue: null,
        bestGameValue: null,
        strikeRateValue: null,
        metaSegments: buildMetaSegments(session, sortOption, '—', '—'),
      })),
    ];
  }, [gamesQuery.games, sortOption]);

  const sortMenuLeft = useMemo(() => {
    if (!sortButtonAnchor) {
      return Math.max(spacing.lg, windowWidth - spacing.lg - SORT_MENU_WIDTH);
    }

    return Math.max(
      spacing.lg,
      Math.min(
        sortButtonAnchor.x + sortButtonAnchor.width - SORT_MENU_WIDTH,
        windowWidth - spacing.lg - SORT_MENU_WIDTH,
      ),
    );
  }, [sortButtonAnchor, windowWidth]);

  const sortMenuTop = (sortButtonAnchor?.y ?? 0) + (sortButtonAnchor?.height ?? 0) + spacing.sm;

  const openSortMenu = () => {
    if (sortOpen) {
      setSortOpen(false);
      return;
    }

    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      setSortButtonAnchor({ x, y, width, height });
      setSortOpen(true);
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await gamesQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (gamesQuery.isPending) {
    return <CenteredState title="Loading sessions..." loading />;
  }

  return (
    <>
      <ScreenShell
        title="Sessions"
        headerRight={
          <View ref={sortButtonRef} collapsable={false}>
            <Pressable
              onPress={openSortMenu}
              style={({ pressed }) => [styles.sortButton, pressed && styles.sortButtonPressed]}>
              <MaterialIcons name="sort" size={18} color={palette.text} />
              <Text style={styles.sortButtonLabel}>Sort</Text>
            </Pressable>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={palette.spinner}
          />
        }>
        {isGuest ? (
          <InfoBanner text="You are browsing in a guest session. Sign in to keep these logs on your account." />
        ) : null}

        {gamesQuery.statusLabel ? <InfoBanner text={gamesQuery.statusLabel} /> : null}

        {gamesQuery.needsOnlineFirst ? (
          <InfoBanner text="Open PinPoint online once to save your logs on this device." />
        ) : null}

        {gamesQuery.error && !gamesQuery.statusLabel ? (
          <InfoBanner
            tone="error"
            text={gamesQuery.error instanceof Error ? gamesQuery.error.message : 'Failed to load sessions.'}
          />
        ) : null}
        <View style={styles.list}>
          {sessionSortEntries.length === 0 ? (
            <EmptyStateCard
              title="No sessions yet"
              body="Log your first games and they will show up here."
              actionLabel="Go to Record"
              onAction={() => router.push('/(tabs)/record')}
            />
          ) : (
            sessionSortEntries.map(({ session, metaSegments }) => (
              <SessionCard
                key={session.key}
                session={session}
                metaSegments={metaSegments}
                onPress={() =>
                  router.push({
                    pathname: '/sessions/[sessionId]',
                    params: { sessionId: session.key },
                  })
                }
              />
            ))
          )}
        </View>
      </ScreenShell>

      {sortOpen ? (
        <Modal transparent animationType="fade" visible={sortOpen} onRequestClose={() => setSortOpen(false)}>
          <Pressable style={styles.sortOverlay} onPress={() => setSortOpen(false)}>
            <Pressable
              style={[
                styles.sortMenu,
                {
                  top: sortMenuTop,
                  left: sortMenuLeft,
                  width: SORT_MENU_WIDTH,
                },
              ]}
              onPress={() => {}}>
              {sortOptions.map((option) => {
                const active = option.key === sortOption;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => {
                      setSortOption(option.key);
                      setSortOpen(false);
                    }}
                    style={({ pressed }) => [styles.sortOption, pressed && styles.sortOptionPressed]}>
                    <Text style={[styles.sortOptionLabel, active && styles.sortOptionLabelActive]}>
                      {option.label}
                    </Text>
                    {active ? <MaterialIcons name="check" size={18} color={palette.text} /> : null}
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  sortButton: {
    minHeight: 40,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    backgroundColor: palette.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sortButtonPressed: {
    opacity: 0.92,
  },
  sortButtonLabel: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sortOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sortMenu: {
    position: 'absolute',
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.xs,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 18,
  },
  sortOption: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sortOptionPressed: {
    backgroundColor: palette.surfaceRaised,
  },
  sortOptionLabel: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamilySans,
  },
  sortOptionLabelActive: {
    color: palette.text,
    fontWeight: '600',
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  emptyText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
});
