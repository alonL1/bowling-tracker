import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ActionButton from '@/components/action-button';
import IconAction from '@/components/icon-action';
import InfoBanner from '@/components/info-banner';
import InlineLoadingCard from '@/components/inline-loading-card';
import ProfileAvatar from '@/components/profile-avatar';
import SurfaceCard from '@/components/surface-card';
import { palette, radii, spacing } from '@/constants/palette';
import { fontFamilySans } from '@/constants/typography';
import { fetchLeaderboardCompare, queryKeys } from '@/lib/backend';
import {
  formatLeaderboardMetricValue,
  LEADERBOARD_METRIC_DETAILS,
  LEADERBOARD_METRIC_ORDER,
  LEADERBOARD_RANGE_LABELS,
} from '@/lib/leaderboard';
import { formatHandle } from '@/lib/profile';
import type {
  LeaderboardCompareParticipant,
  LeaderboardMetric,
  LeaderboardMetricRow,
  LeaderboardRange,
} from '@/lib/types';

const COMPARISON_RANGES: LeaderboardRange[] = ['allTime', 'last30'];

const AVATAR_SIZE = 44;
const LEGEND_DOT_SIZE = 8;
// Everything in the opponent group other than the handle itself: the avatar, the
// legend dot, and the two gaps separating them from the handle.
const OPPONENT_GROUP_CHROME_WIDTH =
  AVATAR_SIZE + spacing.sm + LEGEND_DOT_SIZE + spacing.xs;

// A bar side that would otherwise be a hairline still gets a visible sliver.
const MIN_VISIBLE_SHARE = 0.04;

type ComparisonRow = {
  metric: LeaderboardMetric;
  label: string;
  selfValue: number | null;
  opponentValue: number | null;
  winner: 'self' | 'opponent' | 'tie' | 'none';
};

type FriendComparisonModalProps = {
  visible: boolean;
  opponent: LeaderboardMetricRow | null;
  selfRow: LeaderboardMetricRow | null;
  selfUserId: string;
  onClose: () => void;
};

// The API always returns 0 rather than null/NaN, so "no games in this window"
// has to come from the game count. Without this gate a friend who has not
// bowled in 30 days renders as a 14-way 0-0 tie.
function buildComparisonRows(
  self: LeaderboardCompareParticipant | null,
  opponent: LeaderboardCompareParticipant | null,
  range: LeaderboardRange,
): ComparisonRow[] {
  const selfMetrics = self?.metricsByRange[range] ?? null;
  const opponentMetrics = opponent?.metricsByRange[range] ?? null;
  const selfHasGames = (selfMetrics?.mostGames ?? 0) > 0;
  const opponentHasGames = (opponentMetrics?.mostGames ?? 0) > 0;

  return LEADERBOARD_METRIC_ORDER.map((metric) => {
    const selfValue = selfHasGames && selfMetrics ? selfMetrics[metric] : null;
    const opponentValue = opponentHasGames && opponentMetrics ? opponentMetrics[metric] : null;

    // Every leaderboard metric is higher-is-better, so a plain comparison works
    // for all of them (see formatLeaderboardMetricValue in lib/leaderboard.ts).
    const winner =
      selfValue === null || opponentValue === null
        ? 'none'
        : selfValue > opponentValue
          ? 'self'
          : opponentValue > selfValue
            ? 'opponent'
            : 'tie';

    return {
      metric,
      label: LEADERBOARD_METRIC_DETAILS[metric].label,
      selfValue,
      opponentValue,
      winner,
    };
  });
}

function getBarShares(selfValue: number | null, opponentValue: number | null) {
  const left = Math.max(0, selfValue ?? 0);
  const right = Math.max(0, opponentValue ?? 0);
  const total = left + right;

  if (total <= 0) {
    return { selfShare: 0, opponentShare: 0 };
  }

  return {
    selfShare: Math.max(left / total, left > 0 ? MIN_VISIBLE_SHARE : 0),
    opponentShare: Math.max(right / total, right > 0 ? MIN_VISIBLE_SHARE : 0),
  };
}

function ComparisonMetricRow({ row }: { row: ComparisonRow }) {
  const { selfShare, opponentShare } = getBarShares(row.selfValue, row.opponentValue);

  return (
    <View style={styles.metricRow}>
      <View style={styles.metricRowHeader}>
        <Text
          style={[styles.value, row.winner === 'self' && styles.valueWinner]}
          numberOfLines={1}>
          {row.selfValue === null ? '—' : formatLeaderboardMetricValue(row.metric, row.selfValue)}
        </Text>
        <Text style={styles.metricLabel} numberOfLines={1}>
          {row.label}
        </Text>
        <Text
          style={[
            styles.value,
            styles.valueRight,
            row.winner === 'opponent' && styles.valueWinner,
          ]}
          numberOfLines={1}>
          {row.opponentValue === null
            ? '—'
            : formatLeaderboardMetricValue(row.metric, row.opponentValue)}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fillSelf, { flex: selfShare }]} />
        <View style={[styles.fillOpponent, { flex: opponentShare }]} />
      </View>
    </View>
  );
}

