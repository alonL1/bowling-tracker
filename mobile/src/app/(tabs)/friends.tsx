import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { RefreshControl, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ActionButton from '@/components/action-button';
import CenteredState from '@/components/centered-state';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import ScreenShell from '@/components/screen-shell';
import SurfaceCard from '@/components/surface-card';
import { createInvite, fetchLeaderboard, queryKeys } from '@/lib/backend';
import { formatTenths } from '@/lib/number-format';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import type { InviteLinkResponse, LeaderboardMetric, LeaderboardRow } from '@/lib/types';
import { useAuth } from '@/providers/auth-provider';

type RankedRow = LeaderboardRow & {
  rank: number;
  metricValue: number;
};

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

function getMetricValue(row: LeaderboardRow, metric: LeaderboardMetric) {
  return row.metrics[metric] ?? 0;
}

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
  const { isGuest, loading: authLoading } = useAuth();
  const [selectedMetric, setSelectedMetric] = useState<LeaderboardMetric>('bestGame');
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState('');
  const [invitePayload, setInvitePayload] = useState<InviteLinkResponse | null>(null);

  const leaderboardQuery = useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: fetchLeaderboard,
    enabled: !authLoading && !isGuest,
  });

  const inviteMutation = useMutation({
    mutationFn: createInvite,
    onSuccess: (payload) => {
      setInvitePayload(payload);
      setInvitePanelOpen(true);
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
    setInviteStatus('');
  }, [isGuest]);

  const participants = isGuest ? [] : leaderboardQuery.data?.participants ?? [];
  const selfUserId = isGuest ? '' : leaderboardQuery.data?.selfUserId ?? '';

  const rankedRows = useMemo<RankedRow[]>(() => {
    const sorted = [...participants].sort((left, right) => {
      const delta = getMetricValue(right, selectedMetric) - getMetricValue(left, selectedMetric);
      if (delta !== 0) {
        return delta;
      }
      const nameDelta = left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: 'base',
      });
      if (nameDelta !== 0) {
        return nameDelta;
      }
      return left.userId.localeCompare(right.userId);
    });

    let previousValue: number | null = null;
    let previousRank = 0;

    return sorted.map((row, index) => {
      const metricValue = getMetricValue(row, selectedMetric);
      const rank =
        index === 0
          ? 1
          : previousValue !== null && metricValue === previousValue
            ? previousRank
            : index + 1;
      previousValue = metricValue;
      previousRank = rank;
      return { ...row, rank, metricValue };
    });
  }, [participants, selectedMetric]);

  const selectedMetricDetail = useMemo(
    () => METRIC_TABS.find((entry) => entry.metric === selectedMetric) ?? METRIC_TABS[0],
    [selectedMetric],
  );

  const yourRank = useMemo(() => {
    return rankedRows.find((entry) => entry.userId === selfUserId)?.rank ?? null;
  }, [rankedRows, selfUserId]);

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
    setInviteStatus('Invite link copied.');
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

  if (leaderboardQuery.isPending && !isGuest) {
    return <CenteredState title="Loading leaderboard..." loading />;
  }

  return (
    <ScreenShell
      title="Friends"
      bodyStyle={styles.body}
      refreshControl={
        !isGuest ? (
          <RefreshControl
            refreshing={leaderboardQuery.isRefetching}
            onRefresh={() => void leaderboardQuery.refetch()}
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}>
        {METRIC_TABS.map((tab) => (
          <Pressable
            key={tab.metric}
            onPress={() => setSelectedMetric(tab.metric)}
            style={({ pressed }) => [
              styles.tab,
              selectedMetric === tab.metric && styles.tabActive,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.tabText, selectedMetric === tab.metric && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.metricSummary}>
        <Text style={styles.metricDescription}>{selectedMetricDetail.description}</Text>
        <Text style={styles.metricRank}>{yourRank ? `#${yourRank}` : '—'}</Text>
      </View>

      {isGuest ? <InfoBanner text="Sign in with an account to invite friends and view leaderboards." /> : null}

      {inviteStatus ? <InfoBanner text={inviteStatus} /> : null}

      {!isGuest && leaderboardQuery.error ? (
        <InfoBanner
          tone="error"
          text={
            leaderboardQuery.error instanceof Error
              ? leaderboardQuery.error.message
              : 'Failed to load leaderboard.'
          }
        />
      ) : null}

      <View style={styles.leaderboardList}>
        {rankedRows.length === 0 ? (
          <SurfaceCard style={styles.emptyCard} tone="raised">
            <Text style={styles.emptyTitle}>
              {isGuest ? 'Sign in to view friends' : 'No leaderboard entries yet'}
            </Text>
            <Text style={styles.emptyText}>
              {isGuest
                ? 'Guests cannot have friends. Sign in with an account to invite friends and compare stats.'
                : 'Invite a friend to start comparing stats.'}
            </Text>
          </SurfaceCard>
        ) : (
          rankedRows.map((row) => (
            <View key={row.userId} style={styles.leaderboardRow}>
              <Text style={styles.rankText}>{row.rank}</Text>
              <Text
                style={[
                  styles.rowName,
                  row.userId === selfUserId && styles.rowNameSelf,
                ]}
                numberOfLines={1}>
                {row.displayName}
              </Text>
              <Text style={styles.rowValue}>
                {formatMetricValue(selectedMetric, row.metricValue)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Modal transparent animationType="fade" visible={invitePanelOpen}>
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.modalCard} tone="raised">
            <View style={styles.modalCloseRow}>
              <View />
              <IconAction
                accessibilityLabel="Close invite panel"
                onPress={() => setInvitePanelOpen(false)}
                icon={<Ionicons name="close" size={20} color={palette.muted} />}
              />
            </View>
            <Text style={styles.modalTitle}>Send your friends a link</Text>
            <Text style={styles.modalText}>
              Share your persistent PinPoint invite link. Anyone who opens it can accept and
              join your leaderboard.
            </Text>

            <ActionButton label="Copy link" onPress={handleCopyInvite} />
            <ActionButton label="Share link" onPress={handleShareInvite} />
            <ActionButton label="Close" onPress={() => setInvitePanelOpen(false)} variant="secondary" />
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
    paddingRight: spacing.lg,
  },
  tab: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: palette.accent,
  },
  tabText: {
    color: palette.navIcon,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
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
    paddingBottom: 6,
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
  pressed: {
    opacity: 0.9,
  },
});
