import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { RefreshControl, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import EmptyStateCard from '@/components/empty-state-card';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import InlineLoadingCard from '@/components/inline-loading-card';
import ProfileAvatar from '@/components/profile-avatar';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { createInvite, fetchLeaderboardMetric, queryKeys } from '@/lib/backend';
import { formatTenths } from '@/lib/number-format';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { formatHandle } from '@/lib/profile';
import type { InviteLinkResponse, LeaderboardMetric, LeaderboardMetricRow } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

const TAB_HORIZONTAL_PADDING = 14;
const BOTTOM_DOTS_DOCK_HEIGHT = 34;

type MetricTabWidths = Partial<Record<LeaderboardMetric, number>>;
type MetricTabLayout = { x: number; width: number };

const METRIC_TABS: Array<{
  metric: LeaderboardMetric;
  label: string;
  description: string;
}> = [
  { metric: 'bestGame', label: 'Score', description: 'Highest Scoring Game' },
  { metric: 'bestAverage', label: 'Average', description: 'Average Score Across All Games' },
  { metric: 'bestSeries', label: 'Series', description: 'Best 3 Games Series' },
  { metric: 'bestSession', label: 'Best Session', description: 'Best Single Session Average Score' },
  { metric: 'StrikeRate', label: 'Strike Rate', description: 'Strike Rate' },
  { metric: 'SpareRate', label: 'Spare Rate', description: 'Spare Conversion Rate' },
  { metric: 'TotalStrikes', label: 'Strikes', description: 'Total Number of Strikes' },
  { metric: 'TotalSpares', label: 'Spares', description: 'Total Number of Spares' },
  { metric: 'mostGames', label: 'Games', description: 'Total Games Logged' },
  { metric: 'mostSessions', label: 'Sessions', description: 'Total Sessions Logged' },
  { metric: 'SessionScore', label: 'Session Score', description: 'Most Points Scored in a Session' },
  { metric: 'TotalPoints', label: 'Points', description: 'Total Points Across All Games' },
  { metric: 'SessionLength', label: 'Session Length', description: 'Most Games Played in a Session' },
  { metric: 'MostNines', label: '9 King', description: 'Total Frames with Score of 9' },
];

function formatMetricValue(metric: LeaderboardMetric, value: number) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (metric === 'bestAverage' || metric === 'bestSession') {
    return formatTenths(value);
  }
  if (metric === 'bestSeries') {
    return Math.round(value).toLocaleString();
  }
  if (metric === 'StrikeRate' || metric === 'SpareRate') {
    return `${formatTenths(value)}%`;
  }
  return Math.round(value).toLocaleString();
}

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isGuest, loading: authLoading } = useAuth();
  const isAndroid = Platform.OS === 'android';
  const [selectedMetric, setSelectedMetric] = useState<LeaderboardMetric>('bestGame');
  const [backgroundWarmupStarted, setBackgroundWarmupStarted] = useState(false);
  const [enabledMetrics, setEnabledMetrics] = useState<LeaderboardMetric[]>(['bestGame']);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState('');
  const [invitePayload, setInvitePayload] = useState<InviteLinkResponse | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [tabLabelWidths, setTabLabelWidths] = useState<MetricTabWidths>({});
  const tabScrollRef = useRef<ScrollView | null>(null);
  const pagerRef = useRef<ScrollView | null>(null);
  const pagerViewportRef = useRef<View | null>(null);
  const tabLayoutsRef = useRef<Partial<Record<LeaderboardMetric, MetricTabLayout>>>({});
  const tabViewportWidthRef = useRef(0);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerWidth = Math.max(0, Math.round(windowWidth - insets.left - insets.right));
  const [pagerTopOnScreen, setPagerTopOnScreen] = useState<number | null>(null);
  const pageMinHeight =
    pagerTopOnScreen != null
      ? Math.max(
          0,
          windowHeight - pagerTopOnScreen - BOTTOM_DOTS_DOCK_HEIGHT - insets.bottom,
        )
      : 0;

  const selectedMetricIndex = Math.max(
    0,
    METRIC_TABS.findIndex((entry) => entry.metric === selectedMetric),
  );
  const leaderboardMetricQueries = useQueries({
    queries: METRIC_TABS.map((entry) => ({
      queryKey: queryKeys.leaderboardMetric(entry.metric),
      queryFn: () => fetchLeaderboardMetric(entry.metric),
      enabled: !authLoading && !isGuest && enabledMetrics.includes(entry.metric),
    })),
  });
  const selectedMetricQuery = leaderboardMetricQueries[selectedMetricIndex];
  const selectedMetricData = selectedMetricQuery?.data ?? null;
  const enabledQueriesSettled = enabledMetrics.every((metric) => {
    const index = METRIC_TABS.findIndex((entry) => entry.metric === metric);
    const query = leaderboardMetricQueries[index];
    return Boolean(query && !query.isPending && !query.isFetching);
  });

  useEffect(() => {
    if (isGuest || authLoading) {
      setBackgroundWarmupStarted(false);
      setEnabledMetrics([selectedMetric]);
      return;
    }

    setEnabledMetrics((currentMetrics) =>
      currentMetrics.includes(selectedMetric)
        ? currentMetrics
        : [...currentMetrics, selectedMetric],
    );
  }, [authLoading, isGuest, selectedMetric]);

  useEffect(() => {
    if (!isGuest && !authLoading && selectedMetricData && !backgroundWarmupStarted) {
      setBackgroundWarmupStarted(true);
    }
  }, [authLoading, backgroundWarmupStarted, isGuest, selectedMetricData]);

  useEffect(() => {
    if (!backgroundWarmupStarted || isGuest || authLoading) {
      return;
    }

    if (!enabledQueriesSettled) {
      return;
    }

    const nextMetric = METRIC_TABS.find((entry) => !enabledMetrics.includes(entry.metric))?.metric;
    if (!nextMetric) {
      return;
    }

    const timer = setTimeout(() => {
      setEnabledMetrics((currentMetrics) =>
        currentMetrics.includes(nextMetric) ? currentMetrics : [...currentMetrics, nextMetric],
      );
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [
    authLoading,
    backgroundWarmupStarted,
    enabledMetrics,
    enabledQueriesSettled,
    isGuest,
  ]);

  const inviteMutation = useMutation({
    mutationFn: createInvite,
    onSuccess: (payload) => {
      setInvitePayload(payload);
      setInvitePanelOpen(true);
      setInviteLinkCopied(false);
      setInviteStatus('');
    },
    onError: (error) => {
      setInviteStatus(error instanceof Error ? error.message : 'Failed to create invite link.');
    },
  });

  useEffect(() => {
    if (!isGuest) {
      return;
    }
    setInvitePanelOpen(false);
    setInvitePayload(null);
    setInviteLinkCopied(false);
    setInviteStatus('');
  }, [isGuest]);

  const fallbackSelfUserId =
    selectedMetricData?.selfUserId ??
    leaderboardMetricQueries.find((query) => query.data)?.data?.selfUserId ??
    '';
  const selectedMetricError = selectedMetricQuery?.error ?? null;
  const metricPages = METRIC_TABS.map((entry, index) => {
    const query = leaderboardMetricQueries[index];
    const data = query.data;
    const selfUserId = data?.selfUserId ?? fallbackSelfUserId;
    const rankedRows: LeaderboardMetricRow[] = data?.rows ?? [];
    const queryEnabled = !authLoading && !isGuest && enabledMetrics.includes(entry.metric);
    const errorMessage =
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? 'Failed to load leaderboard.'
          : '';

    return {
      ...entry,
      rankedRows,
      selfUserId,
      yourRank: rankedRows.find((row) => row.userId === selfUserId)?.rank ?? null,
      isLoading: !isGuest && !data && queryEnabled && query.isPending,
      errorMessage,
    };
  });

  const handleTabLabelLayout = (metric: LeaderboardMetric, event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
      return;
    }

    setTabLabelWidths((current) => {
      if (current[metric] === nextWidth) {
        return current;
      }
      return { ...current, [metric]: nextWidth };
    });
  };

  const handleTabLayout = (metric: LeaderboardMetric, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayoutsRef.current[metric] = { x, width };
  };

  const scrollMetricChipIntoView = useCallback((metric: LeaderboardMetric, animated: boolean) => {
    const layout = tabLayoutsRef.current[metric];
    if (!layout || !tabViewportWidthRef.current) {
      return;
    }

    const targetX = Math.max(0, layout.x - (tabViewportWidthRef.current - layout.width) / 2);
    tabScrollRef.current?.scrollTo({ x: targetX, y: 0, animated });
  }, []);

  const scrollToMetricPage = useCallback((metric: LeaderboardMetric, animated: boolean) => {
    if (!pagerWidth) {
      return;
    }

    const index = METRIC_TABS.findIndex((entry) => entry.metric === metric);
    if (index === -1) {
      return;
    }

    pagerRef.current?.scrollTo({
      x: index * pagerWidth,
      y: 0,
      animated,
    });
  }, [pagerWidth]);

  const handleSelectMetric = useCallback((metric: LeaderboardMetric, animated: boolean) => {
    setSelectedMetric(metric);
    scrollMetricChipIntoView(metric, animated);
    scrollToMetricPage(metric, animated);
  }, [scrollMetricChipIntoView, scrollToMetricPage]);

  useEffect(() => {
    if (!pagerWidth) {
      return;
    }

    requestAnimationFrame(() => {
      scrollToMetricPage(selectedMetric, false);
      scrollMetricChipIntoView(selectedMetric, false);
    });
  }, [pagerWidth, scrollMetricChipIntoView, scrollToMetricPage, selectedMetric]);

  const handleInvite = async () => {
    if (isGuest) {
      router.push('/login?next=/(tabs)/friends');
      return;
    }
    inviteMutation.mutate();
  };

  const handleCopyInvite = async () => {
    if (!invitePayload?.inviteUrl) {
      return;
    }
    await Clipboard.setStringAsync(invitePayload.inviteUrl);
    setInviteLinkCopied(true);
    setInviteStatus('');
  };

  const handleShareInvite = async () => {
    if (!invitePayload?.inviteUrl) {
      return;
    }
    try {
      await Share.share({
        title: 'PinPoint',
        message: `Join my PinPoint friends list: ${invitePayload.inviteUrl}`,
        url: invitePayload.inviteUrl,
      });
      setInviteStatus('Invite shared.');
    } catch {
      // dismissed share sheet
    }
  };

  const handleRefresh = async () => {
    if (isGuest) {
      return;
    }

    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.leaderboard,
        refetchType: 'none',
      });
      await leaderboardMetricQueries[selectedMetricIndex]?.refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ScreenShell
      title="Friends"
      bodyStyle={styles.body}
      contentStyle={{
        paddingBottom: BOTTOM_DOTS_DOCK_HEIGHT + spacing.xl,
      }}
      overlay={
        <View pointerEvents="none" style={styles.bottomOverlay}>
          <View style={styles.bottomDotsDock}>
            <View style={styles.tabDots}>
              {METRIC_TABS.map((tab) => (
                <View
                  key={`${tab.metric}-dot`}
                  style={[styles.tabDot, selectedMetric === tab.metric && styles.tabDotActive]}
                />
              ))}
            </View>
          </View>
        </View>
      }
      refreshControl={
        !isGuest ? (
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={palette.spinner}
          />
        ) : undefined
      }
      headerRight={
        <Pressable
          onPress={handleInvite}
          style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}>
          <Ionicons name="add" size={18} color={palette.text} />
          <Text style={styles.inviteButtonText}>
            {inviteMutation.isPending ? 'Preparing...' : 'Invite friend'}
          </Text>
        </Pressable>
      }>
      {isAndroid ? (
        <View pointerEvents="none" style={styles.hiddenMeasureContainer} collapsable={false}>
          {METRIC_TABS.map((tab) => (
            <View key={`${tab.metric}-measure`} collapsable={false}>
              <Text
                onLayout={(event) => handleTabLabelLayout(tab.metric, event)}
                style={[styles.tabText, styles.tabTextAndroid, styles.hiddenMeasureText]}>
                {tab.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <ScrollView
        ref={tabScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        onLayout={(event) => {
          tabViewportWidthRef.current = event.nativeEvent.layout.width;
        }}>
        {METRIC_TABS.map((tab) => (
          <Pressable
            key={tab.metric}
            onLayout={(event) => handleTabLayout(tab.metric, event)}
            onPress={() => handleSelectMetric(tab.metric, true)}
            style={({ pressed }) => [
              styles.tab,
              isAndroid && tabLabelWidths[tab.metric]
                ? { minWidth: tabLabelWidths[tab.metric]! + TAB_HORIZONTAL_PADDING * 2 }
                : null,
              selectedMetric === tab.metric && styles.tabActive,
              pressed && styles.pressed,
            ]}>
            <Text
              numberOfLines={isAndroid ? 1 : undefined}
              ellipsizeMode={isAndroid ? 'clip' : undefined}
              style={[
                styles.tabText,
                isAndroid ? styles.tabTextAndroid : styles.tabTextDefault,
                selectedMetric === tab.metric && styles.tabTextActive,
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {isGuest ? <InfoBanner text="Sign in with an account to invite friends and view leaderboards." /> : null}

      {inviteStatus ? <InfoBanner text={inviteStatus} /> : null}

      {!isGuest && selectedMetricError ? (
        <InfoBanner
          tone="error"
          text={
            selectedMetricError instanceof Error
              ? selectedMetricError.message
              : 'Failed to load leaderboard.'
          }
        />
      ) : null}

      <View
        ref={pagerViewportRef}
        onLayout={() => {
          pagerViewportRef.current?.measureInWindow((_x, y) => {
            setPagerTopOnScreen(y);
          });
        }}
        style={[styles.pagerViewport, pagerWidth ? { width: pagerWidth } : null]}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => {
            if (!pagerWidth) {
              return;
            }

            const nextIndex = Math.max(
              0,
              Math.min(
                METRIC_TABS.length - 1,
                Math.round(event.nativeEvent.contentOffset.x / pagerWidth),
              ),
            );
            const nextMetric = METRIC_TABS[nextIndex]?.metric;
            if (!nextMetric) {
              return;
            }

            setSelectedMetric(nextMetric);
            scrollMetricChipIntoView(nextMetric, true);
          }}>
          {metricPages.map((page) => (
            <View
              key={page.metric}
              style={[
                styles.pagerPage,
                pagerWidth ? { width: pagerWidth } : null,
                pageMinHeight ? { minHeight: pageMinHeight } : null,
              ]}>
              <View style={styles.metricSummary}>
                <Text style={styles.metricDescription}>{page.description}</Text>
                <Text style={styles.metricRank}>{page.yourRank ? `#${page.yourRank}` : '—'}</Text>
              </View>

              <View style={styles.leaderboardList}>
                {page.errorMessage ? (
                  <InfoBanner tone="error" text={page.errorMessage} />
                ) : page.isLoading ? (
                  <InlineLoadingCard label="Loading leaderboard..." />
                ) : page.rankedRows.length === 0 ? (
                  <EmptyStateCard
                    title={isGuest ? 'Sign in to view friends' : 'No leaderboard entries yet'}
                    body={
                      isGuest
                        ? 'Create an account to invite friends and compare stats.'
                        : 'Invite a friend to start comparing stats.'
                    }
                    actionLabel={isGuest ? 'Sign In / Create Account' : 'Invite a Friend'}
                    onAction={() => {
                      if (isGuest) {
                        router.push('/login?next=/(tabs)/friends');
                        return;
                      }
                      inviteMutation.mutate();
                    }}
                    tone="raised"
                  />
                ) : (
                  <>
                    {!isGuest &&
                    page.rankedRows.every((row) => row.userId === page.selfUserId) ? (
                      <EmptyStateCard
                        title="No friends yet"
                        body="Invite a friend to start comparing stats."
                        actionLabel="Invite a Friend"
                        onAction={() => {
                          inviteMutation.mutate();
                        }}
                        tone="raised"
                      />
                    ) : null}
                    {page.rankedRows.map((row) => (
                      <View key={row.userId} style={styles.leaderboardRow}>
                        <Text style={styles.rankText}>{row.rank}</Text>
                        <ProfileAvatar
                          size={42}
                          avatarKind={row.avatarKind}
                          avatarPresetId={row.avatarPresetId}
                          avatarUrl={row.avatarUrl}
                          initials={row.initials}
                          username={row.username}
                        />
                        <Text
                          style={[
                            styles.rowName,
                            row.userId === page.selfUserId && styles.rowNameSelf,
                          ]}
                          numberOfLines={1}>
                          {formatHandle(row.username)}
                        </Text>
                        <Text style={styles.rowValue}>
                          {formatMetricValue(page.metric, row.metricValue)}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <Modal transparent animationType="fade" visible={invitePanelOpen}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <View style={styles.modalCloseRow}>
              <View />
              <IconAction
                accessibilityLabel="Close invite panel"
                onPress={() => {
                  setInvitePanelOpen(false);
                  setInviteLinkCopied(false);
                }}
                icon={<Ionicons name="close" size={20} color={palette.muted} />}
              />
            </View>
            <Text style={styles.modalTitle}>Send your friends a link</Text>
            <Text style={styles.modalText}>
              Share your persistent PinPoint invite link. Anyone who opens it can accept and
              join your leaderboard.
            </Text>

            <ActionButton
              label={inviteLinkCopied ? 'Copied' : 'Copy link'}
              onPress={handleCopyInvite}
              style={inviteLinkCopied ? styles.copiedButton : undefined}
              leftIcon={
                inviteLinkCopied ? (
                  <Ionicons name="checkmark" size={18} color={palette.text} />
                ) : undefined
              }
            />
            <ActionButton label="Share link" onPress={handleShareInvite} />
            <ActionButton
              label="Close"
              onPress={() => {
                setInvitePanelOpen(false);
                setInviteLinkCopied(false);
              }}
              variant="secondary"
            />
          </SurfaceCard>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 16,
  },
  inviteButton: {
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
  },
  inviteButtonText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  tabsRow: {
    gap: 10,
    paddingRight: spacing.xs,
  },
  hiddenMeasureContainer: {
    position: 'absolute',
    left: -10_000,
    top: -10_000,
    opacity: 0,
  },
  hiddenMeasureText: {
    alignSelf: 'flex-start',
  },
  tabDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
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
  tab: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: TAB_HORIZONTAL_PADDING,
    paddingVertical: 9,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  tabActive: {
    backgroundColor: palette.accent,
  },
  tabText: {
    color: palette.navIcon,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 0,
  },
  tabTextDefault: {
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  tabTextAndroid: {
    includeFontPadding: false,
  },
  tabTextActive: {
    color: palette.text,
  },
  metricSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: 4,
    paddingBottom: 0,
  },
  metricDescription: {
    color: palette.muted,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: fontFamilySans,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  metricRank: {
    color: palette.text,
    fontSize: 48,
    lineHeight: 48,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    flexShrink: 0,
  },
  leaderboardList: {
    gap: 4,
  },
  pagerViewport: {
    alignSelf: 'center',
    overflow: 'hidden',
  },
  pagerPage: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    flexShrink: 0,
  },
  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: BOTTOM_DOTS_DOCK_HEIGHT,
  },
  bottomDotsDock: {
    height: BOTTOM_DOTS_DOCK_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.background,
    paddingHorizontal: spacing.lg,
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
  leaderboardRow: {
    paddingVertical: 12,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankText: {
    color: palette.muted,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    width: 36,
    textAlign: 'center',
  },
  rowName: {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamilySans,
    flex: 1,
    minWidth: 0,
  },
  rowNameSelf: {
    fontWeight: '700',
  },
  rowValue: {
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    fontFamily: fontFamilySans,
    minWidth: 56,
    flexShrink: 0,
    textAlign: 'right',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalCloseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  modalText: {
    color: palette.muted,
    fontSize: 15,
    lineHeight: 21,
    fontFamily: fontFamilySans,
  },
  copiedButton: {
    backgroundColor: palette.accentSoft,
  },
  pressed: {
    opacity: 0.9,
  },
});