function ComparisonSection({
  range,
  rows,
  emptyNote,
}: {
  range: LeaderboardRange;
  rows: ComparisonRow[];
  emptyNote: string | null;
}) {
  const wins = rows.filter((row) => row.winner === 'self').length;
  const losses = rows.filter((row) => row.winner === 'opponent').length;
  const ties = rows.filter((row) => row.winner === 'tie').length;
  const hasComparableRows = wins + losses + ties > 0;

  return (
    <SurfaceCard style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{LEADERBOARD_RANGE_LABELS[range]}</Text>
        {hasComparableRows ? (
          <Text style={styles.sectionTally}>
            {`${wins} - ${losses}`}
            {ties ? ` · ${ties} tied` : ''}
          </Text>
        ) : null}
      </View>
      {emptyNote ? <Text style={styles.sectionNote}>{emptyNote}</Text> : null}
      {rows.map((row) => (
        <ComparisonMetricRow key={row.metric} row={row} />
      ))}
    </SurfaceCard>
  );
}

export default function FriendComparisonModal({
  visible,
  opponent,
  selfRow,
  selfUserId,
  onClose,
}: FriendComparisonModalProps) {
  const insets = useSafeAreaInsets();
  const [versusRowWidth, setVersusRowWidth] = useState(0);
  const [separatorWidth, setSeparatorWidth] = useState(0);
  const [handleMeasurement, setHandleMeasurement] = useState<{
    handle: string;
    width: number;
  } | null>(null);
  const opponentUserId = opponent?.userId ?? '';

  const comparisonQuery = useQuery({
    queryKey: queryKeys.leaderboardCompare(opponentUserId),
    queryFn: () => fetchLeaderboardCompare(opponentUserId),
    enabled: visible && opponentUserId.length > 0,
    retry: false,
  });

  const comparisonData = comparisonQuery.data ?? null;

  const { selfParticipant, opponentParticipant } = useMemo(() => {
    const participants = comparisonData?.participants ?? [];
    const resolvedSelfUserId = comparisonData?.selfUserId || selfUserId;
    return {
      selfParticipant:
        participants.find((participant) => participant.userId === resolvedSelfUserId) ?? null,
      opponentParticipant:
        participants.find((participant) => participant.userId === opponentUserId) ?? null,
    };
  }, [comparisonData, opponentUserId, selfUserId]);

  const sections = useMemo(
    () =>
      COMPARISON_RANGES.map((range) => {
        const rows = buildComparisonRows(selfParticipant, opponentParticipant, range);
        const rangeLabel = LEADERBOARD_RANGE_LABELS[range].toLowerCase();
        const selfMissing = rows.every((row) => row.selfValue === null);
        const opponentMissing = rows.every((row) => row.opponentValue === null);

        let emptyNote: string | null = null;
        if (selfMissing && opponentMissing) {
          emptyNote = `Neither of you logged a game in ${rangeLabel}.`;
        } else if (selfMissing) {
          emptyNote = `You have no games in ${rangeLabel}.`;
        } else if (opponentMissing) {
          emptyNote = `${opponentHandle(opponent)} has no games in ${rangeLabel}.`;
        }

        return { range, rows, emptyNote };
      }),
    [opponent, opponentParticipant, selfParticipant],
  );

  if (!opponent) {
    return null;
  }

  const selfIdentity = selfParticipant ?? selfRow;
  const opponentIdentity = opponentParticipant ?? opponent;
  const opponentHandleText = formatHandle(opponentIdentity.username);

  // Half the row, minus the separator and the gaps flanking it.
  const halfRowWidth =
    versusRowWidth > 0 ? (versusRowWidth - separatorWidth - spacing.sm * 2) / 2 : 0;
  const measuredHandleWidth =
    handleMeasurement?.handle === opponentHandleText ? handleMeasurement.width : 0;
  // Until the handle has been measured, assume it fits: that keeps the common
  // case from flashing the off-centre layout on open.
  const isSeparatorCentered =
    halfRowWidth <= 0 ||
    measuredHandleWidth <= 0 ||
    measuredHandleWidth + OPPONENT_GROUP_CHROME_WIDTH <= halfRowWidth;

  const errorMessage =
    comparisonQuery.error instanceof Error
      ? comparisonQuery.error.message
      : comparisonQuery.error
        ? 'Failed to load comparison.'
        : null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SurfaceCard
          tone="raised"
          style={[
            styles.card,
            {
              marginTop: Math.max(insets.top, spacing.lg),
              marginBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}>
          <View style={styles.closeRow}>
            <View />
            <IconAction
              accessibilityLabel="Close comparison"
              onPress={onClose}
              icon={<Ionicons name="close" size={22} color={palette.muted} />}
            />
          </View>

          <View
            style={styles.versusRow}
            onLayout={(event) => setVersusRowWidth(event.nativeEvent.layout.width)}>
            <View style={[styles.versusPlayer, isSeparatorCentered && styles.versusHalf]}>
              <ProfileAvatar
                size={AVATAR_SIZE}
                avatarKind={selfIdentity?.avatarKind}
                avatarPresetId={selfIdentity?.avatarPresetId}
                avatarUrl={selfIdentity?.avatarUrl}
                initials={selfIdentity?.initials}
                username={selfIdentity?.username}
              />
              <View style={styles.versusLabelGroup}>
                <View style={[styles.legendDot, styles.legendDotSelf]} />
                <Text style={styles.versusName} numberOfLines={1}>
                  You
                </Text>
              </View>
            </View>

            {/* While the handle fits in its half, both halves grow equally and
                "vs" lands on the row's midpoint. Once it does not fit, the halves
                give way to equal-growth spacers: "vs" shifts to the midpoint
                between the two names instead, freeing width for the handle. */}
            {isSeparatorCentered ? null : <View style={styles.versusSpacer} />}
            <Text
              style={styles.versusSeparator}
              onLayout={(event) => setSeparatorWidth(event.nativeEvent.layout.width)}>
              vs
            </Text>
            {isSeparatorCentered ? null : <View style={styles.versusSpacer} />}

            <View
              style={[
                styles.versusPlayer,
                styles.versusPlayerRight,
                isSeparatorCentered && styles.versusHalf,
              ]}>
              <View style={[styles.versusLabelGroup, styles.versusLabelGroupRight]}>
                <Text style={styles.versusName} numberOfLines={1}>
                  {opponentHandleText}
                </Text>
                <View style={[styles.legendDot, styles.legendDotOpponent]} />
              </View>
              <ProfileAvatar
                size={AVATAR_SIZE}
                avatarKind={opponentIdentity.avatarKind}
                avatarPresetId={opponentIdentity.avatarPresetId}
                avatarUrl={opponentIdentity.avatarUrl}
                initials={opponentIdentity.initials}
                username={opponentIdentity.username}
              />
            </View>
          </View>

          {/* Off-layout probe for the handle's unconstrained width. It decides
              which of the two "vs" placements above applies, and is measured
              outside the versus row so the decision can never feed back into it. */}
          <Text
            aria-hidden
            pointerEvents="none"
            numberOfLines={1}
            style={[styles.versusName, styles.measureProbe]}
            onLayout={(event) =>
              setHandleMeasurement({
                handle: opponentHandleText,
                width: event.nativeEvent.layout.width,
              })
            }>
            {opponentHandleText}
          </Text>

          {errorMessage ? (
            <View style={styles.stateBlock}>
              <InfoBanner tone="error" text={errorMessage} />
              <ActionButton
                label="Try again"
                variant="secondary"
                onPress={() => {
                  void comparisonQuery.refetch();
                }}
              />
            </View>
          ) : comparisonQuery.isPending ? (
            <View style={styles.stateBlock}>
              <InlineLoadingCard label="Loading comparison..." />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {sections.map((section) => (
                <ComparisonSection
                  key={section.range}
                  range={section.range}
                  rows={section.rows}
                  emptyNote={section.emptyNote}
                />
              ))}
            </ScrollView>
          )}
        </SurfaceCard>
      </View>
    </Modal>
  );
}

function opponentHandle(opponent: LeaderboardMetricRow | null) {
  return opponent ? formatHandle(opponent.username) : 'They';
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  card: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  closeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  versusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  // Off-centre mode: both groups are content-sized and the spacers own the slack.
  versusPlayer: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Shrinks only once both spacers have collapsed, so the handle uses every
  // available pixel before it ellipsizes.
  versusPlayerRight: {
    minWidth: 0,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  // Centred mode: each group claims exactly half the row, putting "vs" on the
  // midpoint regardless of how much of each half the names actually use.
  versusHalf: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  versusSpacer: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 0,
  },
  measureProbe: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
  },
  versusLabelGroup: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  versusLabelGroupRight: {
    justifyContent: 'flex-end',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  legendDotSelf: {
    backgroundColor: palette.userChat,
  },
  legendDotOpponent: {
    backgroundColor: palette.accentSoft,
  },
  versusName: {
    flexShrink: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  versusSeparator: {
    flexShrink: 0,
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  stateBlock: {
    gap: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    fontFamily: fontFamilySans,
  },
  sectionTally: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  sectionNote: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamilySans,
  },
  metricRow: {
    gap: spacing.xs,
  },
  metricRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metricLabel: {
    flexShrink: 1,
    color: palette.muted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: fontFamilySans,
  },
  value: {
    flex: 1,
    minWidth: 0,
    color: palette.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    fontFamily: fontFamilySans,
  },
  valueRight: {
    textAlign: 'right',
  },
  valueWinner: {
    color: palette.text,
    fontWeight: '700',
  },
  track: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: palette.field,
    overflow: 'hidden',
  },
  fillSelf: {
    backgroundColor: palette.userChat,
  },
  fillOpponent: {
    backgroundColor: palette.accentSoft,
  },
});
